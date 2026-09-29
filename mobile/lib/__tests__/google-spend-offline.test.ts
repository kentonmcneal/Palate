import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";
import ts from "typescript";

// Execute the actual helper with no network-capable fetch or real credentials.
// The shared fake models the SQL RPC's serialized increment, not live Postgres.
type Meter = { spend: number; count: number };
function harness(options: {
  tripped?: boolean; readError?: boolean; readThrows?: boolean;
  bumpFailures?: number; bumpThrows?: boolean; committedFailure?: boolean;
  malformedReservation?: boolean; fetchThrows?: boolean; staleRead?: boolean;
  budget?: string; initialSpend?: number; missingRow?: boolean; malformedSpend?: boolean;
  meter?: Meter; reservationResult?: unknown; httpStatus?: number;
} = {}) {
  const meter = options.meter ?? { spend: options.initialSpend ?? 0, count: 0 };
  let failures = options.bumpFailures ?? 0;
  const events: string[] = [];
  const fetch = jest.fn(async () => {
    events.push("fetch");
    if (options.fetchThrows) throw new Error("synthetic transport failure");
    return { status: options.httpStatus ?? 200 };
  });
  const rpc = jest.fn(async (_name: string, args: { p_micros: number }) => {
    events.push("reserve");
    if (options.bumpThrows) throw new Error("synthetic RPC failure");
    const fail = failures-- > 0;
    if (!fail || options.committedFailure) { meter.spend += args.p_micros; meter.count++; }
    if (fail) return { data: null, error: { message: "synthetic failure" } };
    if (options.malformedReservation) return { data: {}, error: null };
    if ("reservationResult" in options) return { data: options.reservationResult, error: null };
    return { data: { new_spend_micros: meter.spend, new_count: meter.count, crossed_warn: false, crossed_trip: false }, error: null };
  });
  const admin = { rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
    if (options.readThrows) throw new Error("synthetic read failure");
    return {
      data: options.missingRow ? null : {
        tripped: options.tripped || (!options.staleRead && meter.spend >= 5_000_000),
        spend_micros: options.malformedSpend ? undefined : options.staleRead ? 0 : meter.spend,
      }, error: options.readError ? { message: "synthetic failure" } : null,
    };
  } }) }) }) };
  const exports: Record<string, any> = {};
  const context = { exports, require: (name: string) => {
    if (name !== "https://esm.sh/@supabase/supabase-js@2") throw new Error(name);
    return { createClient: () => admin };
  }, Deno: { env: { get: (key: string) => key === "GOOGLE_DAILY_BUDGET_USD" ? options.budget : undefined } }, fetch, console: { error: jest.fn() }, Date };
  const source = readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/google-spend.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return { api: exports, fetch, rpc, events, meter };
}
test("tripped or unreadable budget makes zero paid requests", async () => {
  for (const options of [{ tripped: true }, { readError: true }]) {
    const h = harness(options);
    expect(await h.api.spendGoogle({ sku: "search_nearby_pro", url: "https://fixture.invalid" })).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  }
});
test("sequential searches refuse a call that would exceed the budget", async () => {
  const h = harness();
  for (let i = 0; i < 200; i++) await h.api.spendGoogle({ sku: "search_nearby_pro", url: "https://fixture.invalid" });
  expect(h.fetch).toHaveBeenCalledTimes(Math.floor(5_000_000 / h.api.SKU_MICROS.search_nearby_pro));
  expect(h.rpc).toHaveBeenCalledTimes(h.fetch.mock.calls.length);
});
test("metering retry does not repeat the paid fetch", async () => {
  const h = harness({ bumpFailures: 1 });
  await h.api.spendGoogle({ sku: "details_enterprise_atmosphere", url: "https://fixture.invalid" });
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.rpc).toHaveBeenCalledTimes(2);
});

 test("invalid or disabled budgets refuse spending before any request", async () => {
  for (const budget of ["", "nope", "NaN", "Infinity", "-1", "0", "0.0000001", "100000000000"]) {
    const h = harness({ budget });
    expect(await h.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" })).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  }
});
test("lowered cap and missing meter fail closed without a trip flag", async () => {
  for (const options of [{ budget: "1", initialSpend: 1_100_000 }, { malformedSpend: true }]) {
    const h = harness(options);
    expect(await h.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" })).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  }
});
test("first call must fit, and an exactly fitting call is allowed", async () => {
  const tooSmall = harness({ budget: "0.016", missingRow: true });
  expect(await tooSmall.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" })).toBeNull();
  expect(tooSmall.fetch).not.toHaveBeenCalled();
  const exact = harness({ budget: "0.017" });
  expect(await exact.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" })).not.toBeNull();
  expect(await exact.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" })).toBeNull();
  expect(exact.fetch).toHaveBeenCalledTimes(1);
});

test("a successful reservation always precedes fetch", async () => {
  const h = harness();
  await h.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" });
  expect(h.events).toEqual(["reserve", "fetch"]);
});
test("concurrent workers with stale preflight reads cannot fetch beyond the cap", async () => {
  const meter = { spend: 0, count: 0 };
  const workers = [harness({ meter, staleRead: true }), harness({ meter, staleRead: true })];
  await Promise.all(Array.from({ length: 250 }, (_, i) => workers[i % 2].api.spendGoogle({ sku: "search_nearby_pro", url: "https://fixture.invalid" })));
  const requests = workers.reduce((n, h) => n + h.fetch.mock.calls.length, 0);
  expect(requests).toBe(Math.floor(5_000_000 / 32_000));
  expect(requests * 32_000).toBeLessThanOrEqual(5_000_000);
  // Rejected racing reservations may exceed the cap; paid requests do not.
  expect(meter.spend).toBeGreaterThan(5_000_000);
});
test("unconfirmed reservations and thrown reads never perform a Google fetch", async () => {
  for (const options of [{ bumpFailures: 2 }, { bumpThrows: true }, { malformedReservation: true }, { readThrows: true }]) {
    const h = harness(options);
    expect(await h.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" })).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  }
});
test("lost RPC reply may reserve twice but cannot trigger an over-budget fetch", async () => {
  const h = harness({ budget: "0.025", bumpFailures: 1, committedFailure: true });
  expect(await h.api.spendGoogle({ sku: "details_enterprise_atmosphere", url: "https://fixture.invalid" })).toBeNull();
  expect(h.meter.spend).toBe(50_000);
  expect(h.fetch).not.toHaveBeenCalled();
});
test("a thrown fetch retains its reservation and is never retried by the helper", async () => {
  const h = harness({ budget: "0.025", fetchThrows: true });
  await expect(h.api.spendGoogle({ sku: "details_enterprise_atmosphere", url: "https://fixture.invalid" })).rejects.toThrow("synthetic transport failure");
  expect(h.meter.spend).toBe(25_000);
  expect(await h.api.spendGoogle({ sku: "details_enterprise_atmosphere", url: "https://fixture.invalid" })).toBeNull();
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test("malformed reservation totals cannot authorize spending", async () => {
  const valid = { new_spend_micros: 17_000, new_count: 1, crossed_warn: false, crossed_trip: false };
  const invalid = [null, [], [valid, valid], {}, ...[null, undefined, "17000", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 16_999].map(total => ({ ...valid, new_spend_micros: total }))];
  for (const reservationResult of invalid) {
    const h = harness({ reservationResult });
    expect(await h.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" })).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  }
  const h = harness({ reservationResult: [valid] });
  expect(await h.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" })).not.toBeNull();
});
test("HTTP errors retain the reservation without retrying the request", async () => {
  for (const httpStatus of [429, 500]) {
    const h = harness({ budget: "0.017", httpStatus });
    expect((await h.api.spendGoogle({ sku: "details_pro", url: "https://fixture.invalid" })).status).toBe(httpStatus);
    expect(h.meter.spend).toBe(17_000);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  }
});
test("concurrent mixed SKUs remain bounded by their combined assigned cost", async () => {
  const h = harness({ staleRead: true, budget: "1" });
  const skus = ["details_pro", "details_enterprise_atmosphere", "search_nearby_pro"];
  const results = await Promise.all(Array.from({ length: 100 }, async (_, i) => {
    const sku = skus[i % skus.length];
    const response = await h.api.spendGoogle({ sku, url: "https://fixture.invalid" });
    return response ? h.api.SKU_MICROS[sku] : 0;
  }));
  expect(results.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(1_000_000);
  expect(h.fetch.mock.calls.length).toBeGreaterThan(0);
});
