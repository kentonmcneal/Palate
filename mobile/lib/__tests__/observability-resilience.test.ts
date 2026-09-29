import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";
import ts from "typescript";

// Run the real module with a mocked SDK and synthetic DSN. Transpiling to
// CommonJS also handles its lazy import without Jest's experimental ESM mode.
async function setup() {
  const transport = { send: jest.fn(async (_envelope: any) => ({})), flush: jest.fn(async () => true) };
  const sdk = {
    init: jest.fn(),
    SDK_NAME: "sentry.javascript.react-native", SDK_VERSION: "7.11.0",
    withScope: jest.fn((fn: (scope: { setExtras: jest.Mock }) => void) => fn({ setExtras: jest.fn() })),
    captureException: jest.fn(),
    addBreadcrumb: jest.fn(),
  };
  const exports: Record<string, any> = {};
  const context = {
    exports, Error, URL,
    process: { env: { EXPO_PUBLIC_SENTRY_DSN: "https://fixture@example.invalid/1" } },
    console: { warn: jest.fn(), info: jest.fn() },
    require: (name: string) => {
      if (name === "@sentry/react-native") return sdk;
      if (name === "@sentry/browser") return { makeFetchTransport: jest.fn(() => transport) };
      if (name === "./observability-privacy") return jest.requireActual("../observability-privacy");
      if (name === "expo-constants") return { default: {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  const source = readFileSync(resolve(__dirname, "../observability.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { sdk, obs: exports, transport };
}

test("concurrent initialization starts the SDK once", async () => {
  const { sdk, obs } = await setup();
  await Promise.all([obs.initObservability(), obs.initObservability(), obs.initObservability()]);
  expect(sdk.init).toHaveBeenCalledTimes(1);
  expect(obs.observabilityStatus().initialized).toBe(true);
});
test("initialization failures are contained and a later attempt can retry", async () => {
  const { sdk, obs } = await setup();
  (sdk.init as jest.Mock).mockImplementationOnce(() => { throw new Error("synthetic SDK failure"); });
  await expect(obs.initObservability()).resolves.toBeUndefined();
  expect(obs.observabilityStatus().initialized).toBe(false);
  await obs.initObservability();
  expect(obs.observabilityStatus().initialized).toBe(true);
});
test("capture failures do not reject into the global rejection handler", async () => {
  const { sdk, obs } = await setup();
  await obs.initObservability();
  (sdk.captureException as jest.Mock).mockImplementation(() => { throw new Error("synthetic capture failure"); });
  await expect(obs.captureError(new Error("original failure"))).resolves.toBeUndefined();
  await expect(obs.sendTestEvent()).resolves.toBe(false);
});
test("normalization and breadcrumb failures are contained", async () => {
  const { sdk, obs } = await setup();
  await obs.initObservability();
  const broken = Object.defineProperty({}, "message", { get() { throw new Error("bad getter"); } });
  await expect(obs.captureError(broken)).resolves.toBeUndefined();
  (sdk.addBreadcrumb as jest.Mock).mockImplementation(() => { throw new Error("synthetic breadcrumb failure"); });
  await expect(obs.breadcrumb("example")).resolves.toBeUndefined();
});
test("test event reports SDK acceptance without invoking a real transport", async () => {
  const { sdk, obs } = await setup();
  await expect(obs.sendTestEvent()).resolves.toBe(true);
  expect(sdk.captureException).toHaveBeenCalledTimes(1);
});

test("configured SDK boundary filters events and refuses attachments, breadcrumbs and transactions", async () => {
  const { sdk, obs } = await setup(); await obs.initObservability();
  const options = sdk.init.mock.calls[0][0];
  expect(options.enableNative).toBe(false);
  expect(options.enableNativeCrashHandling).toBe(false);
  expect(options.enableAutoSessionTracking).toBe(false);
  expect(options.enableLogs).toBe(false);
  expect(options.enableMetrics).toBe(false);
  expect(options.profilesSampleRate).toBe(0);
  expect(options.sendClientReports).toBe(false);
  expect(typeof options.transport).toBe("function");
  expect(options.sendDefaultPii).toBe(false);
  expect(options.tracesSampleRate).toBe(0);
  expect(options.attachScreenshot).toBe(false);
  expect(options.attachViewHierarchy).toBe(false);
  expect(options.replaysSessionSampleRate).toBe(0);
  expect(options.replaysOnErrorSampleRate).toBe(0);
  const hint = { attachments: [{ filename: "private.txt", data: "secret" }] };
  const result = options.beforeSend({ type: undefined, message: "secret" }, hint);
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(hint.attachments).toEqual([]);
  expect(options.beforeBreadcrumb({ message: "secret" })).toBeNull();
  expect(options.beforeSendTransaction({ transaction: "secret" })).toBeNull();
});


test("raw context and breadcrumbs never enter SDK scope", async () => {
  const { sdk, obs } = await setup(); await obs.initObservability();
  await obs.captureError({ message: "synthetic-secret", details: "synthetic-details", code: "23505" }, { receipt: "synthetic-receipt" });
  expect(sdk.withScope).not.toHaveBeenCalled();
  expect(sdk.captureException).toHaveBeenCalledTimes(1);
  expect(sdk.captureException.mock.calls[0]).toHaveLength(1);
  await obs.breadcrumb("synthetic-secret", { token: "synthetic-token" });
  expect(sdk.addBreadcrumb).not.toHaveBeenCalled();
});


test("init wires the final filter around fetch transport with fixed IP policy", async () => {
  const { sdk, obs, transport } = await setup(); await obs.initObservability();
  const guarded = sdk.init.mock.calls[0][0].transport({});
  await guarded.send([{ sdk: { name: "PRIVATE" } }, [
    [{ type: "event" }, { event_id: "0123456789abcdef0123456789abcdef", message: "PRIVATE", sdk: { name: "PRIVATE", version: "PRIVATE" } }],
    [{ type: "attachment" }, "PRIVATE"],
  ]]);
  expect(transport.send).toHaveBeenCalledTimes(1);
  const envelope = transport.send.mock.calls[0][0];
  expect(JSON.stringify(envelope)).not.toContain("PRIVATE");
  expect(envelope[1][0][1].sdk).toEqual({ settings: { infer_ip: "never" } });
  expect(envelope[1]).toHaveLength(1);
});
