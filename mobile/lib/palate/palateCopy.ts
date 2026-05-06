// ============================================================================
// palateCopy.ts — all the user-facing strings for the Palate identity system.
// ----------------------------------------------------------------------------
// Always says "this week leaned X", never "you are permanently X".
// Uses soft language for users near the threshold.
// ============================================================================

import type {
  PrimaryIdentity, UserWeeklyData, PalateProfile,
} from "./palateTypes";

// ----------------------------------------------------------------------------
// Identity descriptions — used on the "What are Palates?" explainer.
// ----------------------------------------------------------------------------
export const IDENTITY_BLURB: Record<PrimaryIdentity, { tagline: string; description: string }> = {
  Curator: {
    tagline: "Seeks new things, picks them carefully.",
    description: "Curators try lots of new spots and lean toward elevated, intentional places. The pattern: high novelty AND high intentionality.",
  },
  Forager: {
    tagline: "Always trying something new — casually.",
    description: "Foragers explore widely without needing every meal to be an event. Lots of variety, lower formality.",
  },
  Steward: {
    tagline: "Returns to the right places, deliberately.",
    description: "Stewards have a refined short list and revisit it. Quality over quantity, depth over breadth.",
  },
  Anchor: {
    tagline: "Leans into the trusted few.",
    description: "Anchors keep a core rotation of casual, comfortable spots. Familiarity is the point.",
  },
  Learning: {
    tagline: "Still finding the pattern.",
    description: "Once you've logged a few visits, your Palate starts to surface — the kind of places you eat and how often you mix it up.",
  },
};

// ----------------------------------------------------------------------------
// Headline explanation — soft for middle users, confident for clear cases.
// ----------------------------------------------------------------------------
export function composeExplanation(
  primary: PrimaryIdentity,
  secondary: PrimaryIdentity | undefined,
  scores: { novelty: number; premium: number },
  data: UserWeeklyData,
): string {
  if (primary === "Learning") {
    return "We're still learning your Palate. Log a few more visits and we'll show you who you eat like.";
  }

  // Soft language for borderline users
  if (secondary) {
    return `Your palate this week leaned ${primary}, with ${secondary} tendencies.`;
  }

  // Confident framing — but always "this week leaned" not "you are"
  const heat = scores.novelty >= 0.75 || scores.premium >= 0.75
    ? "strongly"
    : scores.novelty >= 0.65 || scores.premium >= 0.65
    ? "clearly"
    : "leaned";

  // Choose a behaviorally-grounded second sentence based on data
  const second = pickSecondLine(primary, data);
  return `Your palate this week ${heat} ${primary}. ${second}`;
}

function pickSecondLine(primary: PrimaryIdentity, d: UserWeeklyData): string {
  if (primary === "Curator") {
    if (d.reservationOrOccasionSignal >= 0.4) return "You picked carefully and went out for the occasion.";
    return "You went looking for new spots — and the picks were intentional.";
  }
  if (primary === "Forager") {
    if (d.cuisineDiversity >= 0.6) return "Lots of cuisines, low repetition — exploration was the point.";
    return "You favored new spots over the usual — without needing them to be an event.";
  }
  if (primary === "Steward") {
    if (d.repeatRate >= 0.5) return "You returned to a short list and made each visit count.";
    return "You leaned on places that earned the trip — quality over quantity.";
  }
  // Anchor
  if (d.repeatRate >= 0.5) return "Your usual rotation carried the week — comfort over discovery.";
  return "Familiar spots, casual energy — the trusted few.";
}

// ----------------------------------------------------------------------------
// Behavior signals — concrete, human-readable bullets. NOT raw metrics.
// ----------------------------------------------------------------------------
export function composeBehaviorSignals(d: UserWeeklyData): string[] {
  const out: string[] = [];

  // New vs. repeat
  const newVisits = Math.round(d.totalVisits * d.newPlaceRate);
  if (d.totalVisits > 0) {
    if (newVisits >= 3) {
      out.push(`${newVisits} of ${d.totalVisits} visits to new places.`);
    } else if (newVisits === 0) {
      out.push("Returned to spots you already know.");
    } else {
      out.push(`${newVisits} new spot${newVisits === 1 ? "" : "s"}, ${d.totalVisits - newVisits} repeat${d.totalVisits - newVisits === 1 ? "" : "s"}.`);
    }
  }

  // Cuisine breadth
  if (d.cuisineDiversity >= 0.6) {
    out.push("Cuisine spread was wide.");
  } else if (d.cuisineDiversity <= 0.25) {
    out.push("Cuisine focus was tight.");
  }

  // Neighborhood spread
  if (d.neighborhoodCount >= 4) {
    out.push(`Eating across ${d.neighborhoodCount} neighborhoods.`);
  } else if (d.neighborhoodCount <= 2 && d.totalVisits >= 4) {
    out.push("Mostly one or two areas.");
  }

  // Occasion / formality
  if (d.reservationOrOccasionSignal >= 0.4) {
    out.push("Several picks felt like the occasion.");
  }
  if (d.elevatedCategorySignal >= 0.3) {
    out.push("Leaned into elevated formats this week.");
  }

  return out.slice(0, 4);
}

// ----------------------------------------------------------------------------
// Movement vs. last week — "You moved toward Curator" / "More Roamer than last week"
// ----------------------------------------------------------------------------
export function composeMovement(
  prior: { novelty: number; premium: number; identity: PrimaryIdentity } | null,
  current: { novelty: number; premium: number },
  currentIdentity: PrimaryIdentity,
): PalateProfile["movement"] | undefined {
  if (!prior) return undefined;

  const dN = current.novelty - prior.novelty;
  const dP = current.premium - prior.premium;
  const SIGNIFICANT = 0.07;

  // Identity changed — surface that move directly
  if (prior.identity !== currentIdentity && currentIdentity !== "Learning" && prior.identity !== "Learning") {
    return {
      summary: `You moved toward ${currentIdentity}.`,
      direction: dN > Math.abs(dP)
        ? "more_novel"
        : dN < -Math.abs(dP)
        ? "more_consistent"
        : dP > 0
        ? "more_premium"
        : "more_casual",
    };
  }

  // Same identity but movement on an axis
  if (Math.abs(dN) > Math.abs(dP)) {
    if (dN > SIGNIFICANT) {
      return { summary: "More Roamer than last week.", direction: "more_novel" };
    }
    if (dN < -SIGNIFICANT) {
      return { summary: "More grounded than last week.", direction: "more_consistent" };
    }
  } else {
    if (dP > SIGNIFICANT) {
      return { summary: "Leaning more elevated than last week.", direction: "more_premium" };
    }
    if (dP < -SIGNIFICANT) {
      return { summary: "More casual than last week.", direction: "more_casual" };
    }
  }

  return { summary: "Steady from last week.", direction: "stable" };
}

// ----------------------------------------------------------------------------
// "What are Palates?" copy
// ----------------------------------------------------------------------------
export const WHAT_ARE_PALATES = {
  intro: "Your Palate reflects how you actually eat — not what you say you like, but what your patterns reveal week to week. Two axes: how much you explore, and how intentional your picks are.",
  axisLabels: {
    yTop: "Premium",
    yBottom: "Casual",
    xLeft: "Consistency",
    xRight: "Novelty",
  },
};
