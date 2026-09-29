import { privateErrorEvent, privateErrorTransport } from "../observability-privacy";
import type { ErrorEvent } from "@sentry/react-native";
import type { Envelope } from "@sentry/core";
const core = jest.requireActual("@sentry/core");
const secret = "SYNTHETIC_PRIVATE_VALUE";
const debugId = "12345678-1234-4234-8234-123456789abc";
const id = "0123456789abcdef0123456789abcdef";
const ios = "app:///main.jsbundle", android = "app:///index.android.bundle";
function fixture(): ErrorEvent {
  return {
    event_id: id, timestamp: 1700000000, level: "error", platform: secret,
    release: secret, dist: secret, environment: secret,
    sdk: { name: secret, version: secret, unknown: { nested: secret } },
    message: secret, logentry: { message: secret, params: [secret] },
    user: { id: secret, email: "fixture@example.invalid", ip_address: secret },
    request: { url: `https://example.invalid/?token=${secret}`, headers: { Authorization: secret }, data: secret },
    extra: { thrown_details: secret, nested: { receipt: secret } },
    contexts: { arbitrary: { value: secret }, react_native_context: { js_engine: "hermes", hermes_debug_info: false, component_stack: secret, hermes_version: secret } },
    tags: { identity: secret }, breadcrumbs: [{ message: secret }],
    transaction: secret, fingerprint: [secret], server_name: secret, future_sdk_field: secret,
    exception: { values: [{ type: "SupabaseError 23505", value: secret,
      mechanism: { type: "generic", handled: true, data: { value: secret } },
      stacktrace: { frames: [
        { filename: ios, function: secret, lineno: 1, colno: 408, in_app: true, vars: { token: secret }, context_line: secret, pre_context: [secret], module_metadata: { value: secret } },
        { filename: `/tmp/${secret}.js`, function: secret, lineno: 42, colno: 3 },
      ] },
    }] },
    debug_meta: { images: [{ type: "sourcemap", code_file: ios, debug_id: debugId, unknown: secret }, { type: "macho", code_file: secret, debug_id: debugId }] },
  } as unknown as ErrorEvent;
}
test("synthetic freeform slots are removed while canonical RN coordinates/debug IDs survive", () => {
  const event = fixture(), original = JSON.stringify(event), result = privateErrorEvent(event)!;
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain("fixture@example.invalid");
  expect(result.exception?.values?.[0]).toMatchObject({ type: "SupabaseError 23505", mechanism: { handled: true }, stacktrace: { frames: [{ filename: ios, lineno: 1, colno: 408 }, { lineno: 42, colno: 3 }] } });
  expect(result.exception?.values?.[0].stacktrace?.frames?.[0].function).toBeUndefined();
  expect(result.exception?.values?.[0].stacktrace?.frames?.[1].filename).toBeUndefined();
  expect(result.debug_meta?.images).toEqual([{ type: "sourcemap", code_file: ios, debug_id: debugId }]);
  expect(result.contexts).toEqual({ react_native_context: { js_engine: "hermes", hermes_debug_info: false } });
  expect(result.platform).toBe("javascript"); expect(result.event_id).toBe(id);
  expect(result.sdk).toBeUndefined(); expect(result.release).toBeUndefined();
  expect(JSON.stringify(event)).toBe(original);
});
test.each([ios, android, "main.jsbundle", "index.android.bundle"])("retains only the known code-file identity: %s", name => {
  const result = privateErrorEvent({ exception: { values: [{ stacktrace: { frames: [{ filename: name }] } }] }, debug_meta: { images: [{ type: "sourcemap", code_file: name, debug_id: debugId }] } });
  const canonical = name.includes("android") ? android : ios;
  expect(result?.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe(canonical);
  expect(result?.debug_meta?.images?.[0].code_file).toBe(canonical);
});
test.each([`https://example.invalid/${secret}/main.jsbundle`, `${ios}?${secret}`, `${secret}.js`, "/Users/person/index.android.bundle"])("unknown paths never become retained basenames: %s", filename => {
  const result = privateErrorEvent({ exception: { values: [{ stacktrace: { frames: [{ filename }] } }] }, debug_meta: { images: [{ type: "sourcemap", code_file: filename, debug_id: debugId }] } });
  expect(result?.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBeUndefined(); expect(result?.debug_meta).toBeUndefined();
});
test("validates IDs, timestamp, level, engine, and numeric positions", () => {
  const e = fixture() as any; e.event_id = secret; e.timestamp = Infinity; e.level = secret;
  e.contexts.react_native_context.js_engine = secret; e.debug_meta.images[0].debug_id = secret;
  e.exception.values[0].stacktrace.frames = [{ filename: android, lineno: NaN, colno: -2 }];
  const result = privateErrorEvent(e)!;
  expect(result.event_id).toBeUndefined(); expect(result.timestamp).toBeUndefined(); expect(result.level).toBeUndefined(); expect(result.contexts).toBeUndefined(); expect(result.debug_meta).toBeUndefined();
  expect(result.exception?.values?.[0].stacktrace?.frames?.[0]).toMatchObject({ filename: android, lineno: undefined, colno: undefined });
  expect(JSON.stringify(result)).not.toContain(secret);
});
test.each(["hermes", "jsc", "v8"])("bounded engine enum: %s", js_engine => {
  const result = privateErrorEvent({ contexts: { react_native_context: { js_engine, hermes_debug_info: true } } });
  expect(result?.contexts?.react_native_context).toEqual(js_engine === "hermes" ? { js_engine, hermes_debug_info: true } : { js_engine });
});
test("unknown exception names/messages and malformed events fail closed", () => {
  expect(privateErrorEvent({ exception: { values: [{ type: secret, value: secret }, { type: "TypeError", value: secret }] } })?.exception?.values?.map(e => e.type)).toEqual(["Error", "TypeError"]);
  expect(privateErrorEvent({ message: secret })?.message).toBe("Application event; details withheld for privacy");
  expect(privateErrorEvent(Object.defineProperty({}, "exception", { get() { throw Error("bad getter"); } }) as ErrorEvent)).toBeNull();
  expect(privateErrorEvent({ exception: { values: [null] } } as any)).toBeNull();
  expect(privateErrorEvent({ type: "feedback", message: secret } as any)).toBeNull();
});

// Installed Core prepares debug_meta, merges scope/hint attachments, applies its
// real beforeSend bypass paths, builds envelopes and serializes transport bodies.
// No RN initialization or network: createTransport's request executor is memory-only.
async function pipeline({ internal = false, feedback = false, lateHook = false, filter = true, mutate = undefined as undefined | ((event: any) => void) } = {}) {
  const bodies: string[] = []; let callbacks = 0; let prepared: any;
  const client = new core.Client({
    dsn: "https://fixture@example.invalid/1", integrations: [], sendClientReports: false,
    transport: (options: any) => {
      const underlying = core.createTransport(options, (request: any) => { bodies.push(typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body)); return Promise.resolve({ statusCode: 200 }); });
      return filter ? privateErrorTransport(underlying) : underlying;
    },
    beforeSend: (event: any, hint: any) => { callbacks++; prepared = JSON.parse(JSON.stringify(event)); if (!filter) return event; hint.attachments = []; return privateErrorEvent(event); },
  });
  client.init();
  client.addEventProcessor((event: any) => {
    for (const value of event.exception?.values || []) for (const frame of value.stacktrace?.frames || []) if (frame.filename === ios) frame.debug_id = debugId;
    return event;
  });
  if (lateHook) client.on("beforeEnvelope", (envelope: any) => {
    envelope[0].trace = { release: secret }; envelope[0].sdk = { name: secret };
    envelope[1][0][0].unknown = secret;
    envelope[1][0][1].extra = { token: secret }; envelope[1][0][1].release = secret;
    envelope[1].push([{ type: "attachment", filename: "late.txt" }, secret]);
  });
  if (mutate) client.on("beforeEnvelope", (envelope: any) => mutate(envelope[1][0][1]));
  const scope = new core.Scope(); scope.addAttachment({ filename: "scope.txt", data: secret });
  const event = feedback ? { type: "feedback", contexts: { feedback: { message: secret } } } : fixture();
  client.captureEvent(event, { attachments: [{ filename: "hint.txt", data: secret }], ...(internal ? { data: { __sentry__: true } } : {}) }, scope);
  await client.flush(500); await client.close(500);
  return { bodies, callbacks, prepared };
}
test("positive control: unfiltered installed Core serializes the synthetic secret", async () => {
  expect((await pipeline({ filter: false })).bodies.join("")).toContain(secret);
});
test("actual JS envelope retains Core-prepared source-map identity and excludes scope/hint attachments", async () => {
  const result = await pipeline(); expect(result.callbacks).toBe(1);
  expect(result.prepared.debug_meta.images.some((i: any) => i.debug_id === debugId && i.code_file === ios)).toBe(true);
  expect(result.bodies).toHaveLength(1); expect(result.bodies[0]).not.toContain(secret);
  const lines = result.bodies[0].split("\n").map(line => JSON.parse(line));
  expect(lines).toHaveLength(3); expect(lines[1]).toEqual({ type: "event" });
  expect(lines[2].debug_meta.images).toContainEqual({ type: "sourcemap", code_file: ios, debug_id: debugId });
  expect(lines[2].exception.values[0].stacktrace.frames[0]).toMatchObject({ filename: ios, lineno: 1, colno: 408 });
  expect(lines[2].sdk).toEqual({ settings: { infer_ip: "never" } });
  expect(lines[2].release).toBeUndefined(); expect(lines[0].trace).toBeUndefined();
});
test("feedback bypassing beforeSend sends no body on this transport", async () => {
  const result = await pipeline({ feedback: true }); expect(result.callbacks).toBe(0); expect(result.bodies).toEqual([]);
});
test("SDK internal events bypassing beforeSend are still sanitized at transport", async () => {
  const result = await pipeline({ internal: true }); expect(result.callbacks).toBe(0); expect(result.bodies).toHaveLength(1); expect(result.bodies[0]).not.toContain(secret);
});
test("post-beforeSend hook cannot reintroduce metadata or attachments into this transport", async () => {
  const result = await pipeline({ lateHook: true }); expect(result.bodies).toHaveLength(1); expect(result.bodies[0]).not.toContain(secret);
});
test.each(["feedback", "user_report", "session", "sessions", "attachment", "transaction", "profile", "profile_chunk", "replay_event", "replay_recording", "log", "metric", "trace_metric", "span", "check_in", "client_report", "raw_security", "future_item"])("transport does not support %s items", async type => {
  const send = jest.fn(async () => ({})), flush = jest.fn(async () => true);
  const transport = privateErrorTransport({ send, flush });
  await transport.send([{ unknown: secret }, [[{ type }, secret]]] as unknown as Envelope);
  expect(send).not.toHaveBeenCalled(); await transport.flush(123); expect(flush).toHaveBeenCalledWith(123);
});
test("transport rejects malformed payloads and getters without forwarding originals", async () => {
  const send = jest.fn(async () => ({})), transport = privateErrorTransport({ send, flush: async () => true });
  await transport.send([{}, [[{ type: "event" }, secret]]] as any);
  await transport.send([{}, [[{ type: "event" }, { event_id: secret, message: secret }]]] as any);
  await transport.send([{}, [[{ type: "event" }, { type: "feedback", message: secret }]]] as any);
  await transport.send(Object.defineProperty([], "1", { get() { throw Error("bad getter"); } }) as any);
  expect(send).not.toHaveBeenCalled();
});

// Validation must forward the same primitive it checked, even after late hooks.
const malformedFields: [string, (event: any) => void][] = [
  ["object-coercible exception type", e => { e.exception.values[0].type = { toString: () => "SupabaseError 23505", private: secret }; }],
  ["changing exception type", e => { let n = 0; Object.defineProperty(e.exception.values[0], "type", { get: () => ++n < 3 ? "Error" : secret }); }],
  ["changing timestamp", e => { let n = 0; Object.defineProperty(e, "timestamp", { get: () => ++n < 4 ? 1700000000 : secret }); }],
  ["changing level", e => { let n = 0; Object.defineProperty(e, "level", { get: () => ++n < 3 ? "error" : secret }); }],
  ["changing engine", e => { let n = 0; e.contexts = { react_native_context: {} }; Object.defineProperty(e.contexts.react_native_context, "js_engine", { get: () => ++n < 3 ? "hermes" : secret }); }],
  ["changing frame boolean", e => { let n = 0; Object.defineProperty(e.exception.values[0].stacktrace.frames[0], "in_app", { get: () => ++n === 1 ? true : secret }); }],
  ["changing mechanism", e => { let n = 0, m = 0; e.exception.values[0].mechanism = {}; Object.defineProperties(e.exception.values[0].mechanism, { type: { get: () => ++n === 1 ? "generic" : secret }, handled: { get: () => ++m === 1 ? true : secret } }); }],
  ["changing Hermes boolean", e => { let n = 0; e.contexts = { react_native_context: { js_engine: "hermes" } }; Object.defineProperty(e.contexts.react_native_context, "hermes_debug_info", { get: () => ++n === 1 ? true : secret }); }],
];
test.each(malformedFields)("final serialized payload excludes %s", async (_name, mutate) => {
  const result = await pipeline({ mutate });
  expect(result.bodies).toHaveLength(1);
  expect(result.bodies[0]).not.toContain(secret);
  const payload = JSON.parse(result.bodies[0].split("\n")[2]);
  expect(payload.debug_meta.images).toContainEqual({ type: "sourcemap", code_file: ios, debug_id: debugId });
});
