import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";
import ts from "typescript";

// Execute the actual helper with no network-capable fetch or real credentials.
// This verifies sequential metering, not deployed SQL or concurrent reservations.
function harness(options: { tripped?: boolean; readError?: boolean; bumpFailures?: number } = {}) {
  let spend = 0, count = 0, failures = options.bumpFailures ?? 0;
  const fetch = jest.fn(async () => ({ status: 200 }));
  const rpc = jest.fn(async (_name: string, args: { p_micros: number }) => {
    if (failures-- > 0) return { data: null, error: { message: "synthetic failure" } };
    spend += args.p_micros; count++;
    return { data: { new_spend_micros: spend, new_count: count, crossed_warn: false, crossed_trip: false }, error: null };
  });
  const admin = { rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tripped: options.tripped || spend >= 5_000_000 }, error: options.readError ? { message: "synthetic failure" } : null }) }) }) }) };
  const exports: Record<string, any> = {};
  const context = { exports, require: (name: string) => {
    if (name !== "https://esm.sh/@supabase/supabase-js@2") throw new Error(name);
    return { createClient: () => admin };
  }, Deno: { env: { get: () => undefined } }, fetch, console: { error: jest.fn() }, Date };
  const source = readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/google-spend.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return { api: exports, fetch, rpc };
}
test("tripped or unreadable budget makes zero paid requests", async () => {
  for (const options of [{ tripped: true }, { readError: true }]) {
    const h = harness(options);
    expect(await h.api.spendGoogle({ sku: "search_nearby_pro", url: "https://fixture.invalid" })).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  }
});
test("sequential searches stop after at most one call crosses the budget", async () => {
  const h = harness();
  for (let i = 0; i < 200; i++) await h.api.spendGoogle({ sku: "search_nearby_pro", url: "https://fixture.invalid" });
  expect(h.fetch).toHaveBeenCalledTimes(Math.ceil(5_000_000 / h.api.SKU_MICROS.search_nearby_pro));
  expect(h.rpc).toHaveBeenCalledTimes(h.fetch.mock.calls.length);
});
test("metering retry does not repeat the paid fetch", async () => {
  const h = harness({ bumpFailures: 1 });
  await h.api.spendGoogle({ sku: "details_enterprise_atmosphere", url: "https://fixture.invalid" });
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.rpc).toHaveBeenCalledTimes(2);
});
