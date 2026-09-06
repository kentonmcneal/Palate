// ============================================================================
// observability.ts — Sentry init + breadcrumb helpers.
// ----------------------------------------------------------------------------
// Reads EXPO_PUBLIC_SENTRY_DSN from env (set in EAS secrets or app.json
// extra). If unset, all functions no-op silently — never blocks the app.
// ============================================================================

import Constants from "expo-constants";

const DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ??
  (Constants.expoConfig?.extra as { sentryDsn?: string } | undefined)?.sentryDsn ??
  "";

let initialized = false;

async function loadSentry(): Promise<typeof import("@sentry/react-native") | null> {
  try {
    return await import("@sentry/react-native");
  } catch {
    console.warn(
      "[obs] @sentry/react-native not installed — run `npx expo install @sentry/react-native`",
    );
    return null;
  }
}

export async function initObservability(): Promise<void> {
  if (initialized) return;
  if (!DSN) {
    console.info("[obs] no SENTRY_DSN — observability is a no-op");
    return;
  }
  const Sentry = await loadSentry();
  if (!Sentry) return;
  Sentry.init({
    dsn: DSN,
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30_000,
    tracesSampleRate: 0.1,
  });
  initialized = true;
}

export async function captureError(err: unknown, context?: Record<string, unknown>): Promise<void> {
  if (!initialized || !DSN) return;
  const Sentry = await loadSentry();
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}

export async function breadcrumb(message: string, data?: Record<string, unknown>): Promise<void> {
  if (!initialized || !DSN) return;
  const Sentry = await loadSentry();
  if (!Sentry) return;
  Sentry.addBreadcrumb({ message, data, level: "info" });
}

/**
 * Whether error reporting is actually on, for a screen that wants to say so.
 *
 * This existed as a `console.info` nobody could see from a phone, which is
 * how the DSN came to be reported as missing for a whole day while it sat in
 * the EAS environment the builds and updates read from. A no-op error
 * reporter looks exactly like an app that never errors, so the state has to
 * be visible somewhere a person can look.
 */
export function observabilityStatus(): { hasDsn: boolean; initialized: boolean; host: string | null } {
  let host: string | null = null;
  try {
    // The ingest host identifies the project without exposing the key half of
    // the DSN, which is the part that should not end up in a screenshot.
    host = DSN ? new URL(DSN).host : null;
  } catch {
    host = null;
  }
  return { hasDsn: Boolean(DSN), initialized, host };
}

/** Deliberately raise a reportable error, so somebody can confirm the pipe
 *  works without waiting for a real crash. Returns false when reporting is
 *  off, which is itself the answer. */
export async function sendTestEvent(): Promise<boolean> {
  if (!DSN) return false;
  await initObservability();
  if (!initialized) return false;
  await captureError(new Error("Palate test event from the Admin screen"), {
    at: "admin:sentryTest",
    deliberate: true,
  });
  return true;
}
