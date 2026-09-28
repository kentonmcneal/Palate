import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";
import ts from "typescript";

// Run the real module with a mocked SDK and synthetic DSN. Transpiling to
// CommonJS also handles its lazy import without Jest's experimental ESM mode.
async function setup() {
  const sdk = {
    init: jest.fn(),
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
      if (name === "expo-constants") return { default: {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  const source = readFileSync(resolve(__dirname, "../observability.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { sdk, obs: exports };
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
