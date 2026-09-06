// ============================================================================
// recommendation/feedback.ts — what the ranker learns from a tap.
// ----------------------------------------------------------------------------
// Pure. The harness and production call the same fold, so a number that
// looks good in a test is the number that ships.
//
// The rule that settles every question about this file: implicit signal is
// PLACE-SCOPED. A click, a directions tap, a save, a pass, an ignored card
// changes the ORDER of that one place on finalScore, by a bounded and
// decaying amount, and never touches the taste graph or the displayed
// "% match". Only things a person says in words or with their feet — a
// confirmed visit, a rating, "Not interested" with a reason — are allowed to
// generalise to places they have never seen.
//
// Why: the founder's real top ten around Memphis is ten American places in
// a three-point band. Let a click on an American card nudge "American" in
// the graph and the ranker trains on its own output: show American, get
// American clicks, learn American, freeze harder. feedback-loop.test.ts
// asserts non-generalisation as exact equality, not a tolerance.
//
// Sizing, measured on the real pool (Tue 19:30, browsing, uncapped final):
// #1 Acre sits 6.6 points above #3 on the strength of a 23-point gem boost,
// and the American cluster under it runs 92-96 with each of those places
// taking its own pass penalty as it gets its turn. #3 to #10 is 4 points;
// #10 to #30 is 10. Four ignored days (-10) is what it takes to move that
// #1 out of the three against a cluster that is also being penalised; two
// (-5) move an ordinary one; nothing here moves a top-ten place out of the
// top thirty.
// ============================================================================

export type FeedbackRow = {
  event: string;
  props: Record<string, unknown> | null;
  created_at: string;
};

export type PlaceFeedback = {
  /** Countable shows with nothing taken that day. One per (place, local
   *  day) at most: five opens of Home in an afternoon is one "seen and
   *  passed", not five. Decayed, 14-day half-life. */
  untaken: number;
  /** Detail page opened from a rec surface. 14-day half-life. */
  clicks: number;
  /** Directions asked for. The strongest intent short of going. 30 days. */
  maps: number;
  /** "Try another" on the hero pick. 14 days. */
  skips: number;
  /** Saved to the wishlist. The freshest save's decayed weight. 60 days. */
  save: number;
  /** When it was last on screen, for the explore slot's "new to you" rule. */
  lastSeenAt: number | null;
};

export type FeedbackLedger = Map<string, PlaceFeedback>;

export const EMPTY_FEEDBACK: FeedbackLedger = new Map();

// Half-lives in days.
const H = { untaken: 14, clicks: 14, maps: 30, skips: 14, save: 60 } as const;

// finalScore points per unit, the cap on the decayed count, and the clamp.
export const FEEDBACK = {
  untaken: -2.5, untakenCap: 4,
  click: 1.5, clickCap: 2,
  maps: 3, mapsCap: 1,
  skip: -3, skipCap: 2,
  save: 3, saveCap: 1,
  min: -10, max: 6,
} as const;

const POSITIVE = new Set(["rec_restaurant_clicked", "rec_stretch_pick_clicked", "rec_restaurant_saved", "rec_maps_opened"]);

/** 0.5^(age/h): a fortnight-old pass is worth half of today's. */
export function decay(ageMs: number, halfLifeDays: number): number {
  const days = Math.max(0, ageMs) / 86_400_000;
  return Math.pow(0.5, days / halfLifeDays);
}

/** The local calendar day an event happened on, for the one-per-day rule. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Fold rec events into per-place counters.
 *
 * `lastVisitAt` (place → ms) lets a visit wipe that place's passes: you saw
 * it three times and then went, so the three shows were not rejections.
 * Positive acts survive a visit; they are simply what led to it.
 */
export function foldFeedback(
  rows: FeedbackRow[],
  now: number,
  opts: { lastVisitAt?: Map<string, number> } = {},
): FeedbackLedger {
  const out: FeedbackLedger = new Map();
  const get = (id: string): PlaceFeedback => {
    let f = out.get(id);
    if (!f) { f = { untaken: 0, clicks: 0, maps: 0, skips: 0, save: 0, lastSeenAt: null }; out.set(id, f); }
    return f;
  };

  // Pass one: which (place, day) had something taken, so a show that day
  // does not also count as a pass.
  const takenDays = new Set<string>();
  for (const r of rows) {
    const id = placeOf(r);
    if (!id) continue;
    if (POSITIVE.has(r.event)) takenDays.add(`${id}|${localDay(r.created_at)}`);
  }

  // Pass two: the counters.
  const seenDays = new Set<string>();
  for (const r of rows) {
    const id = placeOf(r);
    if (!id) continue;
    const at = new Date(r.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    const age = now - at;
    const afterVisit = (opts.lastVisitAt?.get(id) ?? -Infinity) < at;

    switch (r.event) {
      case "rec_restaurant_viewed": {
        const f = get(id);
        if (f.lastSeenAt == null || at > f.lastSeenAt) f.lastSeenAt = at;
        const dayKey = `${id}|${localDay(r.created_at)}`;
        if (takenDays.has(dayKey) || seenDays.has(dayKey)) break;
        seenDays.add(dayKey);
        if (afterVisit) f.untaken += decay(age, H.untaken);
        break;
      }
      case "rec_restaurant_clicked":
      case "rec_stretch_pick_clicked":
        get(id).clicks += decay(age, H.clicks);
        break;
      case "rec_maps_opened":
        get(id).maps += decay(age, H.maps);
        break;
      case "rec_try_another": {
        if (afterVisit) get(id).skips += decay(age, H.skips);
        break;
      }
      case "rec_restaurant_saved": {
        const f = get(id);
        f.save = Math.max(f.save, decay(age, H.save));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function placeOf(r: FeedbackRow): string | null {
  const id = r.props?.google_place_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * The finalScore adjustment for one place. Returns 0 (never -0) for a
 * place the user has not interacted with, and never leaves [min, max].
 */
export function feedbackAdjustment(ledger: FeedbackLedger, googlePlaceId: string): number {
  const f = ledger.get(googlePlaceId);
  if (!f) return 0;
  const d =
    FEEDBACK.untaken * Math.min(FEEDBACK.untakenCap, f.untaken) +
    FEEDBACK.click * Math.min(FEEDBACK.clickCap, f.clicks) +
    FEEDBACK.maps * Math.min(FEEDBACK.mapsCap, f.maps) +
    FEEDBACK.skip * Math.min(FEEDBACK.skipCap, f.skips) +
    FEEDBACK.save * Math.min(FEEDBACK.saveCap, f.save);
  return Math.max(FEEDBACK.min, Math.min(FEEDBACK.max, d)) || 0;
}

/** The events the fold reads. The loader asks for exactly these. */
export const FEEDBACK_EVENTS = [
  "rec_restaurant_viewed",
  "rec_restaurant_clicked",
  "rec_stretch_pick_clicked",
  "rec_restaurant_saved",
  "rec_maps_opened",
  "rec_try_another",
] as const;

/** How far back the loader reads. Four half-lives of the longest-lived
 *  counter except save, whose residual past 60 days is a nudge anyway; and
 *  well inside the 180-day analytics prune so truncation never changes a
 *  weight silently. */
export const FEEDBACK_WINDOW_DAYS = 60;

// ----------------------------------------------------------------------------
// Resting
// ----------------------------------------------------------------------------
// A bounded penalty on its own cannot rotate the strongest place off a
// three-row Home. Simulated on the real pool with nothing but ignored days,
// Acre (raw 103, seven points clear of the cluster on a gem boost) was in the
// three on 27 of 30 days: every place under it takes its own pass penalty as
// it gets its turn, the whole cluster settles at the clamp, and the raw
// order comes straight back. So alongside the score there is a shortlist
// RULE, like the cuisine cap: a place ignored three days running sits the
// next few out, and returns as those passes decay. Scores decide order;
// this decides who is eligible today.
export const REST_AT = 3;

export function isResting(ledger: FeedbackLedger, googlePlaceId: string): boolean {
  return (ledger.get(googlePlaceId)?.untaken ?? 0) >= REST_AT;
}
