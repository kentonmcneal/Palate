// ============================================================================
// observability.ts — Sentry init + breadcrumb helpers.
// ----------------------------------------------------------------------------
// Reads EXPO_PUBLIC_SENTRY_DSN from env (set in EAS secrets or app.json
// extra). If unset, all functions no-op silently — never blocks the app.
// ============================================================================

import Constants from "expo-constants";
import { privateErrorEvent, privateErrorTransport } from "./observability-privacy";

const DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ??
  (Constants.expoConfig?.extra as { sentryDsn?: string } | undefined)?.sentryDsn ??
  "";

let initialized = false;
let initializing: Promise<void> | null = null;

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
  if (initializing) return initializing;
  if (!DSN) {
    console.info("[obs] no SENTRY_DSN — observability is a no-op");
    return;
  }
  initializing = (async () => {
    try {
      const Sentry = await loadSentry();
      if (!Sentry) return;
      // Same installed fetch transport used by RN when native is disabled.
      const { makeFetchTransport } = await import("@sentry/browser");
      Sentry.init({
        dsn: DSN,
        // Deliberately JS-only. This does not erase historical native queues or
        // disable a native SDK independently initialized by the host binary.
        enableNative: false,
        enableNativeCrashHandling: false,
        enableAutoSessionTracking: false,
        enableLogs: false,
        enableMetrics: false,
        profilesSampleRate: 0,
        sendClientReports: false,
        transport: options => privateErrorTransport(makeFetchTransport(options)),
        tracesSampleRate: 0,
        sendDefaultPii: false,
        attachScreenshot: false,
        attachViewHierarchy: false,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        beforeBreadcrumb: () => null,
        beforeSendTransaction: () => null,
        beforeSend: (event, hint) => {
          // Attachments bypass event JSON filtering, so exclude them explicitly.
          hint.attachments = [];
          return privateErrorEvent(event);
        },
      });
      initialized = true;
    } catch {
      // Reporting must not create another unhandled rejection in the global
      // handler. Do not include the original error or credentials in this log.
      console.warn("[obs] error reporting initialization failed");
    }
  })();
  try { await initializing; } finally { initializing = null; }
}

/**
 * Normalize local thrown values into Errors, retaining structured database codes
 * for grouping. The legacy return value still includes local extras, but reportError
 * never adds them to SDK scope. Error messages and unknown names are withheld by
 * the JS event and transport filters; these fields are not remote diagnostics.
 */
export function toError(err: unknown): { error: Error; extra: Record<string, unknown> } {
  if (err instanceof Error) return { error: err, extra: {} };

  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const message = typeof o.message === "string" && o.message
      ? o.message
      : `Non-Error thrown with keys: ${Object.keys(o).sort().join(", ") || "none"}`;
    const error = new Error(message);
    // A Postgres error code is the single most identifying field Supabase
    // gives, so it goes in the name and Sentry groups by it.
    if (typeof o.code === "string" && o.code) error.name = `SupabaseError ${o.code}`;
    const extra: Record<string, unknown> = {};
    for (const k of ["code", "details", "hint", "status", "statusCode"]) {
      if (o[k] !== undefined) extra[`thrown_${k}`] = o[k];
    }
    return { error, extra };
  }

  return {
    error: new Error(typeof err === "string" && err ? err : `Non-Error thrown: ${String(err)}`),
    extra: { thrown_type: typeof err },
  };
}

async function reportError(err: unknown, context?: Record<string, unknown>): Promise<boolean> {
  if (!initialized || !DSN) return false;
  try {
    const Sentry = await loadSentry();
    if (!Sentry) return false;
    const { error } = toError(err);
    // Keep the context argument for existing callers, but never put arbitrary
    // payloads into SDK scopes/processors merely to discard them later.
    Sentry.captureException(error);
    // Accepted by the SDK, not proof of network delivery or dashboard receipt.
    return true;
  } catch {
    console.warn("[obs] error report could not be queued");
    return false;
  }
}

export async function captureError(err: unknown, context?: Record<string, unknown>): Promise<void> {
  await reportError(err, context);
}

export async function breadcrumb(_message: string, _data?: Record<string, unknown>): Promise<void> {
  // This bounded prototype does not collect breadcrumbs, even into SDK memory.
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
  return reportError(new Error("Palate test event from the Admin screen"), {
    at: "admin:sentryTest",
    deliberate: true,
  });
}
