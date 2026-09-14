import { retryRead } from "../../../supabase/functions/_shared/retry";

const noSleep = async () => {};
const GATEWAY = { message: "Gateway Timeout", code: "", details: "", hint: "" };
const DENIED = { message: "permission denied for table push_outbox", code: "42501" };

function sequence(...results: { data: unknown; error: unknown }[]) {
  let i = 0;
  const calls: number[] = [];
  const run = () => {
    calls.push(++i);
    return Promise.resolve(results[Math.min(i - 1, results.length - 1)] as never);
  };
  return { run, callCount: () => calls.length };
}

describe("retryRead", () => {
  it("returns immediately when the first read works", async () => {
    const s = sequence({ data: [1], error: null });
    const r = await retryRead(s.run, { sleep: noSleep });
    expect(r.data).toEqual([1]);
    expect(r.error).toBeNull();
    expect(s.callCount()).toBe(1);
  });

  // The failure that started this: a 504 from PostgREST, which supabase-js
  // surfaces as a bare message with empty code/details/hint.
  it("retries a Gateway Timeout and succeeds on a later attempt", async () => {
    const s = sequence({ data: null, error: GATEWAY }, { data: ["ok"], error: null });
    const r = await retryRead(s.run, { sleep: noSleep });
    expect(r.data).toEqual(["ok"]);
    expect(r.error).toBeNull();
    expect(r.attempts).toBe(2);
  });

  it("gives up after the configured number of tries", async () => {
    const s = sequence({ data: null, error: GATEWAY });
    const r = await retryRead(s.run, { tries: 3, sleep: noSleep });
    expect(r.error).toBe(GATEWAY);
    expect(s.callCount()).toBe(3);
  });

  // A permissions error fails identically every time. Retrying it only delays
  // a real answer and hides the cause behind a slower failure.
  it("does not retry a permissions error", async () => {
    const s = sequence({ data: null, error: DENIED });
    const r = await retryRead(s.run, { sleep: noSleep });
    expect(r.error).toBe(DENIED);
    expect(s.callCount()).toBe(1);
  });

  // supabase-js normally resolves with { error }, but the fetch beneath it can
  // still throw. Both must be handled the same way or the drain crashes.
  it("treats a thrown network failure as a retryable result", async () => {
    let n = 0;
    const run = () => {
      if (++n === 1) return Promise.reject(new Error("fetch failed")) as never;
      return Promise.resolve({ data: ["ok"], error: null }) as never;
    };
    const r = await retryRead(run, { sleep: noSleep });
    expect(r.data).toEqual(["ok"]);
    expect(n).toBe(2);
  });

  it("gives up on a thrown error that is not transient", async () => {
    const run = () => Promise.reject(new Error("column does not exist")) as never;
    const r = await retryRead(run, { tries: 3, sleep: noSleep });
    expect(r.data).toBeNull();
    expect(r.error).toBeInstanceOf(Error);
  });

  // A PostgREST query builder is a thenable that resolves ONCE. Taking a
  // builder instead of a thunk would re-await the same settled promise and
  // return the first failure forever, which looks exactly like a retry that
  // does not work.
  it("calls the thunk afresh each attempt rather than re-awaiting one promise", async () => {
    let built = 0;
    const run = () => {
      built++;
      return Promise.resolve(
        (built < 3 ? { data: null, error: GATEWAY } : { data: ["ok"], error: null }) as never,
      );
    };
    const r = await retryRead(run, { tries: 3, sleep: noSleep });
    expect(built).toBe(3);
    expect(r.data).toEqual(["ok"]);
  });

  it("backs off for longer on each successive attempt", async () => {
    const waits: number[] = [];
    const s = sequence({ data: null, error: GATEWAY });
    await retryRead(s.run, { tries: 3, baseDelayMs: 100, sleep: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([100, 200]);
  });
});
