// ============================================================================
// slate.ts — what the ranker considered, not only what it showed.
// ----------------------------------------------------------------------------
// Every rec event we write today describes something that was DISPLAYED. So
// the app can answer "of the places I put on screen, which got tapped" and can
// never answer "should I have shown something else". That second question is
// the whole of learning to rank: without the candidates that lost, a model
// trained on this data can only re-order the winners, and it inherits every
// bias the current scorer already has. It would learn to agree with itself.
//
// A slate is one row per ranking pass: the top candidates in the order they
// were ranked, their scores, and whether each one made it to the screen. Keyed
// by the same request_id the impressions carry, so a slate and its outcomes
// join without any new plumbing.
//
// It is CHEAPER than what it complements. A pass writes roughly ten impression
// rows at ~470 bytes each; one slate row covers the same pass, carries the
// losers as well, and costs under a kilobyte.
// ============================================================================

import { track } from "../analytics";

/** How many ranked candidates to record. Deep enough that the interesting
 *  losers (the ones that nearly made it) are present; shallow enough that a
 *  200-row pool does not become a 200-row payload. */
export const SLATE_DEPTH = 25;

/**
 * Fraction of ranking passes recorded, 0..1.
 *
 * One today, because six active accounts generate too little to sample away.
 * It is a constant rather than a magic number precisely so it can be lowered
 * when volume justifies it: at scale, slates are the obvious thing to sample,
 * since ten thousand of them answer the same question as a million.
 */
export const SLATE_SAMPLE_RATE = 1;

export type SlateCandidate = {
  google_place_id: string;
  finalScore?: number | null;
  matchScore?: number | null;
};

export type SlateRow = {
  /** google_place_id */
  place: string;
  /** position in the full ranking, 0-based */
  rank: number;
  /** the score that actually ordered the list */
  final: number | null;
  /** the headline % — kept because it and `final` disagree, and the
   *  disagreement is the distance/time/open-now correction */
  match: number | null;
  /** did it reach the screen, or was it ranked and dropped */
  shown: boolean;
};

/** Pure: the payload for one ranking pass. Separated from the fire-and-forget
 *  wrapper so it can be asserted without mocking analytics. */
export function buildSlate(
  ranked: readonly SlateCandidate[],
  shownIds: ReadonlySet<string>,
  depth: number = SLATE_DEPTH,
): SlateRow[] {
  const out: SlateRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ranked.length && out.length < Math.max(0, depth); i++) {
    const c = ranked[i];
    const id = c?.google_place_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      place: id,
      rank: i,
      final: numOrNull(c.finalScore),
      match: numOrNull(c.matchScore),
      shown: shownIds.has(id),
    });
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * True when this pass should be recorded. Takes the roll so the caller stays
 * testable and so the decision is made once per pass rather than per row.
 */
export function shouldRecordSlate(roll: number, rate: number = SLATE_SAMPLE_RATE): boolean {
  if (!(rate > 0)) return false;
  if (rate >= 1) return true;
  return roll < rate;
}

/** Fire-and-forget. Never throws into UX, exactly like every other rec event. */
export function trackSlate(opts: {
  requestId: string;
  surface: string;
  sessionId?: string;
  ranked: readonly SlateCandidate[];
  shownIds: ReadonlySet<string>;
  mood?: string | null;
  poolSize?: number;
  roll?: number;
}): void {
  try {
    if (!shouldRecordSlate(opts.roll ?? Math.random())) return;
    const candidates = buildSlate(opts.ranked, opts.shownIds);
    // A slate with nothing in it describes nothing.
    if (candidates.length === 0) return;
    void track("rec_slate", {
      request_id: opts.requestId,
      surface: opts.surface,
      session_id: opts.sessionId,
      mood: opts.mood ?? null,
      // The full pool size, so a truncated slate is never mistaken for the
      // whole set of candidates when this is read back.
      pool_size: opts.poolSize ?? opts.ranked.length,
      depth: candidates.length,
      candidates,
    });
  } catch {
    // Silent — analytics never block UX.
  }
}
