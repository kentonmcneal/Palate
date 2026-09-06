// ============================================================================
// palateTags.ts — non-exclusive secondary signal tags.
// ----------------------------------------------------------------------------
// Tags are derived from UserWeeklyData and ranked by signal strength. UI shows
// only the top 3-4 to keep things scannable. Distance tags (Grounded/Roamer)
// use neighborhood count, not raw miles, per spec.
//
// The Tag values are KEYS, not copy. They stay as they are in the type union
// and in every test, and TAG_LABEL below is the only place the words a person
// reads live, so a wording change is one edit here and nothing else moves.
// ============================================================================

import type { Tag, UserWeeklyData } from "./palateTypes";

const MAX_TAGS = 4;

// What a person reads for each tag. Written as the thing they did, in their
// own words, because "Roamer" and "Trend-aware" needed a glossary and a
// stranger reading a friend's phone does not have one. Each phrase says what
// the rule under it actually measures: "Trend-aware" fires on fine dining and
// wine bar share, so it says that rather than something about trends.
export const TAG_LABEL: Record<Tag, string> = {
  // Distance (neighborhood count, not miles)
  Grounded: "Stayed in one or two areas",
  Roamer: "Ate all over town",
  // Time of day
  "Brunch-heavy": "Big on brunch",
  "Late-night": "Late nights",
  "Weekday lunch": "Weekday lunches",
  "Cafe regular": "Cafe regular",
  // Social
  "Group dining": "Ate in groups",
  "Solo dining": "Ate alone a lot",
  "Date-night": "Date nights",
  "Friends-first": "Out with friends",
  // Behavior
  "High variety": "Tried a lot of cuisines",
  "Repeat favorite": "Kept going back",
  "Trend-aware": "Fine dining and wine bars",
  Planner: "Dates and group dinners",
  "Comfort-driven": "Stuck with what you know",
  "Stretching lately": "Mostly new places",
  "Wellness-leaning": "Healthy picks",
  "Cuisine-focused": "One or two cuisines",
};

/** The phrase a person reads for a tag key. Falls back to the key itself so
 *  an unknown value renders rather than blanking a chip. */
export function tagLabel(tag: Tag | string): string {
  return (TAG_LABEL as Record<string, string>)[tag] ?? tag;
}

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
