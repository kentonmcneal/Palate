// ============================================================================
// global-error-handler.ts — app-wide safety net for uncaught errors.
// ----------------------------------------------------------------------------
// Installs two catch-alls so a stray uncaught exception or unhandled promise
// rejection is REPORTED and SWALLOWED instead of becoming a native fatal.
//
// Why this exists: under the New Architecture (SDK 57 upgrade) an unhandled
// promise rejection is escalated by expo-updates' error-recovery queue into a
// SIGABRT — it looks for a published update to roll back to, finds none, and
// re-raises. That is the brand-new-account launch crash (crashes on
// expo.controller.errorRecoveryQueue ~3s after launch).
//
// This is the belt to the per-call `.catch()` guards' suspenders: those guard
// the startup promises we know about; this also catches anything we didn't.
// A React ErrorBoundary cannot help here — it only sees render-phase throws,
// and this class of failure happens outside the React tree.
// ============================================================================

import { captureError } from "./observability";

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => ((e: unknown, isFatal?: boolean) => void) | undefined;
      setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
    };
    HermesInternal?: {
      enablePromiseRejectionTracker?: (opts: unknown) => void;
    };
  };

  // 1) Uncaught JS exceptions. Report always; in production do NOT re-raise
  //    (staying alive + reporting beats a hard crash). Keep the dev redbox so
  //    development still surfaces errors loudly.
  try {
    const prev = g.ErrorUtils?.getGlobalHandler?.();
    g.ErrorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
      void captureError(error, { source: "globalHandler", isFatal: !!isFatal });
      if (__DEV__ && typeof prev === "function") prev(error, isFatal);
    });
  } catch {
    // If ErrorUtils isn't present, there's nothing to install — never throw
    // from the installer itself.
  }

  // 2) Unhandled promise rejections. This app runs on Hermes, whose tracker is
  //    exposed via HermesInternal; fall back to RN's promise-polyfill tracker
  //    otherwise. Either way, report instead of letting it escalate to a fatal.
  const onUnhandled = (_id: unknown, error: unknown): void => {
    void captureError(error, { source: "unhandledRejection" });
  };
  try {
    if (typeof g.HermesInternal?.enablePromiseRejectionTracker === "function") {
      g.HermesInternal.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled,
        onHandled: () => {},
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const tracking = require("promise/setimmediate/rejection-tracking");
      tracking.enable({ allRejections: true, onUnhandled, onHandled: () => {} });
    }
  } catch (e) {
    void captureError(e, { source: "installRejectionTracking" });
  }
}
