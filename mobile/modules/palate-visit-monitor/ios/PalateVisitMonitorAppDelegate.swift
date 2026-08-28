import ExpoModulesCore

/// Re-arms visit monitoring on launch. When iOS relaunches the app in the
/// background for a location event after termination, this runs before the JS
/// runtime is ready — so the CLLocationManager is listening in time to receive
/// the delivered CLVisit. No-op unless the user previously enabled monitoring.
public class PalateVisitMonitorAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    PalateVisitManager.shared.resumeIfEnabled()
    return true
  }
}
