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
