// ============================================================================
// palateTags.ts — non-exclusive secondary signal tags.
// ----------------------------------------------------------------------------
// Tags are derived from UserWeeklyData and ranked by signal strength. UI shows
// only the top 3-4 to keep things scannable. Distance tags (Grounded/Roamer)
// use neighborhood count, not raw miles, per spec.
// ============================================================================

import type { Tag, UserWeeklyData } from "./palateTypes";

const MAX_TAGS = 4;

type ScoredTag = { tag: Tag; score: number };

export function deriveTags(d: UserWeeklyData): Tag[] {
  const candidates: ScoredTag[] = [];

  // ---- Distance ------------------------------------------------------------
  // Use neighborhood count + diversity, NOT miles.
  if (d.neighborhoodCount <= 2 || d.neighborhoodDiversity < 0.3) {
    candidates.push({ tag: "Grounded", score: 0.8 - d.neighborhoodDiversity });
  } else if (d.neighborhoodCount >= 4 || d.neighborhoodDiversity > 0.6) {
    candidates.push({ tag: "Roamer", score: d.neighborhoodDiversity });
  }

  // ---- Time of day ---------------------------------------------------------
  const tod = d.timeOfDayDistribution;
  if (tod.brunch >= 0.25) candidates.push({ tag: "Brunch-heavy", score: tod.brunch });
  if (tod.lateNight >= 0.20) candidates.push({ tag: "Late-night", score: tod.lateNight });
  if (tod.lunch >= 0.30 && d.socialDiningSignals.casualSolo >= 0.3) {
    candidates.push({ tag: "Weekday lunch", score: tod.lunch });
  }
  // "Cafe regular" — if breakfast OR brunch is dominant AND cuisine isn't varied
  if ((tod.breakfast + tod.brunch) >= 0.35 && d.cuisineDiversity < 0.5) {
    candidates.push({ tag: "Cafe regular", score: tod.breakfast + tod.brunch });
  }

  // ---- Social --------------------------------------------------------------
  const sds = d.socialDiningSignals;
  if (sds.groupDinner >= 0.30) candidates.push({ tag: "Group dining", score: sds.groupDinner });
  if (sds.casualSolo >= 0.40) candidates.push({ tag: "Solo dining", score: sds.casualSolo });
  if (sds.dateNight >= 0.25) candidates.push({ tag: "Date-night", score: sds.dateNight });
  if (sds.groupDinner >= 0.20 && sds.dateNight < 0.20) {
    candidates.push({ tag: "Friends-first", score: sds.groupDinner });
  }

  // ---- Behavior ------------------------------------------------------------
  if (d.cuisineDiversity >= 0.65) {
    candidates.push({ tag: "High variety", score: d.cuisineDiversity });
  }
  if (d.repeatRate >= 0.55) {
    candidates.push({ tag: "Repeat favorite", score: d.repeatRate });
  }
  if (d.elevatedCategorySignal >= 0.30) {
    candidates.push({ tag: "Trend-aware", score: d.elevatedCategorySignal });
  }
  if (d.reservationOrOccasionSignal >= 0.40) {
    candidates.push({ tag: "Planner", score: d.reservationOrOccasionSignal });
  }
  if (d.repeatRate >= 0.45 && d.cuisineDiversity < 0.4) {
    candidates.push({ tag: "Comfort-driven", score: d.repeatRate });
  }
  if (d.newPlaceRate >= 0.65) {
    candidates.push({ tag: "Stretching lately", score: d.newPlaceRate });
  }
  // Wellness — proxy: low elevated + casual social + cuisine focus
  // (No explicit wellness signal in data; this is a soft proxy. Keep it low score.)
  if (d.cuisineDiversity < 0.4 && d.elevatedCategorySignal < 0.2 && d.normalizedPriceLevel < 0.5) {
    candidates.push({ tag: "Cuisine-focused", score: 0.5 });
  }

  // ---- Pick top N, prevent duplicates ----
  const seen = new Set<Tag>();
  const sorted = candidates
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      if (seen.has(c.tag)) return false;
      seen.add(c.tag);
      return true;
    });

  return sorted.slice(0, MAX_TAGS).map((c) => c.tag);
}
