import { TAG_LABEL, tagLabel, deriveTags } from "../palateTags";
import type { Tag, UserWeeklyData } from "../palateTypes";

// ============================================================================
// The founder, reading his own Wrapped: "texts like roamer and etc ... just
// comes off as a bunch of words and jargon". The tag KEYS stay (they are in
// the type union and every test), and the phrase a person reads comes from
// TAG_LABEL. These tests keep that map complete and keep the old words out.
// ============================================================================

const EVERY_TAG: Tag[] = [
  "Grounded", "Roamer",
  "Brunch-heavy", "Late-night", "Weekday lunch", "Cafe regular",
  "Group dining", "Solo dining", "Date-night", "Friends-first",
  "High variety", "Repeat favorite", "Trend-aware", "Planner",
  "Comfort-driven", "Stretching lately", "Wellness-leaning", "Cuisine-focused",
];

const OLD_JARGON = /\b(Roamer|Grounded|Trend-aware|Planner|Friends-first|Repeat favorite|High variety|Stretching|Comfort-driven|Cuisine-focused|Wellness)\b/i;

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

describe("tag labels", () => {
  it("has a phrase for every tag key and nothing else", () => {
    expect(Object.keys(TAG_LABEL).sort()).toEqual([...EVERY_TAG].sort());
    for (const t of EVERY_TAG) expect(TAG_LABEL[t].trim().length).toBeGreaterThan(0);
  });

  it("never shows the old jargon words, and no em dashes", () => {
    for (const t of EVERY_TAG) {
      expect(TAG_LABEL[t]).not.toMatch(OLD_JARGON);
      expect(TAG_LABEL[t]).not.toMatch(/—/);
    }
  });

  it("says what the rule under it measures, not a mood about it", () => {
    // "Trend-aware" fires on fine dining and wine bar share; "Planner" on
    // date nights and group dinners. The phrase has to say that.
    expect(TAG_LABEL["Trend-aware"]).toBe("Fine dining and wine bars");
    expect(TAG_LABEL.Planner).toBe("Dates and group dinners");
    expect(TAG_LABEL.Roamer).toBe("Ate all over town");
    expect(TAG_LABEL.Grounded).toBe("Stayed in one or two areas");
  });

  it("labels whatever deriveTags produces", () => {
    const weeks = [
      makeData(),
      makeData({ neighborhoodCount: 6, neighborhoodDiversity: 0.9, cuisineDiversity: 0.9, newPlaceRate: 0.9 }),
      makeData({ neighborhoodCount: 1, neighborhoodDiversity: 0.1, repeatRate: 0.8, cuisineDiversity: 0.2 }),
      makeData({
        timeOfDayDistribution: { breakfast: 0.3, brunch: 0.3, lunch: 0.1, dinner: 0.2, lateNight: 0.3 },
        socialDiningSignals: { groupDinner: 0.4, dateNight: 0.1, casualSolo: 0.5 },
      }),
    ];
    for (const w of weeks) {
      for (const t of deriveTags(w)) {
        expect(TAG_LABEL[t]).toBeDefined();
        expect(tagLabel(t)).toBe(TAG_LABEL[t]);
      }
    }
  });

  it("falls back to the input for a value it does not know", () => {
    expect(tagLabel("Roamer")).toBe("Ate all over town");
    expect(tagLabel("Mystery")).toBe("Mystery");
  });
});
