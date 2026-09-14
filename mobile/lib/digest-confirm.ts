// ============================================================================
// digest-confirm.ts — applying a completed digest, in an order that cannot
// lose a visit.
// ----------------------------------------------------------------------------
// This was inline in app/digest.tsx, where `removeFromInbox` sat OUTSIDE the
// try that wrapped `saveVisit`. So a user ticked "yes, I ate here", the save
// failed on a flaky connection, and the entry was dropped from the inbox
// anyway: no visit written, nothing left to retry, and no indication that
// anything had gone wrong. The digest is the one moment the user actively gives
// us data, which makes it the worst possible place to drop it.
//
// The rule enforced here: an entry leaves the inbox only after the thing it
// represents has been durably recorded. Telemetry and decision-logging run
// AFTER the removal and can never cause it to be skipped — a failed analytics
// call must not resurrect a visit that was already saved, because the retry
// would write it twice.
// ============================================================================

export type ConfirmableEntry = {
  id: string;
  name: string;
  place_id: string;
  detectedAt: number;
  band?: string;
  confidence?: number | null;
  dwellMin?: number;
  candidateCount?: number | null;
  /**
   * Where the STOP was. Carried so a refusal is recorded against a POSITION
   * rather than a brand — the Panda Express across a Walmart car park is the
   * wrong answer from inside that Walmart and the right one from its own
   * doorway (migration 0145).
   *
   * This type did not declare them and confirmDigest never passed them on, so
   * every prompt_decision ever written has a null lat and lng: 110 rows, none
   * with a position. The realtime confirm screens DO pass a position, but
   * REALTIME_PROMPTS_ENABLED is false, so the only path that runs in
   * production was the only one that dropped it. 0145's own comment predicted
   * exactly this — "prompt_decisions.lat stays null forever and nothing is
   * ever learned about a spot" — and it was right for three days.
   */
  stopLat?: number | null;
  stopLng?: number | null;
};

/** Mirrors passive-confirm's outcome union without importing it (avoids a cycle). */
export type PromptOutcome = "confirmed" | "skip_today" | "dismissed" | "wrong_place" | "ignored";

export type VisitRating = "loved" | "ok" | "not_for_me";

export type ConfirmDeps = {
  saveVisit: (a: { googlePlaceId: string; visitedAt: Date; source: "auto" })
    => Promise<{ id?: string } | null>;
  removeFromInbox: (id: string) => Promise<void>;
  recordPromptDecision: (
    placeId: string,
    decision: PromptOutcome,
    at?: { lat: number; lng: number } | null,
  ) => Promise<void>;
  track: (name: string, props?: Record<string, unknown>) => void;
  /** Optional: only needed when the caller collected a reaction. */
  rateVisit?: (visitId: string, rating: VisitRating) => Promise<void>;
};

/** The stop position, when the entry carries one. Entries written before 0145
 *  do not, and a missing position must mean "record it without one" rather
 *  than dropping the decision entirely. */
function stopOf(e: ConfirmableEntry): { lat: number; lng: number } | null {
  return typeof e.stopLat === "number" && typeof e.stopLng === "number"
    ? { lat: e.stopLat, lng: e.stopLng }
    : null;
}

export type ConfirmResult = {
  /** Visit ids written, in order. */
  savedIds: string[];
  /** How many of them carried a reaction. Telemetry for whether asking works. */
  ratedCount: number;
  /** Entries whose save failed. They are still in the inbox, still actionable. */
  failed: { id: string; name: string }[];
};

export async function confirmDigest(
  confirmed: ConfirmableEntry[],
  skipped: ConfirmableEntry[],
  resolvedChoice: Record<string, { google_place_id: string } | undefined>,
  deps: ConfirmDeps,
  /**
   * A reaction per entry id, when the person gave one. Optional on purpose:
   * the digest's job is to confirm that a meal happened, and it has to keep
   * working for somebody who taps Confirm without rating anything.
   */
  ratings: Record<string, VisitRating | undefined> = {},
): Promise<ConfirmResult> {
  const savedIds: string[] = [];
  const failed: { id: string; name: string }[] = [];
  let ratedCount = 0;

  for (const entry of confirmed) {
    const chosen = resolvedChoice[entry.id];
    const placeId = chosen?.google_place_id ?? entry.place_id;
    try {
      const saved = await deps.saveVisit({
        googlePlaceId: placeId,
        visitedAt: new Date(entry.detectedAt),
        source: "auto",
      });
      if (saved?.id) savedIds.push(saved.id);

      // The reaction, if there is one. Swallowed like the rest of the
      // bookkeeping below: a rating that fails to save must never cost the
      // visit it was about, and the visit is already durable at this point.
      const rating = ratings[entry.id];
      if (rating && saved?.id && deps.rateVisit) {
        const ok = await deps.rateVisit(saved.id, rating).then(() => true).catch(() => false);
        if (ok) {
          ratedCount++;
          deps.track("visit_rated", { place_id: placeId, rating, surface: "digest" });
        }
      }

      // Durable now, so the entry is finished. Everything below is bookkeeping
      // and is individually swallowed: none of it may put the entry back.
      await deps.removeFromInbox(entry.id).catch(() => {});
      // Against the place we GUESSED, not the one they corrected us to.
      //
      // placeId is the corrected venue. Recording "wrong_place" there told the
      // learning system that the restaurant the person just confirmed eating
      // at was a bad guess -- demoting the right answer -- while the venue we
      // actually got wrong was never marked at all, so it stayed just as
      // likely to be guessed again tomorrow. Exactly backwards, in the one
      // path whose entire purpose is learning from a correction.
      await deps.recordPromptDecision(
        chosen ? entry.place_id : placeId,
        chosen ? "wrong_place" : "confirmed",
        stopOf(entry),
      ).catch(() => {});
      deps.track(chosen ? "confirm_corrected" : "confirm_yes", {
        place_id: placeId,
        surface: "digest",
        confidence: entry.confidence ?? null,
        confidence_band: entry.band,
        dwell_min: entry.dwellMin != null ? Math.round(entry.dwellMin) : null,
        candidate_count: entry.candidateCount ?? null,
      });
    } catch {
      // Kept in the inbox on purpose. One bad save must not lose the rest of
      // the day, and it must not lose itself either.
      failed.push({ id: entry.id, name: entry.name });
    }
  }

  // Unchecked entries are an answer too, and the calibration denominator needs
  // them: a High row left unticked is exactly the signal that the pre-check
  // threshold is too generous. Nothing is written for these, so there is no
  // save that can fail and removal is unconditional.
  for (const entry of skipped) {
    deps.track("confirm_no", {
      place_id: entry.place_id,
      surface: "digest",
      confidence: entry.confidence ?? null,
      confidence_band: entry.band,
    });
    await deps.recordPromptDecision(entry.place_id, "dismissed", stopOf(entry)).catch(() => {});
    await deps.removeFromInbox(entry.id).catch(() => {});
  }

  return { savedIds, ratedCount, failed };
}
