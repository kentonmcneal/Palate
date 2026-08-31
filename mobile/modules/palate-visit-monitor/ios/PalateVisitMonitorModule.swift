import ExpoModulesCore
import CoreLocation

/// Expo module surface for passive dining capture. Thin wrapper over
/// PalateVisitManager (the singleton that owns CoreLocation + disk persistence).
public class PalateVisitMonitorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PalateVisitMonitor")

    Events("onVisit")

    OnCreate {
      // Forward disk-persisted visits to JS while the app is alive.
      PalateVisitManager.shared.onVisitPersisted = { [weak self] visit in
        self?.sendEvent("onVisit", visit)
      }
    }

    OnDestroy {
      PalateVisitManager.shared.onVisitPersisted = nil
    }

    Function("startMonitoring") { () -> Bool in
      PalateVisitManager.shared.startMonitoring()
      return true
    }

    Function("stopMonitoring") { () -> Bool in
      PalateVisitManager.shared.stopMonitoring()
      return true
    }

    Function("getPendingVisits") { () -> [[String: Any]] in
      PalateVisitManager.shared.pendingVisits()
    }

    Function("clearVisits") { (ids: [String]) -> Int in
      PalateVisitManager.shared.clearVisits(ids: ids)
    }

    Function("authorizationStatus") { () -> String in
      PalateVisitManager.shared.authorizationStatusString()
    }

    // Live detector state + rolling event log, for the debug screen.
    Function("stopState") { () -> [String: Any] in
      PalateVisitManager.shared.stopStateDict()
    }

    // Lets the JS pipeline write into the same trace as the native detector, so
    // the debug screen shows one timeline: why a stop was detected AND why it
    // did or did not produce a prompt.
    Function("logNote") { (kind: String, detail: String) -> Bool in
      PalateVisitManager.shared.logEvent(kind, detail)
      return true
    }

    Function("clearStopLog") { () -> Bool in
      PalateVisitManager.shared.clearEventLog()
      return true
    }

    // Debug/reviewer path: inject a fake visit so the pipeline is verifiable
    // without physically dwelling at a restaurant for 20+ minutes.
    Function("simulateVisit") { (lat: Double, lng: Double, dwellMinutes: Double) -> [String: Any] in
      PalateVisitManager.shared.simulateVisit(lat: lat, lng: lng, dwellMinutes: dwellMinutes)
    }
  }
}
