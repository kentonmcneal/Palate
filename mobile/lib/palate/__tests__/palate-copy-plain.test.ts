import {
  composeExplanation, composeBehaviorSignals, composeMovement, MOVEMENT_SUMMARY,
  composeEgoHook, composeNextEra, composeStoryNumbers, composeStoryStandout, composeStoryAlso,
  composeLearningLine, IDENTITY_BLURB, WHAT_ARE_PALATES, VISITS_TO_NAME,
} from "../palateCopy";
import { IDENTITY_NAME } from "../palateNames";
import { getUserPalateProfile } from "../palateScoring";
import type { PalateProfile, PrimaryIdentity, UserWeeklyData } from "../palateTypes";

// ============================================================================
// One test for every line a person reads on Wrapped: would somebody who has
// never used the app understand it on first read? So no words that describe
// the model instead of the person, no identity KEYS in prose, and no identity
// NAME used as an adjective ("leaned Explorer"). The names may appear only as
// a badge with the plain meaning next to it.
// ============================================================================

const MODEL_WORDS = /\b(novelty|premium|axis|axes|quadrant|signals?|tendencies|leaned|pattern forming|next era|surface|lane)\b/i;
const KEYS = /\b(Curator|Forager|Steward|Anchors?)\b/;
const NAMES = new RegExp(`\\b(${Object.values(IDENTITY_NAME).join("|")})\\b`);
const NAMED: PrimaryIdentity[] = ["Curator", "Forager", "Steward", "Anchor"];

function sentences(s: string): number {
  return s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
}

function makeData(overrides: Partial<UserWeeklyData> = {}): UserWeeklyData {
  return {
    totalVisits: 8,
    newPlaceRate: 0.5,
    repeatRate: 0.5,
    cuisineDiversity: 0.5,
    neighborhoodDiversity: 0.5,
    normalizedPriceLevel: 0.5,
    independentRestaurantRate: 0.5,
    reservationOrOccasionSignal: 0.5,
    elevatedCategorySignal: 0.5,
    neighborhoodCount: 3,
    timeOfDayDistribution: { breakfast: 0.1, brunch: 0.1, lunch: 0.3, dinner: 0.4, lateNight: 0.1 },
    socialDiningSignals: { groupDinner: 0.2, dateNight: 0.2, casualSolo: 0.4 },
    ...overrides,
  };
}

function stubProfile(overrides: Partial<PalateProfile> = {}): PalateProfile {
  return {
    primaryIdentity: "Forager",
    confidence: "medium",
    noveltyScore: 0.5,
    premiumScore: 0.5,
    tags: [],
    explanation: "",
    behaviorSignals: [],
    position: { x: 0.5, y: 0.5 },
    ...overrides,
  };
}

describe("the naming threshold", () => {
  it("agrees with the scoring rule it describes", async () => {
    // The copy says "It takes 4"; scoring has its own MIN_VISITS_FOR_CLASSIFY.
    // They live in two files to avoid an import cycle, so pin them together.
    const under = await getUserPalateProfile(makeData({ totalVisits: VISITS_TO_NAME - 1 }), { useSmoothing: false });
    const at = await getUserPalateProfile(makeData({ totalVisits: VISITS_TO_NAME }), { useSmoothing: false });
    expect(under.primaryIdentity).toBe("Learning");
    expect(at.primaryIdentity).not.toBe("Learning");
  });

  it("says the number the person has and the number they need", () => {
    expect(composeLearningLine(0)).toBe("No visits this week yet. It takes 4 to name your Palate.");
    expect(composeLearningLine(1)).toBe("1 visit this week. It takes 4 to name your Palate.");
    expect(composeLearningLine(3)).toBe("3 visits this week. It takes 4 to name your Palate.");
  });
});

describe("composeExplanation", () => {
  const scores = { novelty: 0.7, premium: 0.3 };

  it("talks about the person, never the model or the names", () => {
    for (const primary of NAMED) {
      for (const secondary of [undefined, ...NAMED]) {
        const s = composeExplanation(primary, secondary, scores, makeData());
        expect(s).not.toMatch(MODEL_WORDS);
        expect(s).not.toMatch(KEYS);
        expect(s).not.toMatch(NAMES);
        expect(s).not.toMatch(/—/);
        expect(sentences(s)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("says the main thing, then the other thing, for a week near the line", () => {
    expect(composeExplanation("Forager", "Anchor", scores, makeData()))
      .toBe("You mostly went somewhere new, and kept it casual. Also some of your usual spots.");
  });

  it("uses the learning line below the threshold", () => {
    expect(composeExplanation("Learning", undefined, scores, makeData({ totalVisits: 2 })))
      .toBe(composeLearningLine(2));
  });
});

describe("composeBehaviorSignals", () => {
  it("leads with the new-versus-back count", () => {
    expect(composeBehaviorSignals(makeData({ totalVisits: 6, newPlaceRate: 4 / 6 }))[0])
      .toBe("4 of 6 visits were somewhere new.");
    expect(composeBehaviorSignals(makeData({ totalVisits: 6, newPlaceRate: 0 }))[0])
      .toBe("All 6 visits were places you already knew.");
    expect(composeBehaviorSignals(makeData({ totalVisits: 6, newPlaceRate: 1 / 6 }))[0])
      .toBe("1 somewhere new, 5 back to places you know.");
    expect(composeBehaviorSignals(makeData({ totalVisits: 3, newPlaceRate: 2 / 3 }))[0])
      .toBe("2 somewhere new, 1 back to a place you know.");
  });

  it("names what the occasion and formality rules count", () => {
    const out = composeBehaviorSignals(makeData({ reservationOrOccasionSignal: 0.5, elevatedCategorySignal: 0.4 }));
    expect(out).toContain("Several were date nights or group dinners.");
    expect(out).toContain("A few fine dining or wine bar visits.");
  });

  it("never describes the model", () => {
    for (const s of composeBehaviorSignals(makeData({ cuisineDiversity: 0.9, neighborhoodCount: 5 }))) {
      expect(s).not.toMatch(MODEL_WORDS);
      expect(s).not.toMatch(/—/);
    }
  });
});

describe("composeMovement", () => {
  const prior = { novelty: 0.5, premium: 0.5, identity: "Forager" as PrimaryIdentity };

  it("is undefined without a last week to compare to", () => {
    expect(composeMovement(null, { novelty: 0.9, premium: 0.5 }, "Forager")).toBeUndefined();
  });

  it("says the direction in the person's terms", () => {
    expect(composeMovement(prior, { novelty: 0.6, premium: 0.5 }, "Forager"))
      .toEqual({ summary: "More new places than last week.", direction: "more_novel" });
    expect(composeMovement(prior, { novelty: 0.4, premium: 0.5 }, "Forager"))
      .toEqual({ summary: "More of your usual places than last week.", direction: "more_consistent" });
    expect(composeMovement(prior, { novelty: 0.5, premium: 0.6 }, "Forager"))
      .toEqual({ summary: "Nicer places than last week.", direction: "more_premium" });
    expect(composeMovement(prior, { novelty: 0.5, premium: 0.4 }, "Forager"))
      .toEqual({ summary: "More casual than last week.", direction: "more_casual" });
    expect(composeMovement(prior, { novelty: 0.52, premium: 0.51 }, "Forager"))
      .toEqual({ summary: "About the same as last week.", direction: "stable" });
  });

  it("does not put the identity key in the sentence when the identity changed", () => {
    const m = composeMovement({ ...prior, identity: "Anchor" }, { novelty: 0.7, premium: 0.5 }, "Forager");
    expect(m?.direction).toBe("more_novel");
    expect(m?.summary).not.toMatch(KEYS);
    expect(m?.summary).not.toMatch(NAMES);
  });

  it("keeps every summary plain", () => {
    for (const s of Object.values(MOVEMENT_SUMMARY)) {
      expect(s).not.toMatch(MODEL_WORDS);
      expect(s).not.toMatch(/Roamer|grounded/i);
      expect(s).not.toMatch(/—/);
    }
  });
});

describe("composeEgoHook", () => {
  it("describes the week, not the model", () => {
    expect(composeEgoHook(stubProfile({ noveltyScore: 0.9 }))).toBe("Lots of new places this week.");
    expect(composeEgoHook(stubProfile({ noveltyScore: 0.1 }))).toBe("All your usual spots this week.");
    expect(composeEgoHook(stubProfile({ premiumScore: 0.9 }))).toBe("You went upscale this week.");
    expect(composeEgoHook(stubProfile())).toBe("A bit of everything this week.");
    for (const n of [0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9]) {
      for (const p of [0.1, 0.2, 0.5, 0.7, 0.8, 0.9]) {
        const s = composeEgoHook(stubProfile({ noveltyScore: n, premiumScore: p }));
        expect(s).not.toMatch(MODEL_WORDS);
        expect(s).not.toMatch(/shifting/);
      }
    }
  });
});

describe("composeNextEra", () => {
  const move = (direction: NonNullable<PalateProfile["movement"]>["direction"]) =>
    ({ summary: MOVEMENT_SUMMARY[direction], direction });

  it("has nothing to say without a shift, or below the threshold", () => {
    expect(composeNextEra("Learning", move("more_novel"))).toBeNull();
    expect(composeNextEra("Anchor", undefined)).toBeNull();
    expect(composeNextEra("Anchor", move("stable"))).toBeNull();
  });

  it("names the identity the shift points at, as a badge with its meaning", () => {
    expect(composeNextEra("Anchor", move("more_novel")))
      .toEqual({ headline: "The Explorer", body: IDENTITY_BLURB.Forager.tagline });
    expect(composeNextEra("Anchor", move("more_premium"))?.headline).toBe("The Connoisseur");
    expect(composeNextEra("Steward", move("more_novel"))?.headline).toBe("The Tastemaker");
    expect(composeNextEra("Steward", move("more_casual"))?.headline).toBe("The Regular");
    expect(composeNextEra("Forager", move("more_consistent"))?.headline).toBe("The Regular");
    expect(composeNextEra("Forager", move("more_premium"))?.headline).toBe("The Tastemaker");
    expect(composeNextEra("Curator", move("more_consistent"))?.headline).toBe("The Connoisseur");
    expect(composeNextEra("Curator", move("more_casual"))?.headline).toBe("The Explorer");
  });

  it("stays quiet when the shift stays inside the identity already shown", () => {
    expect(composeNextEra("Forager", move("more_novel"))).toBeNull();
    expect(composeNextEra("Curator", move("more_novel"))).toBeNull();
    expect(composeNextEra("Anchor", move("more_casual"))).toBeNull();
    expect(composeNextEra("Steward", move("more_premium"))).toBeNull();
  });
});

describe("story cards", () => {
  it("numbers: visits in the headline, places and neighborhoods in the body", () => {
    expect(composeStoryNumbers(null, 4)).toBeNull();
    expect(composeStoryNumbers(makeData({ totalVisits: 0 }), 0)).toBeNull();
    expect(composeStoryNumbers(makeData({ totalVisits: 6, neighborhoodCount: 3 }), 4))
      .toEqual({ headline: "6 visits.", body: "4 places across 3 neighborhoods." });
    expect(composeStoryNumbers(makeData({ totalVisits: 1, neighborhoodCount: 1 }), 1))
      .toEqual({ headline: "1 visit.", body: "1 place across 1 neighborhood." });
    expect(composeStoryNumbers(makeData({ totalVisits: 6, neighborhoodCount: 3 }), null)?.body)
      .toBe("Across 3 neighborhoods.");
    expect(composeStoryNumbers(makeData({ totalVisits: 6, neighborhoodCount: 3, cuisineDiversity: 0.7 }), 4)?.body)
      .toBe("4 places across 3 neighborhoods. Lots of different cuisines.");
    expect(composeStoryNumbers(makeData({ totalVisits: 6, neighborhoodCount: 3, cuisineDiversity: 0.2 }), 4)?.body)
      .toBe("4 places across 3 neighborhoods. Mostly one or two cuisines.");
  });

  it("standout: the first signal, then how it compares to last week", () => {
    const p = stubProfile({
      behaviorSignals: ["4 of 6 visits were somewhere new."],
      movement: { summary: MOVEMENT_SUMMARY.more_novel, direction: "more_novel" },
    });
    expect(composeStoryStandout(p))
      .toEqual({ headline: "4 of 6 visits were somewhere new.", body: "More new places than last week." });
    expect(composeStoryStandout(stubProfile({ behaviorSignals: ["x."] })).body)
      .toBe("Next week you'll see how this compares.");
    expect(composeStoryStandout(stubProfile()).headline)
      .toBe("You mostly went somewhere new, and kept it casual.");
  });

  it("also: tags as plain phrases, the dish as a footer", () => {
    expect(composeStoryAlso([], null)).toBeNull();
    expect(composeStoryAlso(["Roamer", "Brunch-heavy", "Group dining"], null))
      .toEqual({ headline: "Ate all over town", body: "Big on brunch · Ate in groups", footer: undefined });
    expect(composeStoryAlso(["Roamer"], { itemName: "Coffee", restaurantName: "Starbucks" }))
      .toEqual({ headline: "Ate all over town", body: "And a dish you loved.", footer: "♥ Coffee · Starbucks" });
    expect(composeStoryAlso([], { itemName: "Coffee", restaurantName: "Starbucks" }))
      .toEqual({ headline: "A dish you loved.", body: "", footer: "♥ Coffee · Starbucks" });
  });

  it("every card is at most two short sentences", () => {
    const cards = [
      composeStoryNumbers(makeData({ totalVisits: 6, neighborhoodCount: 3, cuisineDiversity: 0.7 }), 4),
      composeStoryStandout(stubProfile({
        behaviorSignals: ["4 of 6 visits were somewhere new."],
        movement: { summary: MOVEMENT_SUMMARY.stable, direction: "stable" },
      })),
      composeNextEra("Anchor", { summary: MOVEMENT_SUMMARY.more_novel, direction: "more_novel" }),
    ];
    for (const c of cards) {
      expect(c).not.toBeNull();
      expect(sentences(c!.headline)).toBeLessThanOrEqual(2);
      expect(sentences(c!.body)).toBeLessThanOrEqual(2);
    }
  });
});

describe("house style across the explainer copy", () => {
  const prose = [
    ...Object.values(IDENTITY_BLURB).flatMap((b) => [b.tagline, b.description, b.shareDescriptor]),
    WHAT_ARE_PALATES.intro,
    WHAT_ARE_PALATES.axisIntro,
    WHAT_ARE_PALATES.tagsIntro,
    ...Object.values(WHAT_ARE_PALATES.axisLabels),
    ...Object.values(MOVEMENT_SUMMARY),
  ];

  it("never describes the model", () => {
    for (const s of prose) expect(s).not.toMatch(MODEL_WORDS);
  });

  it("uses no em dashes", () => {
    for (const s of prose) expect(s).not.toMatch(/—/);
  });

  it("explains tags with the phrases a person actually sees", () => {
    expect(WHAT_ARE_PALATES.tagsIntro).toMatch(/Big on brunch/);
    expect(WHAT_ARE_PALATES.tagsIntro).not.toMatch(/Roamer|Grounded/);
  });
});
