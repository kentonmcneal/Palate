// Palate — who gets a slot when a person's daily push budget is scarce.
//
// Extracted from send-push so the admission rules can be tested. The drain
// itself is Deno + network + Expo; this is the part that decides, and it is
// pure: rows in, a verdict per row out.
//
// WHY CLASSES AND NOT ONE COUNTER
//
// A single per-user daily counter means every class of push starves every
// other for reasons that have nothing to do with the other. send-push already
// learned this once: a real message from a real person was being deferred
// twenty-four hours behind three "somebody you follow ate somewhere"
// broadcasts, so correspondence got its own, higher ceiling.
//
// The same split is needed one level down, and production showed it. Over the
// nine days to 2026-09-14 the outbox delivered sixteen "someone joined Palate"
// pushes and exactly one "someone you follow ate somewhere" — with ten of the
// latter dropped. The two most recent drops each had three sent pushes in the
// preceding twenty-four hours, all three of them user_joined.
//
// That is not bad luck, and it is not a matter of taste. user_joined is the
// only type that fans out to the WHOLE user base on a single event: one signup
// enqueues a row for every existing account. Its volume grows as
// (signups x users), while every other type grows with the recipient's own
// social graph. Put it in a shared budget and it is structurally guaranteed to
// crowd out everything else, and strictly more so as the app grows — the exact
// opposite of what a launch needs.
//
// So announcements get their own ceiling of one a day. You still learn the app
// is growing; it no longer costs the social loop its slot.

/** At most this many ambient pushes per user per day. */
export const MAX_AMBIENT_PER_USER_PER_DAY = 3;
/** Correspondence: someone wrote to you, by name, and is waiting. */
export const MAX_DIRECT_PER_USER_PER_DAY = 25;
/** "Someone joined." True once, worth little twice, worth nothing thrice. */
export const MAX_ANNOUNCE_PER_USER_PER_DAY = 1;

// LIKES ARE NOT DIRECT, deliberately. A heart is a reaction, not a message. It
// is exactly the ambient stream the daily cap exists to ration, and fifteen
// people liking a post should not cost somebody fifteen buzzes.
export const DIRECT_TYPES = ["dm_message", "post_comment", "comment_reply"] as const;
export const ANNOUNCE_TYPES = ["user_joined"] as const;

const DIRECT = new Set<string>(DIRECT_TYPES);
const ANNOUNCE = new Set<string>(ANNOUNCE_TYPES);

export type PushClass = "direct" | "announce" | "ambient";

export const CEILINGS: Record<PushClass, number> = {
  direct: MAX_DIRECT_PER_USER_PER_DAY,
  announce: MAX_ANNOUNCE_PER_USER_PER_DAY,
  ambient: MAX_AMBIENT_PER_USER_PER_DAY,
};

export type QuotaRow = {
  id: string;
  user_id: string;
  data?: Record<string, unknown> | null;
  /** Broadcast news is perishable; visit confirmations are not (null). */
  expires_at?: string | null;
};

/** Ambient is the default: an unknown type is rationed, never privileged. */
export function classOf(row: { data?: Record<string, unknown> | null }): PushClass {
  const t = row.data?.type;
  if (typeof t !== "string") return "ambient";
  if (DIRECT.has(t)) return "direct";
  if (ANNOUNCE.has(t)) return "announce";
  return "ambient";
}

export type Verdict = {
  /** Send now. */
  admit: QuotaRow[];
  /** Over ceiling, but durable enough to be worth asking again tomorrow. */
  defer: string[];
  /** Over ceiling and stale before it would next be tried. Drop it. */
  expire: string[];
};

/**
 * Order rows so a scarce slot goes to the row that loses the most by waiting.
 *
 * The drain fetches by `send_after` ascending, which is arrival order. Arrival
 * order gives the slot to whichever row happens to be oldest — so a
 * seventy-two hour announcement from two days ago outranks a twelve hour
 * "your friend just ate somewhere" from an hour ago, and the perishable row is
 * the one that gets dropped. That is backwards, so sort by how soon the row
 * dies rather than by when it arrived.
 *
 * Rows with no expiry (visit confirmations) sort FIRST, not last: never
 * expiring means important, not discardable.
 */
export function byPerishability(a: QuotaRow, b: QuotaRow): number {
  const av = a.expires_at == null ? -1 : new Date(a.expires_at).getTime();
  const bv = b.expires_at == null ? -1 : new Date(b.expires_at).getTime();
  return av - bv;
}

/**
 * Decide each row's fate against the recipient's remaining daily budget.
 *
 * `sentByClass` is what the user has ALREADY received in the trailing 24h,
 * keyed class -> user_id -> count. Enforced on receipt rather than at enqueue
 * time, because what matters is what a person actually got.
 */
export function admit(
  rows: QuotaRow[],
  sentByClass: Record<PushClass, Map<string, number>>,
  nowMs: number,
): Verdict {
  const out: Verdict = { admit: [], defer: [], expire: [] };
  const thisRun: Record<PushClass, Map<string, number>> = {
    direct: new Map(),
    announce: new Map(),
    ambient: new Map(),
  };

  for (const r of [...rows].sort(byPerishability)) {
    const cls = classOf(r);
    const already = (sentByClass[cls].get(r.user_id) ?? 0) + (thisRun[cls].get(r.user_id) ?? 0);
    if (already >= CEILINGS[cls]) {
      // Deferring past the row's own expiry is a slower way of dropping it.
      // An announcement is never worth deferring: "someone joined three days
      // ago" is worth nothing, and trickling a signup burst out one a day for
      // three days is the stale backlog this whole mechanism exists to avoid.
      const diesFirst = r.expires_at != null && new Date(r.expires_at).getTime() < nowMs + 24 * 3600 * 1000;
      if (cls === "announce" || diesFirst) out.expire.push(r.id);
      else out.defer.push(r.id);
      continue;
    }
    thisRun[cls].set(r.user_id, (thisRun[cls].get(r.user_id) ?? 0) + 1);
    out.admit.push(r);
  }
  return out;
}
