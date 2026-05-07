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
// Copy locked per design bible: short, observational, slightly editorial.
// ----------------------------------------------------------------------------
export const IDENTITY_BLURB: Record<PrimaryIdentity, { tagline: string; description: string; shareDescriptor: string }> = {
  Curator: {
    tagline: "Seeks new things, picks them carefully.",
    description: "Curators explore new places with intention. They gravitate toward elevated, thoughtful, or reservation-worthy spots.",
    shareDescriptor: "New places, carefully chosen.",
  },
  Forager: {
    tagline: "Always trying something new — casually.",
    description: "Foragers explore widely without needing every meal to be an event. Variety, movement, and discovery define the pattern.",
    shareDescriptor: "Always trying something new — casually.",
  },
  Steward: {
    tagline: "Returns to the right places, deliberately.",
    description: "Stewards keep a refined short list and revisit it. Quality over quantity, depth over breadth.",
    shareDescriptor: "Returns to the right places.",
  },
  Anchor: {
    tagline: "Leans into the trusted few.",
    description: "Anchors keep a core rotation of casual, comfortable spots. Familiarity is the point.",
    shareDescriptor: "Rooted in the trusted few.",
  },
  Learning: {
    tagline: "Still finding the pattern.",
    description: "Once you've logged a few visits, your Palate starts to surface — the kind of places you eat and how often you mix it up.",
    shareDescriptor: "Your Palate is taking shape.",
  },
};

// ----------------------------------------------------------------------------
// Headline explanation — observational, never robotic.
// Copy locked per design bible. NEVER produces "strongly Forager" — uses
// "moved like a ___" framing for the strong-signal case so the grammar
// always reads.
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
    return `Your palate leaned ${primary} this week, with ${secondary} tendencies. ${pickSecondLine(primary, data)}`;
  }

  // Confident framing — three intensities, all grammatically clean.
  const strong = scores.novelty >= 0.75 || scores.premium >= 0.75;
  const clear  = scores.novelty >= 0.65 || scores.premium >= 0.65;

  const opener = strong
    ? `You moved like a ${primary} this week.`
    : clear
    ? `Your palate leaned ${primary} this week.`
    : `You leaned ${primary} this week.`;

  return `${opener} ${pickSecondLine(primary, data)}`;
}

function pickSecondLine(primary: PrimaryIdentity, d: UserWeeklyData): string {
  if (primary === "Curator") {
    if (d.reservationOrOccasionSignal >= 0.4) return "You picked carefully and went out for the occasion.";
    return "New places, carefully chosen.";
  }
  if (primary === "Forager") {
    if (d.cuisineDiversity >= 0.6) return "You chased variety — new places, low repetition, and a wide cuisine spread.";
    return "You favored new spots over the usual — without needing them to be an event.";
  }
  if (primary === "Steward") {
    if (d.repeatRate >= 0.5) return "You returned to a short list and made each visit count.";
    return "You leaned on places that earned the trip — quality over quantity.";
  }
  // Anchor
  if (d.repeatRate >= 0.5) return "Your usual rotation carried the week — familiar, casual, dependable.";
  return "Familiar spots, casual energy — the trusted few.";
}

// ----------------------------------------------------------------------------
// Behavior signals — "What your week revealed". Concrete, human bullets.
// Phrased observationally ("You ate across 4 neighborhoods.") not analytically
// ("Cuisine diversity is high.").
// ----------------------------------------------------------------------------
export function composeBehaviorSignals(d: UserWeeklyData): string[] {
  const out: string[] = [];

  // New vs. repeat
  const newVisits = Math.round(d.totalVisits * d.newPlaceRate);
  if (d.totalVisits > 0) {
    if (newVisits >= 3) {
      out.push(`${newVisits} of ${d.totalVisits} visits were new places.`);
    } else if (newVisits === 0) {
      out.push("You stayed with spots you already know.");
    } else {
      out.push(`${newVisits} new spot${newVisits === 1 ? "" : "s"}, ${d.totalVisits - newVisits} repeat${d.totalVisits - newVisits === 1 ? "" : "s"}.`);
    }
  }

  // Cuisine breadth
  if (d.cuisineDiversity >= 0.6) {
    out.push("You moved across cuisines this week.");
  } else if (d.cuisineDiversity <= 0.25) {
    out.push("You focused on one or two cuisines.");
  }

  // Neighborhood spread
  if (d.neighborhoodCount >= 4) {
    out.push(`You ate across ${d.neighborhoodCount} neighborhoods.`);
  } else if (d.neighborhoodCount <= 2 && d.totalVisits >= 4) {
    out.push("You stayed in one or two areas.");
  }

  // Occasion / formality
  if (d.reservationOrOccasionSignal >= 0.4) {
    out.push("Several picks felt like the occasion.");
  }
  if (d.elevatedCategorySignal >= 0.3) {
    out.push("You leaned into more elevated formats.");
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

  return { summary: `You stayed in your ${currentIdentity} lane.`, direction: "stable" };
}

// ----------------------------------------------------------------------------
// "What are Palates?" copy — locked per design bible.
// ----------------------------------------------------------------------------
export const WHAT_ARE_PALATES = {
  intro: "Your Palate reflects how you actually eat — not just what you say you like. It looks at where you go, what you repeat, how much you explore, and whether your choices lean casual or premium. Your Palate can change week to week because it reflects who you are right now.",
  axisIntro: "Two axes: how much you explore, and whether your choices lean casual or premium.",
  tagsIntro: "Tags add texture. Grounded, Roamer, Late-night, Brunch-heavy, and Stretching lately describe the details of your week without replacing your main Palate.",
  axisLabels: {
    yTop: "Premium",
    yBottom: "Casual",
    xLeft: "Consistency",
    xRight: "Novelty",
  },
};

// ----------------------------------------------------------------------------
// Ego hook — turns the strongest axis position into "Top X% in {axis} this
// week." Conservative percentile estimate (no global distribution data yet),
// so the magnitudes are tied to the score buckets — never inflated.
// Returns undefined when nothing strong fires; callers should hide the line.
// ----------------------------------------------------------------------------
export function composeEgoHook(profile: PalateProfile): string {
  const n = profile.noveltyScore;
  const p = profile.premiumScore;
  if (Math.abs(n - 0.5) >= Math.abs(p - 0.5)) {
    if (n >= 0.85) return "Top 5% in exploration this week.";
    if (n >= 0.75) return "Top 15% in exploration this week.";
    if (n >= 0.65) return "Top 30% in exploration this week.";
    if (n <= 0.15) return "Top 5% in consistency this week.";
    if (n <= 0.25) return "Top 15% in consistency this week.";
    if (n <= 0.35) return "Top 30% in consistency this week.";
  } else {
    if (p >= 0.85) return "Top 5% in elevated picks this week.";
    if (p >= 0.75) return "Top 15% in elevated picks this week.";
    if (p >= 0.65) return "Top 30% in elevated picks this week.";
    if (p <= 0.15) return "Top 5% in casual leanings this week.";
    if (p <= 0.25) return "Top 15% in casual leanings this week.";
  }
  return "You're moving — your Palate is shifting.";
}

// ----------------------------------------------------------------------------
// "Your next era" copy — answers "where are you moving?" not "what cuisine
// do you want?" Movement-axis aware, never identity-fixed.
// ----------------------------------------------------------------------------
export function composeNextEra(
  current: PrimaryIdentity,
  movement: PalateProfile["movement"] | undefined,
): string {
  if (current === "Learning") {
    return "Log a few more visits and we'll surface where your Palate is moving.";
  }
  if (!movement || movement.direction === "stable") {
    return `You're holding steady as a ${current}. The next era is shaped by what you do this week.`;
  }
  switch (movement.direction) {
    case "more_novel":
      return current === "Anchor"
        ? "You're moving toward Forager — exploring more, repeating less."
        : current === "Steward"
        ? "You're moving toward Curator — keeping the bar high, widening the search."
        : `You're stretching past ${current} — more new spots, fewer repeats.`;
    case "more_consistent":
      return current === "Forager"
        ? "You're moving toward Anchor — fewer new picks, more comfort."
        : current === "Curator"
        ? "You're moving toward Steward — refining a short list."
        : `You're settling deeper into ${current}.`;
    case "more_premium":
      return current === "Forager"
        ? "You're moving toward Curator — same exploration, more elevated picks."
        : current === "Anchor"
        ? "You're moving toward Steward — quietly raising the bar."
        : `You're leaning more elevated than your usual ${current} pattern.`;
    case "more_casual":
      return current === "Curator"
        ? "You're moving toward Forager — same hunger to explore, less formality."
        : current === "Steward"
        ? "You're moving toward Anchor — easing into the trusted few."
        : `You're easing off the formality this week.`;
    default:
      return `You're holding the ${current} pattern.`;
  }
}
