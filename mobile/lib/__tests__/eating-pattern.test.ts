import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildEatingPattern, smoothHours, patternFit, usualLastMealHour, personalDigestHour,
  saveEatingPattern, loadEatingPattern, EATING_PATTERN_KEY,
  MIN_VISITS_FOR_FIT, MIN_VISITS_FOR_DIGEST, type EatingPattern,
} from "../eating-pattern";
import { aggregate } from "../taste-vector";

/** A 24-bin histogram from {hour: count}. */
function hourly(counts: Record<number, number>): number[] {
  const h: number[] = new Array(24).fill(0);
  for (const [k, v] of Object.entries(counts)) h[Number(k)] = v;
  return h;
}
const NO_DOWS: number[] = new Array(7).fill(0);
const THURSDAY = new Date(2026, 8, 3, 12, 0);
const SATURDAY = new Date(2026, 8, 5, 12, 0);

function pattern(counts: Record<number, number>): EatingPattern {
  return buildEatingPattern(hourly(counts), NO_DOWS, 1000);
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("smoothHours", () => {
  it("lends half of each visit to the hour either side", () => {
    const s = smoothHours(hourly({ 19: 1 }));
    expect(s[19]).toBe(1);
    expect(s[18]).toBe(0.5);
    expect(s[20]).toBe(0.5);
    expect(s.reduce((a, b) => a + b, 0)).toBe(2);
    expect(s.filter((n) => n > 0)).toHaveLength(3);
  });

  it("treats 11pm and midnight as neighbours", () => {
    const s = smoothHours(hourly({ 23: 2 }));
    expect(s[0]).toBe(1);
    expect(s[22]).toBe(1);
  });

  it("ignores garbage bins rather than propagating NaN", () => {
    const raw = hourly({ 12: 4 });
    raw[3] = Number.NaN;
    raw[5] = -7;
    const s = smoothHours(raw);
    expect(s.every((n) => Number.isFinite(n) && n >= 0)).toBe(true);
    expect(s[12]).toBe(4);
  });
});

describe("buildEatingPattern", () => {
  it("counts raw visits as total and stores smoothed hours", () => {
    const p = buildEatingPattern(hourly({ 12: 3, 19: 5 }), [1, 2, 0, 0, 3, 1, 1], 42);
    expect(p.total).toBe(8);
    expect(p.hours[19]).toBe(5);
    expect(p.hours[18]).toBe(2.5);
    expect(p.dows).toEqual([1, 2, 0, 0, 3, 1, 1]);
    expect(p.updatedAt).toBe(42);
  });

  it("takes the taste vector's histograms as they come", () => {
    // The real producer. Two visits at the same restaurant, one at noon and
    // one at seven, must come out as two raw visits and the right hours.
    const v = aggregate([
      { visited_at: new Date(2026, 8, 1, 12, 15).toISOString(), meal_type: null, restaurant: { id: "r1", name: "R" } },
      { visited_at: new Date(2026, 8, 2, 19, 5).toISOString(), meal_type: null, restaurant: { id: "r1", name: "R" } },
    ], []);
    const p = buildEatingPattern(v.hourly, v.dowCounts);
    expect(p.total).toBe(2);
    expect(p.hours[12]).toBe(1);
    expect(p.hours[19]).toBe(1);
    expect(p.dows.reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("patternFit", () => {
  it("says nothing without a pattern or under five visits", () => {
    expect(patternFit(null, 19, 4)).toBeNull();
    expect(patternFit(pattern({ 19: MIN_VISITS_FOR_FIT - 1 }), 19, 4)).toBeNull();
    expect(patternFit(pattern({ 19: MIN_VISITS_FOR_FIT }), 19, 4)).not.toBeNull();
  });

  it("scores the person's own peak as 1 once the history is deep", () => {
    // Before shrinkage the peak is exactly 1; with a thousand visits the
    // shrinkage toward 0.5 is under one percent.
    const fit = patternFit(pattern({ 19: 1000 }), 19, 4);
    expect(fit).toBeGreaterThan(0.99);
    expect(fit).toBeLessThanOrEqual(1);
  });

  it("shrinks toward 0.5 when there are few visits", () => {
    // trust = 5 / (5 + 10), so the peak reads 0.5 + 0.5 * (1/3).
    expect(patternFit(pattern({ 19: 5 }), 19, 4)).toBeCloseTo(0.5 + 0.5 / 3, 6);
    const thin = patternFit(pattern({ 19: 5 }), 19, 4)!;
    const mid = patternFit(pattern({ 19: 50 }), 19, 4)!;
    const deep = patternFit(pattern({ 19: 1000 }), 19, 4)!;
    expect(thin).toBeLessThan(mid);
    expect(mid).toBeLessThan(deep);
  });

  it("reads an hour this person never eats at as weak", () => {
    // 3pm for someone whose meals are all at noon and seven. Near zero, and
    // below the 0.5 that means "no opinion".
    const p = pattern({ 12: 100, 19: 100 });
    expect(patternFit(p, 15, 4)!).toBeLessThan(0.1);
    expect(patternFit(p, 15, 4)!).toBeLessThan(patternFit(p, 12, 4)!);
  });

  it("reads a late lunch as strong for someone whose lunches run late", () => {
    const p = pattern({ 15: 40, 19: 40 });
    expect(patternFit(p, 15, 4)!).toBeGreaterThan(0.85);
  });

  it("is relative to the person, not to a population", () => {
    // Half as many visits at noon as at seven: noon reads as exactly half the
    // peak, which shrinkage leaves at 0.5, strictly between an hour they never
    // eat at and their own busiest hour.
    const p = pattern({ 12: 50, 19: 100 });
    const never = patternFit(p, 3, 4)!;
    const noon = patternFit(p, 12, 4)!;
    const seven = patternFit(p, 19, 4)!;
    expect(noon).toBeCloseTo(0.5, 6);
    expect(noon).toBeGreaterThan(never);
    expect(noon).toBeLessThan(seven);
  });

  it("wraps out-of-range hours onto the clock", () => {
    const p = pattern({ 23: 20 });
    expect(patternFit(p, 23, 4)).toBe(patternFit(p, -1, 4));
    expect(patternFit(p, 23, 4)).toBe(patternFit(p, 47, 4));
  });
});

describe("usualLastMealHour", () => {
  it("finds the hour a dinner-heavy week is done by", () => {
    // Three lunches at noon, dinners at six, seven and eight. Smoothing
    // spreads each dinner an hour either side, so 85% of the eating is
    // behind this person by 8pm.
    const p = pattern({ 12: 3, 18: 2, 19: 4, 20: 1 });
    expect(usualLastMealHour(p, false)).toBe(20);
  });

  it("puts a six o'clock eater's last hour at seven", () => {
    // The visit at 18 lends half its weight to 19, and that is where the
    // cumulative share crosses 85%.
    expect(usualLastMealHour(pattern({ 18: 30 }), false)).toBe(19);
  });

  it("counts a 1am stop as the end of the night, not the start of the day", () => {
    // Half the meals at nine, half at one in the morning. Walked from
    // midnight, 1am would come first and the person would look like an
    // early eater; walked from 4am it is correctly the last thing they do.
    const p = pattern({ 21: 5, 1: 5 });
    expect(usualLastMealHour(p, false)).toBe(1);
  });

  it("returns null without a histogram", () => {
    expect(usualLastMealHour(null, false)).toBeNull();
    expect(usualLastMealHour(pattern({}), false)).toBeNull();
  });
});

describe("personalDigestHour", () => {
  it("asks an early eater at 8pm instead of 9", () => {
    expect(personalDigestHour(pattern({ 18: 30 }), THURSDAY, 21)).toBe(20);
  });

  it("asks a late eater at 11pm", () => {
    expect(personalDigestHour(pattern({ 22: 30 }), THURSDAY, 21)).toBe(23);
  });

  it("never fires before 8pm, however early the meals", () => {
    expect(personalDigestHour(pattern({ 12: 30 }), THURSDAY, 21)).toBe(20);
  });

  it("never fires after 11pm, and does not mistake 1am for early", () => {
    expect(personalDigestHour(pattern({ 23: 30 }), THURSDAY, 21)).toBe(23);
    expect(personalDigestHour(pattern({ 21: 5, 1: 5 }), THURSDAY, 21)).toBe(23);
  });

  it("keeps the fallback under ten visits and without a pattern", () => {
    expect(personalDigestHour(null, THURSDAY, 21)).toBe(21);
    expect(personalDigestHour(pattern({ 18: MIN_VISITS_FOR_DIGEST - 1 }), THURSDAY, 21)).toBe(21);
    expect(personalDigestHour(pattern({ 18: MIN_VISITS_FOR_DIGEST }), THURSDAY, 21)).toBe(20);
    // The weekend default is later; an unknown account keeps it.
    expect(personalDigestHour(null, SATURDAY, 23)).toBe(23);
  });

  it("applies the person's hour on weekends too", () => {
    // One histogram for all seven days for now, so a known early eater is
    // asked at eight on a Saturday as well.
    expect(personalDigestHour(pattern({ 18: 30 }), SATURDAY, 23)).toBe(20);
  });
});

describe("storage", () => {
  it("round-trips through AsyncStorage", async () => {
    const p = pattern({ 12: 3, 19: 5 });
    await saveEatingPattern(p);
    expect(await loadEatingPattern()).toEqual(p);
    expect(await AsyncStorage.getItem(EATING_PATTERN_KEY)).not.toBeNull();
  });

  it("returns null when nothing is stored", async () => {
    expect(await loadEatingPattern()).toBeNull();
  });

  it("returns null for a corrupt or misshapen record", async () => {
    await AsyncStorage.setItem(EATING_PATTERN_KEY, "{not json");
    expect(await loadEatingPattern()).toBeNull();
    await AsyncStorage.setItem(EATING_PATTERN_KEY, JSON.stringify({ hours: [1, 2], dows: [], total: 3 }));
    expect(await loadEatingPattern()).toBeNull();
  });

  it("swallows storage failures in both directions", async () => {
    const get = jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("nope"));
    expect(await loadEatingPattern()).toBeNull();
    get.mockRestore();
    const set = jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("nope"));
    await expect(saveEatingPattern(pattern({ 19: 5 }))).resolves.toBeUndefined();
    set.mockRestore();
  });
});
