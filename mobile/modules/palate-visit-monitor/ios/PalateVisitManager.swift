import Foundation
import CoreLocation
import UIKit

/// Owns the CLLocationManager and persists every CLVisit to disk the instant it
/// arrives. iOS may suspend a background-woken app within seconds, so detection
/// must never depend on the JS runtime being alive — we write to disk first and
/// let JS drain the queue later, on its own schedule.
final class PalateVisitManager: NSObject, CLLocationManagerDelegate {
  static let shared = PalateVisitManager()

  private let manager = CLLocationManager()
  /// Separate manager for one-shot high-accuracy fixes, so requesting precision
  /// never disturbs the coarse continuous stream.
  private let preciseManager = CLLocationManager()
  private let ioQueue = DispatchQueue(label: "app.palate.visitmonitor.store")
  private let enabledKey = "palate.visitMonitoring.enabled"

  /// Set by the module while the app is alive, so a freshly captured visit can
  /// also be emitted to JS in real time. Nil when the app is dead (disk only).
  var onVisitPersisted: (([String: Any]) -> Void)?

  private override init() {
    super.init()
    manager.delegate = self
    // Required for background delivery once we act on significant-change
    // callbacks. Safe to set before authorization; CoreLocation only enforces
    // it when a background service is actually running.
    manager.allowsBackgroundLocationUpdates = true
    // Defaults to true, which lets iOS pause delivery when it thinks the user
    // is stationary — precisely the situation we need to observe.
    manager.pausesLocationUpdatesAutomatically = false
    // Coarse on purpose: at this accuracy iOS uses wifi/cell rather than GPS,
    // which is what makes continuous monitoring affordable.
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    manager.distanceFilter = 40
    preciseManager.delegate = self
    loadCandidate()
  }

  // MARK: - Power profile
  //
  // Continuous monitoring is the cost of this design, so the fix RATE adapts to
  // what we are doing. What never adapts is the 5-minute guarantee: that is
  // enforced by a scheduled timer, not by how often fixes arrive, so throttling
  // updates cannot make us miss a stop we have already started tracking.
  //
  //   active  — no candidate yet, or one still accumulating. Tightest filter.
  //   resting — the candidate already emitted; we have prompted about this
  //             place, so all that remains is noticing the user leave.
  //   saver   — battery low and unplugged. Detection still works; the one-shot
  //             high-accuracy fix at emit time is untouched, so attribution
  //             quality does not degrade with battery.
  private enum PowerProfile: String {
    case active, resting, saver
  }

  private var currentProfile: PowerProfile?

  private func desiredProfile() -> PowerProfile {
    if UIDevice.current.isBatteryMonitoringEnabled {
      let level = UIDevice.current.batteryLevel
      let state = UIDevice.current.batteryState
      let unplugged = state == .unplugged || state == .unknown
      // level is -1 when unavailable; treat that as "not low".
      if level >= 0, level < 0.15, unplugged { return .saver }
    }
    if let c = candidate, c.emitted { return .resting }
    return .active
  }

  private func applyPowerProfile() {
    let profile = desiredProfile()
    guard profile != currentProfile else { return }
    currentProfile = profile
    switch profile {
    case .active:
      manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      manager.distanceFilter = 40
    case .resting:
      manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      // Still well under the 120m stop radius, so leaving is detected promptly.
      manager.distanceFilter = 100
    case .saver:
      manager.desiredAccuracy = kCLLocationAccuracyKilometer
      manager.distanceFilter = 250
    }
    logEvent("power_profile", profile.rawValue)
  }

  // MARK: - Diagnostics
  //
  // Detection is invisible by construction: it happens in the background, over
  // minutes, while nobody is looking at the app. Without a trace, a failed
  // real-world test tells you only "nothing happened" — which is the same
  // symptom whether no fix arrived, the candidate kept resetting, or the emit
  // fired and the JS pipeline dropped it. This log makes one restaurant visit
  // diagnostic instead of a round trip per hypothesis.

  private let eventLogKey = "palate.stop.eventLog"
  private let eventLogCap = 60

  func logEvent(_ kind: String, _ detail: String = "") {
    let entry = "\(Date().timeIntervalSince1970)|\(kind)|\(detail)"
    var log = UserDefaults.standard.stringArray(forKey: eventLogKey) ?? []
    log.append(entry)
    if log.count > eventLogCap { log.removeFirst(log.count - eventLogCap) }
    UserDefaults.standard.set(log, forKey: eventLogKey)
  }

  func clearEventLog() {
    UserDefaults.standard.removeObject(forKey: eventLogKey)
  }

  /// Live view of the detector for the debug screen.
  func stopStateDict() -> [String: Any] {
    var out: [String: Any] = [
      "monitoring": UserDefaults.standard.bool(forKey: enabledKey),
      "minDwellSec": minDwellSec,
      "stopRadiusM": stopRadiusM,
      "log": UserDefaults.standard.stringArray(forKey: eventLogKey) ?? [],
      "awaitingPreciseFix": pendingPreciseEmit != nil,
      "powerProfile": (currentProfile ?? desiredProfile()).rawValue,
      "batteryLevel": UIDevice.current.batteryLevel
    ]
    if let c = candidate {
      let now = Date()
      // Explicitly typed: a heterogeneous literal assigned into Any is at best
      // a warning, and the ternary below would otherwise try to unify Int with
      // TimeInterval.
      let cand: [String: Any] = [
        "lat": c.center.coordinate.latitude,
        "lng": c.center.coordinate.longitude,
        "accuracy": c.accuracy,
        "firstSeenAt": c.firstSeen.timeIntervalSince1970 * 1000,
        "lastSeenAt": c.lastSeen.timeIntervalSince1970 * 1000,
        "dwellSec": now.timeIntervalSince(c.firstSeen),
        "sinceLastFixSec": now.timeIntervalSince(c.lastSeen),
        "emitted": c.emitted,
        // Negative once the threshold has passed — tells you at a glance
        // whether the scheduled check should already have run.
        "secUntilDwellCheck": c.emitted
          ? TimeInterval(0)
          : (self.minDwellSec - now.timeIntervalSince(c.firstSeen))
      ]
      out["candidate"] = cand
    }
    return out
  }

  // MARK: - Stop detection
  //
  // The product requirement is "sit down for 5-10 minutes, get asked about THAT
  // restaurant." Neither CLVisit nor significant-change can do that: both only
  // resolve a place after you leave, and CLVisit is additionally unreliable
  // since iOS 26. So the primary detector is coarse continuous location plus
  // on-device stop detection.
  //
  // The important property is WHEN we emit. A departure-triggered design can
  // never prompt while the user is still at the table, so we emit the moment a
  // candidate crosses the dwell threshold — the user is usually still sitting
  // there — and take one high-accuracy fix at that instant to name the venue.
  // Coarse monitoring is cheap (wifi/cell, not GPS); we only pay for GPS and a
  // Places lookup once per real stop.

  private struct StopCandidate {
    let id: String
    var center: CLLocation
    var accuracy: CLLocationAccuracy
    var firstSeen: Date
    var lastSeen: Date
    var emitted: Bool
  }

  /// A fix within this distance of the candidate centre counts as "still here".
  /// Generous on purpose: indoors, accuracy routinely degrades past 100m and a
  /// tighter radius would split one meal into several stops.
  private let stopRadiusM: CLLocationDistance = 120

  /// How long a candidate must hold before it counts as a visit.
  private let minDwellSec: TimeInterval = 5 * 60

  /// Give up waiting for the high-accuracy fix and emit with the coarse centre.
  private let preciseFixTimeoutSec: TimeInterval = 15

  private var candidate: StopCandidate?
  private var pendingPreciseEmit: StopCandidate?

  private let candLatKey = "palate.stop.lat"
  private let candLngKey = "palate.stop.lng"
  private let candAccKey = "palate.stop.acc"
  private let candFirstKey = "palate.stop.firstSeen"
  private let candLastKey = "palate.stop.lastSeen"
  private let candEmittedKey = "palate.stop.emitted"

  private func saveCandidate() {
    let d = UserDefaults.standard
    guard let c = candidate else {
      [candLatKey, candLngKey, candAccKey, candFirstKey, candLastKey, candEmittedKey]
        .forEach { d.removeObject(forKey: $0) }
      return
    }
    d.set(c.center.coordinate.latitude, forKey: candLatKey)
    d.set(c.center.coordinate.longitude, forKey: candLngKey)
    d.set(c.accuracy, forKey: candAccKey)
    d.set(c.firstSeen.timeIntervalSince1970, forKey: candFirstKey)
    d.set(c.lastSeen.timeIntervalSince1970, forKey: candLastKey)
    d.set(c.emitted, forKey: candEmittedKey)
  }

  /// Restore across a background relaunch, so a stop that began before iOS
  /// restarted us is not silently forgotten.
  private func loadCandidate() {
    let d = UserDefaults.standard
    guard d.object(forKey: candFirstKey) != nil else { return }
    let lat = d.double(forKey: candLatKey)
    let lng = d.double(forKey: candLngKey)
    guard lat != 0 || lng != 0 else { return }
    candidate = StopCandidate(
      id: UUID().uuidString,
      center: CLLocation(latitude: lat, longitude: lng),
      accuracy: d.double(forKey: candAccKey),
      firstSeen: Date(timeIntervalSince1970: d.double(forKey: candFirstKey)),
      lastSeen: Date(timeIntervalSince1970: d.double(forKey: candLastKey)),
      emitted: d.bool(forKey: candEmittedKey)
    )
  }

  /// Standing still produces no location updates, so the dwell threshold would
  /// never be re-checked. Continuous background updates keep the process alive,
  /// which means a scheduled check does fire.
  private func scheduleDwellCheck(for id: String) {
    DispatchQueue.main.asyncAfter(deadline: .now() + minDwellSec + 1) { [weak self] in
      guard let self, var c = self.candidate, c.id == id, !c.emitted else { return }
      if Date().timeIntervalSince(c.firstSeen) >= self.minDwellSec {
        c.emitted = true
        self.candidate = c
        self.saveCandidate()
        // The stationary path: no new fixes arrive while sitting still, so this
        // timer — not a location update — is what fires for a seated meal.
        self.logEvent("emit_via_timer", "")
        self.emitStop(c)
        self.applyPowerProfile()
      }
    }
  }

  private func ingest(_ fix: CLLocation) {
    guard fix.horizontalAccuracy >= 0 else { return }
    let now = fix.timestamp

    guard var c = candidate else {
      let fresh = StopCandidate(
        id: UUID().uuidString, center: fix, accuracy: fix.horizontalAccuracy,
        firstSeen: now, lastSeen: now, emitted: false
      )
      candidate = fresh
      saveCandidate()
      logEvent("candidate_started", String(format: "acc=%.0fm", fix.horizontalAccuracy))
      applyPowerProfile()
      scheduleDwellCheck(for: fresh.id)
      return
    }

    if fix.distance(from: c.center) <= stopRadiusM {
      c.lastSeen = max(c.lastSeen, now)
      // Keep the most accurate fix seen as the centre — it is the best guess at
      // where the user actually is.
      if fix.horizontalAccuracy < c.accuracy {
        c.center = fix
        c.accuracy = fix.horizontalAccuracy
      }
      let held = c.lastSeen.timeIntervalSince(c.firstSeen)
      let shouldEmit = !c.emitted && held >= minDwellSec
      if shouldEmit { c.emitted = true }
      candidate = c
      saveCandidate()
      logEvent("candidate_extended", String(format: "dwell=%.0fs acc=%.0fm", held, fix.horizontalAccuracy))
      if shouldEmit {
        logEvent("emit_threshold_reached", String(format: "dwell=%.0fs", held))
        emitStop(c)
      }
      applyPowerProfile()
      return
    }

    // Moved on. Emit a qualifying stop we never got around to reporting (e.g.
    // the app was suspended through the dwell window), then start fresh.
    let heldBeforeLeaving = c.lastSeen.timeIntervalSince(c.firstSeen)
    logEvent("candidate_left", String(format: "held=%.0fs emitted=%@", heldBeforeLeaving, c.emitted ? "y" : "n"))
    if !c.emitted, heldBeforeLeaving >= minDwellSec {
      emitStop(c)
    }
    let fresh = StopCandidate(
      id: UUID().uuidString, center: fix, accuracy: fix.horizontalAccuracy,
      firstSeen: now, lastSeen: now, emitted: false
    )
    candidate = fresh
    saveCandidate()
    applyPowerProfile()
    scheduleDwellCheck(for: fresh.id)
  }

  /// Take one high-accuracy fix before reporting — this is what turns "somewhere
  /// on this block" into "Shake Shack". Falls back to the coarse centre.
  private func emitStop(_ stop: StopCandidate) {
    pendingPreciseEmit = stop
    preciseManager.desiredAccuracy = kCLLocationAccuracyBest
    preciseManager.requestLocation()
    DispatchQueue.main.asyncAfter(deadline: .now() + preciseFixTimeoutSec) { [weak self] in
      guard let self, let pending = self.pendingPreciseEmit, pending.id == stop.id else { return }
      self.pendingPreciseEmit = nil
      self.logEvent("precise_fix_timeout", String(format: "fellback acc=%.0fm", pending.accuracy))
      self.persistStop(pending, coordinate: pending.center.coordinate, accuracy: pending.accuracy)
    }
  }

  private func persistStop(
    _ stop: StopCandidate,
    coordinate: CLLocationCoordinate2D,
    accuracy: CLLocationAccuracy
  ) {
    // departure = now: the stop is still open, but the JS pipeline needs a
    // bounded dwell to qualify it, and "how long they have been here so far" is
    // the honest answer at this instant.
    persist(makeRecord(
      coordinate: coordinate,
      horizontalAccuracy: accuracy,
      arrival: stop.firstSeen,
      departure: Date(),
      source: "stop"
    ))
  }

  // MARK: - Control

  func startMonitoring() {
    UserDefaults.standard.set(true, forKey: enabledKey)
    // Visit monitoring is the primary signal (arrival/departure, ~1-3%/day).
    manager.startMonitoringVisits()
    // Significant-change stays on as a relaunch mechanism: if iOS ever suspends
    // the continuous stream, a significant move wakes us back up.
    manager.startMonitoringSignificantLocationChanges()
    // The primary detector.
    UIDevice.current.isBatteryMonitoringEnabled = true
    applyPowerProfile()
    manager.startUpdatingLocation()
    logEvent("monitoring_started", "")
  }

  func stopMonitoring() {
    UserDefaults.standard.set(false, forKey: enabledKey)
    manager.stopMonitoringVisits()
    manager.stopMonitoringSignificantLocationChanges()
    manager.stopUpdatingLocation()
    candidate = nil
    saveCandidate()
    logEvent("monitoring_stopped", "")
  }

  /// Re-arm on a cold background relaunch (iOS relaunches us for location events
  /// after termination) if the user previously enabled monitoring.
  func resumeIfEnabled() {
    guard UserDefaults.standard.bool(forKey: enabledKey) else { return }
    // This is the path that runs in real background operation — iOS relaunching
    // us for a location event — so it must do everything startMonitoring does.
    // It previously skipped both, meaning a relaunched session never adapted
    // its power profile and left no trace at all, which is exactly what makes
    // an empty detector log ambiguous.
    UIDevice.current.isBatteryMonitoringEnabled = true
    applyPowerProfile()
    manager.startMonitoringVisits()
    manager.startMonitoringSignificantLocationChanges()
    manager.startUpdatingLocation()
    logEvent("monitoring_resumed", "background relaunch")
  }

  func authorizationStatusString() -> String {
    switch manager.authorizationStatus {
    case .authorizedAlways: return "always"
    case .authorizedWhenInUse: return "whenInUse"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
    // CLVisit uses a distant-past arrival / distant-future departure sentinel
    // when a bound is unknown. We persist both open and closed visits — Phase 1
    // is lossless capture; qualification (dwell, home/work) is Phase 3.
    let record = makeRecord(
      coordinate: visit.coordinate,
      horizontalAccuracy: visit.horizontalAccuracy,
      arrival: visit.arrivalDate,
      departure: visit.departureDate
    )
    logEvent("clvisit_received", "")
    persist(record)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let fix = locations.last else { return }

    // The one-shot precise fix we asked for when a stop qualified.
    if manager === preciseManager {
      guard let pending = pendingPreciseEmit else { return }
      pendingPreciseEmit = nil
      logEvent("precise_fix_ok", String(format: "acc=%.0fm", fix.horizontalAccuracy))
      persistStop(pending, coordinate: fix.coordinate, accuracy: fix.horizontalAccuracy)
      return
    }

    ingest(fix)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // A failed precise request must still produce the visit — degrade to the
    // coarse centre rather than dropping a real stop.
    guard manager === preciseManager, let pending = pendingPreciseEmit else { return }
    pendingPreciseEmit = nil
    logEvent("precise_fix_failed", "\(error.localizedDescription)")
    persistStop(pending, coordinate: pending.center.coordinate, accuracy: pending.accuracy)
  }

  // MARK: - Simulated visit (debug / reviewer path)

  func simulateVisit(lat: Double, lng: Double, dwellMinutes: Double) -> [String: Any] {
    let departure = Date()
    let arrival = departure.addingTimeInterval(-dwellMinutes * 60)
    let record = makeRecord(
      coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
      horizontalAccuracy: 30,
      arrival: arrival,
      departure: departure,
      simulated: true
    )
    persist(record)
    return record
  }

  // MARK: - Record shaping

  private func makeRecord(
    coordinate: CLLocationCoordinate2D,
    horizontalAccuracy: CLLocationAccuracy,
    arrival: Date,
    departure: Date,
    simulated: Bool = false,
    source: String = "visit"
  ) -> [String: Any] {
    // Guard against the CLVisit sentinel dates (year 4001 / 0001): treat any
    // non-positive or absurdly large interval as "unknown" -> null.
    let now = Date().timeIntervalSince1970
    let arr = arrival.timeIntervalSince1970
    let dep = departure.timeIntervalSince1970
    let plausible: (TimeInterval) -> Bool = { $0 > 0 && $0 < now + 60 * 60 * 24 * 365 }

    return [
      "id": UUID().uuidString,
      "lat": coordinate.latitude,
      "lng": coordinate.longitude,
      "horizontalAccuracy": horizontalAccuracy,
      "arrivalAt": plausible(arr) ? arr * 1000 : NSNull(),
      "departureAt": plausible(dep) ? dep * 1000 : NSNull(),
      "capturedAt": now * 1000,
      "simulated": simulated,
      "source": source
    ]
  }

  // MARK: - Persistence (NDJSON in Application Support)

  private func storeURL() -> URL {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("palate_visits.ndjson")
  }

  private func persist(_ record: [String: Any]) {
    ioQueue.sync {
      guard
        let data = try? JSONSerialization.data(withJSONObject: record),
        let json = String(data: data, encoding: .utf8)
      else { return }
      let line = json + "\n"
      let url = storeURL()
      if let handle = try? FileHandle(forWritingTo: url) {
        defer { try? handle.close() }
        handle.seekToEndOfFile()
        if let lineData = line.data(using: .utf8) { handle.write(lineData) }
      } else {
        try? line.data(using: .utf8)?.write(to: url, options: .atomic)
      }
    }
    if let cb = onVisitPersisted {
      DispatchQueue.main.async { cb(record) }
    }
  }

  func pendingVisits() -> [[String: Any]] {
    ioQueue.sync {
      guard let content = try? String(contentsOf: storeURL(), encoding: .utf8) else { return [] }
      return content.split(separator: "\n").compactMap { line in
        guard
          let d = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any]
        else { return nil }
        return obj
      }
    }
  }

  @discardableResult
  func clearVisits(ids: [String]) -> Int {
    ioQueue.sync {
      guard let content = try? String(contentsOf: storeURL(), encoding: .utf8) else { return 0 }
      let idSet = Set(ids)
      var kept: [String] = []
      var removed = 0
      for line in content.split(separator: "\n") {
        if
          let d = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let id = obj["id"] as? String,
          idSet.contains(id)
        {
          removed += 1
        } else {
          kept.append(String(line))
        }
      }
      let joined = kept.isEmpty ? "" : kept.joined(separator: "\n") + "\n"
      try? joined.data(using: .utf8)?.write(to: storeURL(), options: .atomic)
      return removed
    }
  }
}
