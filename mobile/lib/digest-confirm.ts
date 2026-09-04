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
};

/** Mirrors passive-confirm's outcome union without importing it (avoids a cycle). */
export type PromptOutcome = "confirmed" | "skip_today" | "dismissed" | "wrong_place" | "ignored";

export type ConfirmDeps = {
  saveVisit: (a: { googlePlaceId: string; visitedAt: Date; source: "auto" })
    => Promise<{ id?: string } | null>;
  removeFromInbox: (id: string) => Promise<void>;
  recordPromptDecision: (placeId: string, decision: PromptOutcome) => Promise<void>;
  track: (name: string, props?: Record<string, unknown>) => void;
};

export type ConfirmResult = {
  /** Visit ids written, in order. */
  savedIds: string[];
  /** Entries whose save failed. They are still in the inbox, still actionable. */
  failed: { id: string; name: string }[];
};

export async function confirmDigest(
  confirmed: ConfirmableEntry[],
  skipped: ConfirmableEntry[],
  resolvedChoice: Record<string, { google_place_id: string } | undefined>,
  deps: ConfirmDeps,
): Promise<ConfirmResult> {
  const savedIds: string[] = [];
  const failed: { id: string; name: string }[] = [];

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

      // Durable now, so the entry is finished. Everything below is bookkeeping
      // and is individually swallowed: none of it may put the entry back.
      await deps.removeFromInbox(entry.id).catch(() => {});
      await deps.recordPromptDecision(placeId, chosen ? "wrong_place" : "confirmed")
        .catch(() => {});
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
    await deps.recordPromptDecision(entry.place_id, "dismissed").catch(() => {});
    await deps.removeFromInbox(entry.id).catch(() => {});
  }

  return { savedIds, failed };
}
