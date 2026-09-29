import type { ErrorEvent, Exception, StackFrame } from "@sentry/react-native";
import type { Envelope, EventItem, Transport } from "@sentry/core";

const ERROR_TYPES = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);
const LEVELS = new Set(["fatal", "error", "warning", "log", "info", "debug"]);
const ENGINES = new Set(["hermes", "jsc", "v8"]);
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const boolean = (v: unknown) => typeof v === "boolean" ? v : undefined;
const eventId = (v: unknown) => typeof v === "string" && /^[a-f\d]{32}$/i.test(v) ? v : undefined;
const debugId = (v: unknown) => typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v) ? v : undefined;

function codeFile(value: unknown): string | undefined {
  // Installed RN RewriteFrames uses these canonical Expo bundle names. Never
  // retain arbitrary basenames: even an identifier-shaped name can be private.
  if (value === "app:///main.jsbundle" || value === "main.jsbundle") return "app:///main.jsbundle";
  if (value === "app:///index.android.bundle" || value === "index.android.bundle") return "app:///index.android.bundle";
  return undefined;
}

function frame(value: StackFrame): StackFrame {
  return {
    filename: codeFile(value.filename ?? value.abs_path),
    lineno: integer(value.lineno), colno: integer(value.colno),
    in_app: boolean(value.in_app),
    // Recover function names through source maps, never runtime freeform text.
  };
}

function exception(value: Exception): Exception {
  // Validate one primitive snapshot; coercion or a second accessor read can
  // otherwise forward a different, unvalidated value at the transport boundary.
  const suppliedType = value.type;
  const type = typeof suppliedType === "string" && (ERROR_TYPES.has(suppliedType) || /^SupabaseError (?:[0-9A-Z]{5}|PGRST\d{3})$/.test(suppliedType)) ? suppliedType : "Error";
  const mechanism = value.mechanism, mechanismType = mechanism?.type;
  return {
    type, value: "Error details withheld for privacy",
    stacktrace: value.stacktrace?.frames ? { frames: value.stacktrace.frames.slice(-100).map(frame) } : undefined,
    mechanism: mechanism ? {
      type: typeof mechanismType === "string" && ["onerror", "onunhandledrejection", "generic", "instrument"].includes(mechanismType) ? mechanismType : "generic",
      handled: boolean(mechanism.handled),
    } : undefined,
  };
}

/** Bounded JS diagnostics only; not a filter for independently initialized native SDKs. */
export function privateErrorEvent(event: ErrorEvent): ErrorEvent | null {
  try {
    if (!event || typeof event !== "object" || event.type !== undefined) return null;
    const images = event.debug_meta?.images?.slice(0, 20).flatMap(image => {
      if (image.type !== "sourcemap") return [];
      const code_file = codeFile(image.code_file), debug_id = debugId(image.debug_id);
      return code_file && debug_id ? [{ type: "sourcemap" as const, code_file, debug_id }] : [];
    });
    const runtime = event.contexts?.react_native_context;
    const jsEngine = runtime?.js_engine, hermesDebugInfo = boolean(runtime?.hermes_debug_info);
    const engine = typeof jsEngine === "string" && ENGINES.has(jsEngine) ? jsEngine : undefined;
    const timestamp = event.timestamp, level = event.level;
    return {
      type: undefined,
      event_id: eventId(event.event_id),
      timestamp: typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : undefined,
      level: level && LEVELS.has(level) ? level : undefined,
      platform: "javascript",
      // No event-supplied SDK/build identity, release, dist, environment, names,
      // requests, scopes, source context or other unreviewed freeform fields.
      exception: event.exception?.values ? { values: event.exception.values.slice(0, 10).map(exception) } : undefined,
      message: event.exception?.values?.length ? undefined : "Application event; details withheld for privacy",
      debug_meta: images?.length ? { images } : undefined,
      contexts: engine ? { react_native_context: {
        js_engine: engine,
        ...(engine === "hermes" && hermesDebugInfo !== undefined ? { hermes_debug_info: hermesDebugInfo } : {}),
      } } : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Last check on this configured JS transport, after SDK processors/hooks.
 * Feedback, sessions, attachments, logs, profiles, and unknown item types are
 * unsupported. Internal error events which skip beforeSend are filtered here.
 * Only the fixed SDK policy infer_ip=never is restored; no event SDK identity.
 */
export function privateErrorTransport(transport: Transport): Transport {
  const sdk = { settings: { infer_ip: "never" as const } };
  return {
    send(envelope: Envelope) {
      try {
        const items: EventItem[] = [];
        for (const [header, payload] of envelope[1]) {
          if (header.type !== "event" || !payload || typeof payload !== "object") continue;
          const event = privateErrorEvent(payload as ErrorEvent);
          if (event?.event_id) items.push([{ type: "event" }, { ...event, sdk }]);
        }
        if (!items.length) return Promise.resolve({});
        // Discard envelope/item metadata too (trace context, event-provided SDK,
        // unknown headers). The configured fetch URL already carries the DSN.
        return transport.send([{
          event_id: items[0][1].event_id!, // only validated IDs are admitted above
          sent_at: new Date().toISOString(),
        }, items]);
      } catch {
        // Malformed data must not escape filtering or trigger another report.
        return Promise.resolve({});
      }
    },
    flush: timeout => transport.flush(timeout),
  };
}
