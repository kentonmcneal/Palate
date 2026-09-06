// ============================================================================
// palateCopy.ts — all the user-facing strings for the Palate identity system.
// ----------------------------------------------------------------------------
// One test for every line here: somebody who has never used the app, reading
// it on a friend's phone, understands it on first read. So the copy talks
// about what the person did ("4 of 6 visits were somewhere new"), never about
// the model that noticed it: no axes, scores, signals, lanes or eras. The
// identity names are the brand and may appear, but only as a badge with the
// plain meaning next to it, never as an adjective inside a sentence.
// Always says "this week", never "you are permanently X".
// ============================================================================

import { IDENTITY_NAME, identityTitle, Indefinite } from "./palateNames";
import { tagLabel } from "./palateTags";
import type {
  PrimaryIdentity, UserWeeklyData, PalateProfile, Tag,
} from "./palateTypes";

type Named = Exclude<PrimaryIdentity, "Learning">;
type Direction = NonNullable<PalateProfile["movement"]>["direction"];

/** Visits in a week before the app will name a Palate. This mirrors
 *  MIN_VISITS_FOR_CLASSIFY in palateScoring. Scoring imports this module, so
 *  the number lives in both files rather than in an import cycle, and the
 *  copy test pins the two together. */
export const VISITS_TO_NAME = 4;

/** One card's worth of story: a headline, a body of at most two short
 *  sentences, and an optional footer line. */
export type StoryCopy = { headline: string; body: string; footer?: string };

// ----------------------------------------------------------------------------
// Identity descriptions — used on the "What are Palates?" explainer.
// Copy locked per design bible: short, observational, slightly editorial.
// ----------------------------------------------------------------------------
// Four identities, written so a person would argue about which one they are.
// The old blurbs all reduced to "you like food": each of these names the
// thing the OTHER three would not do.
export const IDENTITY_BLURB: Record<PrimaryIdentity, { tagline: string; description: string; shareDescriptor: string }> = {
  Curator: {
    tagline: "New places, but only the ones worth a reservation.",
    description: `You go somewhere new most weeks and you research it first. ${Indefinite(IDENTITY_NAME.Forager)} would walk into the next door down; you would not. ${Indefinite(IDENTITY_NAME.Steward)} would go back to last month's find; you already have the next one booked.`,
    shareDescriptor: "New places, chosen on purpose.",
  },
  Forager: {
    tagline: "Anywhere new. Bonus points if nobody has heard of it.",
    description: `Variety is the whole point. You repeat almost nothing, you do not need the room to be nice, and the counter with three stools beats the place with the wait list. ${Indefinite(IDENTITY_NAME.Curator)} would check the reviews. You are already inside.`,
    shareDescriptor: "Never the same place twice.",
  },
  Steward: {
    tagline: "A short list, and you keep it sharp.",
    description: `You have found your places and you go back, deliberately. Not out of habit, out of judgement: a new spot has to beat the list to get on it, and most do not. ${IDENTITY_NAME.Anchor}s return for comfort. You return because you were right.`,
    shareDescriptor: "Returns to the right places.",
  },
  Anchor: {
    tagline: "The regulars know your order.",
    description: `Same few spots, casual, dependable, and you would not have it any other way. The point of dinner is not the search. ${Indefinite(IDENTITY_NAME.Forager)} finds this baffling. You find the ${IDENTITY_NAME.Forager} exhausting.`,
    shareDescriptor: "A few favorite spots, on repeat.",
  },
  Learning: {
    tagline: "Not enough visits to say yet.",
    description: `It takes ${VISITS_TO_NAME} visits in a week. Once you have them, your Palate fills in: the kind of places you eat and how often you try somewhere new.`,
    shareDescriptor: "Not enough visits to say yet.",
  },
};

// ----------------------------------------------------------------------------
// What each identity actually did this week, said the way the person would
// say it. The badge carries the name; these carry the meaning.
// ----------------------------------------------------------------------------
const DID_THIS: Record<Named, string> = {
  Curator: "You went somewhere new and picked it carefully.",
  Forager: "You mostly went somewhere new, and kept it casual.",
  Steward: "You went back to a short list of places you trust.",
  Anchor: "You stuck to your usual spots and kept it casual.",
};

// The same four, as a trailing "also" for a week that was mostly one thing
// with a bit of another. No number is claimed because none is measured.
const SOME_OF: Record<Named, string> = {
  Curator: "some carefully picked new places",
  Forager: "some new casual spots",
  Steward: "some returns to places you trust",
  Anchor: "some of your usual spots",
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The line for a week the app cannot name yet. Says the number it has and
 *  the number it needs, which is the only thing the person can act on. */
export function composeLearningLine(totalVisits: number): string {
  const need = `It takes ${VISITS_TO_NAME} to name your Palate.`;
  if (totalVisits <= 0) return `No visits this week yet. ${need}`;
  return `${plural(totalVisits, "visit")} this week. ${need}`;
}

export function composeExplanation(
  primary: PrimaryIdentity,
  secondary: PrimaryIdentity | undefined,
  // The axis scores used to pick between three intensities of the same
  // sentence ("moved like a", "leaned", "leaned slightly"). That was the model
  // describing its own confidence. The person gets the measured line instead,
  // so the scores are accepted for the call site and not read.
  _scores: { novelty: number; premium: number },
  data: UserWeeklyData,
): string {
  if (primary === "Learning") return composeLearningLine(data.totalVisits);

  // A week near the line between two identities: say the main thing, then
  // the other thing, without naming either.
  if (secondary && secondary !== "Learning") {
    return `${DID_THIS[primary]} Also ${SOME_OF[secondary]}.`;
  }

  return `${DID_THIS[primary]} ${secondLine(primary, data)}`;
}

function secondLine(primary: Named, d: UserWeeklyData): string {
  if (primary === "Curator") {
    if (d.reservationOrOccasionSignal >= 0.4) return "Several were date nights or group dinners.";
    return "Not many, and every one chosen on purpose.";
  }
  if (primary === "Forager") {
    if (d.cuisineDiversity >= 0.6) return "Lots of different cuisines, almost no repeats.";
    return "Almost no repeats, and no need for a nice room.";
  }
  if (primary === "Steward") {
    if (d.repeatRate >= 0.5) return "More than half your visits were returns.";
    return "Fewer visits, but the right ones.";
  }
  // Anchor
  if (d.repeatRate >= 0.5) return "More than half your visits were returns.";
  return "Familiar spots, kept casual.";
}

// ----------------------------------------------------------------------------
// Behavior signals — "What stood out". Concrete, human bullets with the number
// in them. Phrased as what happened ("You ate across 4 neighborhoods.") not as
// a reading of it ("Cuisine diversity is high.").
// ----------------------------------------------------------------------------
export function composeBehaviorSignals(d: UserWeeklyData): string[] {
  const out: string[] = [];

  // New vs. repeat
  const newVisits = Math.round(d.totalVisits * d.newPlaceRate);
  if (d.totalVisits > 0) {
    if (newVisits >= 3) {
      out.push(`${newVisits} of ${d.totalVisits} visits were somewhere new.`);
    } else if (newVisits === 0) {
      out.push(`All ${d.totalVisits} visits were places you already knew.`);
    } else {
      const back = d.totalVisits - newVisits;
      out.push(`${newVisits} somewhere new, ${back} back to ${back === 1 ? "a place" : "places"} you know.`);
    }
  }

  // Cuisine breadth
  if (d.cuisineDiversity >= 0.6) {
    out.push("Lots of different cuisines.");
  } else if (d.cuisineDiversity <= 0.25) {
    out.push("Mostly one or two cuisines.");
  }

  // Neighborhood spread
  if (d.neighborhoodCount >= 4) {
    out.push(`You ate across ${d.neighborhoodCount} neighborhoods.`);
  } else if (d.neighborhoodCount <= 2 && d.totalVisits >= 4) {
    out.push("You stayed in one or two areas.");
  }

  // Occasion / formality. These two are what the rules actually count, so the
  // sentence names them rather than an adjective for them.
  if (d.reservationOrOccasionSignal >= 0.4) {
    out.push("Several were date nights or group dinners.");
  }
  if (d.elevatedCategorySignal >= 0.3) {
    out.push("A few fine dining or wine bar visits.");
  }

  return out.slice(0, 4);
}

// ----------------------------------------------------------------------------
// Movement vs. last week. One plain sentence per direction; the identity
// names stay out of it because "more Roamer" and "your Forager lane" were the
// two lines the founder quoted back as jargon.
// ----------------------------------------------------------------------------
export const MOVEMENT_SUMMARY: Record<Direction, string> = {
  more_novel: "More new places than last week.",
  more_consistent: "More of your usual places than last week.",
  more_premium: "Nicer places than last week.",
  more_casual: "More casual than last week.",
  stable: "About the same as last week.",
};

export function composeMovement(
  prior: { novelty: number; premium: number; identity: PrimaryIdentity } | null,
  current: { novelty: number; premium: number },
  currentIdentity: PrimaryIdentity,
): PalateProfile["movement"] | undefined {
  if (!prior) return undefined;

  const dN = current.novelty - prior.novelty;
  const dP = current.premium - prior.premium;
  const SIGNIFICANT = 0.07;

  const withSummary = (direction: Direction): PalateProfile["movement"] =>
    ({ summary: MOVEMENT_SUMMARY[direction], direction });

  // Identity changed — report the larger of the two shifts that did it.
  if (prior.identity !== currentIdentity && currentIdentity !== "Learning" && prior.identity !== "Learning") {
    return withSummary(
      dN > Math.abs(dP)
        ? "more_novel"
        : dN < -Math.abs(dP)
        ? "more_consistent"
        : dP > 0
        ? "more_premium"
        : "more_casual",
    );
  }

  // Same identity but a real shift on one axis
  if (Math.abs(dN) > Math.abs(dP)) {
    if (dN > SIGNIFICANT) return withSummary("more_novel");
    if (dN < -SIGNIFICANT) return withSummary("more_consistent");
  } else {
    if (dP > SIGNIFICANT) return withSummary("more_premium");
    if (dP < -SIGNIFICANT) return withSummary("more_casual");
  }

  return withSummary("stable");
}

// ----------------------------------------------------------------------------
// "What are Palates?" copy.
// ----------------------------------------------------------------------------
export const WHAT_ARE_PALATES = {
  intro: "Your Palate is how you actually eat, not what you say you like. It comes from where you go, how often you go back, how often you try somewhere new, and whether you keep it casual or go somewhere nicer. It can change week to week, because it is about what you did this week.",
  axisIntro: "Two questions: how often you try somewhere new, and how casual or nice the places are.",
  tagsIntro: "Tags are the details. Lines like Big on brunch, Ate in groups, or Kept going back describe the week without changing your main Palate.",
  axisLabels: {
    yTop: "Nicer",
    yBottom: "Casual",
    xLeft: "Same places",
    xRight: "New places",
  },
};

// ----------------------------------------------------------------------------
// Ego hook — the strongest thing about the user's OWN week, in absolute
// terms. We deliberately do NOT claim a "Top X%" percentile: there's no global
// distribution to rank against, so any percentile would be a fabricated
// statistic. Returns a self-referential observation instead.
// ----------------------------------------------------------------------------
export function composeEgoHook(profile: PalateProfile): string {
  const n = profile.noveltyScore;
  const p = profile.premiumScore;
  if (Math.abs(n - 0.5) >= Math.abs(p - 0.5)) {
    if (n >= 0.85) return "Lots of new places this week.";
    if (n >= 0.75) return "Plenty of new places this week.";
    if (n >= 0.65) return "You branched out this week.";
    if (n <= 0.15) return "All your usual spots this week.";
    if (n <= 0.25) return "Mostly familiar spots this week.";
    if (n <= 0.35) return "You stuck close to your favorites this week.";
  } else {
    if (p >= 0.85) return "You went upscale this week.";
    if (p >= 0.75) return "Some nice places this week.";
    if (p >= 0.65) return "A few nicer places this week.";
    if (p <= 0.15) return "All casual this week.";
    if (p <= 0.25) return "Mostly casual this week.";
  }
  return "A bit of everything this week.";
}

// ----------------------------------------------------------------------------
// Where this is heading. If the week's shift continued, which identity would
// the person land on? Only worth a card when the answer is a DIFFERENT one:
// the badge, with its plain meaning under it. A week that held steady, or a
// shift that stays inside the identity already shown, gets null and no card,
// because the story tightens rather than padding with a sentence that
// restates the previous card.
// ----------------------------------------------------------------------------
const HEADING: Record<Named, Partial<Record<Direction, Named>>> = {
  Anchor:  { more_novel: "Forager", more_premium: "Steward" },
  Steward: { more_novel: "Curator", more_casual: "Anchor" },
  Forager: { more_consistent: "Anchor", more_premium: "Curator" },
  Curator: { more_consistent: "Steward", more_casual: "Forager" },
};

export function composeNextEra(
  current: PrimaryIdentity,
  movement: PalateProfile["movement"] | undefined,
): StoryCopy | null {
  if (current === "Learning" || !movement) return null;
  const target = HEADING[current][movement.direction];
  if (!target) return null;
  return { headline: identityTitle(target), body: IDENTITY_BLURB[target].tagline };
}

// ----------------------------------------------------------------------------
// Story cards. Each says one plain thing, with a number where there is one,
// in at most two short sentences. Pure, so the story screen stays thin and
// the words are testable.
// ----------------------------------------------------------------------------

/** Card 2: the week in numbers. Visits in the headline; places, neighborhoods
 *  and cuisine spread in the body. Null for a week with nothing in it. */
export function composeStoryNumbers(
  d: UserWeeklyData | null,
  uniquePlaces: number | null,
): StoryCopy | null {
  if (!d || d.totalVisits === 0) return null;

  const headline = `${plural(d.totalVisits, "visit")}.`;

  const parts: string[] = [];
  const places = uniquePlaces != null && uniquePlaces > 0 ? plural(uniquePlaces, "place") : null;
  const hoods = d.neighborhoodCount >= 1 ? plural(d.neighborhoodCount, "neighborhood") : null;
  if (places && hoods) parts.push(`${places} across ${hoods}.`);
  else if (places) parts.push(`${places}.`);
  else if (hoods) parts.push(`Across ${hoods}.`);

  if (d.cuisineDiversity >= 0.6) parts.push("Lots of different cuisines.");
  else if (d.cuisineDiversity <= 0.25 && d.totalVisits >= 4) parts.push("Mostly one or two cuisines.");

  return { headline, body: parts.join(" ") };
}

/** Card 3: the one thing that stood out, with its number, and how that
 *  compares to last week when there is a last week to compare to. */
export function composeStoryStandout(profile: PalateProfile): StoryCopy {
  const fallback = profile.primaryIdentity === "Learning"
    ? composeLearningLine(0)
    : DID_THIS[profile.primaryIdentity];
  const headline = profile.behaviorSignals[0] ?? fallback;
  const body = profile.movement?.summary ?? "Next week you'll see how this compares.";
  return { headline, body };
}

/** Card 4: the details. The strongest tag as the headline, the rest as a
 *  short row, and the dish the person loved as a footer. Null when there is
 *  nothing to say. */
export function composeStoryAlso(
  tags: Tag[],
  dish: { itemName: string; restaurantName: string } | null,
): StoryCopy | null {
  if (tags.length === 0 && !dish) return null;

  const headline = tags[0] ? tagLabel(tags[0]) : "A dish you loved.";
  const rest = tags.slice(1, 4).map(tagLabel);
  const body = rest.length > 0
    ? rest.join(" · ")
    : dish && tags[0]
      ? "And a dish you loved."
      : "";
  const footer = dish ? `♥ ${dish.itemName} · ${dish.restaurantName}` : undefined;

  return { headline, body, footer };
}
