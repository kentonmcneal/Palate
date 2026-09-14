// Palate — retry a read that failed for a reason that might not repeat.
//
// The push drain was succeeding about a third of the time: over the six hours
// to 06:25 on 2026-09-14 it ran 69 times, worked 21 times, and the rest either
// crashed or wrongly reported the kill switch as off. The first real error
// recovered was {"error":"Gateway Timeout"} — supabase-js receiving a 504 from
// PostgREST, which is a transient condition and not a bug in the caller.
//
// A cron that runs every five minutes and gives up on the first 504 is doing
// the equivalent of never retrying at all, because each tick starts from
// scratch and has the same chance of failing. Retrying the READ inside the run
// turns three independent coin flips into one much better one.
//
// READS ONLY, deliberately. A write that timed out may well have been applied;
// retrying it risks double-applying. Reads are idempotent and safe.

/** Errors worth trying again. Anything else is a real failure — fail fast. */
function isTransient(err: unknown): boolean {
  if (err == null) return false;
  const o = err as Record<string, unknown>;
  const msg = `${typeof o.message === "string" ? o.message : ""}`.toLowerCase();
  const code = `${typeof o.code === "string" ? o.code : ""}`;
  // A permissions or schema error will fail identically every time, and
  // retrying it just delays a real answer by a second.
  if (/^(42|23|22)/.test(code)) return false;
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("gateway") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("connection") ||
    msg.includes("socket") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    code === "" && msg.length > 0 && msg.includes("unavailable")
  );
}

/**
 * Run a supabase-js read up to `tries` times, backing off between attempts.
 *
 * Returns the ORIGINAL result object, not a reshaped one. supabase-js puts
 * different things on it depending on the query — `count` for a head count,
 * `status`, `statusText` — and a helper that forwarded only { data, error }
 * would silently drop them. That is not hypothetical: the first version of
 * this file did exactly that, and it turned the classifier's lifetime-call
 * gate into a permanent 500 because `count` never arrived.
 *
 * Takes a THUNK rather than a builder, because a PostgREST query builder is a
 * thenable that can only be awaited once — reusing one would silently return
 * the first result forever, a retry loop that cannot retry.
 */
export async function retryRead<R extends { error: unknown }>(
  run: () => PromiseLike<R>,
  opts: { tries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<R & { attempts: number }> {
  const tries = opts.tries ?? 3;
  const base = opts.baseDelayMs ?? 250;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let last: R | null = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res: R;
    try {
      res = await run();
    } catch (thrown) {
      // supabase-js normally resolves with { error }, but a network failure
      // below it can still throw. Treat both the same way.
      res = { data: null, error: thrown } as unknown as R;
    }
    last = res;
    if (!res.error) return Object.assign({}, res, { attempts: attempt });
    if (!isTransient(res.error) || attempt === tries) break;
    await sleep(base * attempt);
  }
  return Object.assign({}, last as R, { attempts: tries });
}
