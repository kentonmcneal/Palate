import { cafeFormatAdjustment, currentSlot } from "../recommendation/scoring";

// 2026-09-03 is a Thursday; 2026-09-05 is a Saturday.
const at = (h: number, weekend = false) => new Date(2026, 8, weekend ? 5 : 3, h, 0);

const noAffinity = { formats: {} } as never;
const cafeLover = { formats: { "café": 40, restaurant: 60 } } as never;

const place = (format_class: string) => ({ format_class } as never);
const adj = (fc: string, when: Date | undefined, graph = noAffinity) =>
  cafeFormatAdjustment(graph, place(fc), { now: when } as never);

describe("currentSlot", () => {
  it("splits the day, with weekend brunch", () => {
    expect(currentSlot(at(8))).toBe("breakfast");
    expect(currentSlot(at(12, true))).toBe("brunch");
    expect(currentSlot(at(12))).toBe("lunch");
    expect(currentSlot(at(19))).toBe("dinner");
    expect(currentSlot(at(23))).toBe("late_night");
  });
});

describe("coffee shops by time of day", () => {
  it("is not penalised at breakfast — it is the right answer, not a compromise", () => {
    expect(adj("café", at(8))).toBe(0);
  });

  it("is penalised progressively harder through the day", () => {
    const lunch = adj("café", at(12));
    const dinner = adj("café", at(19));
    const lateNight = adj("café", at(23));
    // More negative = stronger demotion.
    expect(lunch).toBeLessThan(0);
    expect(dinner).toBeLessThan(lunch);
    expect(lateNight).toBeLessThan(dinner);
  });

  it("penalises a café at dinner more than at lunch", () => {
    // The old rule treated lunch, dinner and late night identically. A café is
    // a plausible lunch and a poor dinner.
    expect(adj("café", at(19))).toBeLessThan(adj("café", at(12)));
  });
});

describe("dessert runs the opposite way", () => {
  it("is worst in the morning and best late", () => {
    const breakfast = adj("dessert", at(8));
    const afterDinner = adj("dessert", at(23));
    expect(breakfast).toBeLessThan(afterDinner);
  });

  it("is barely demoted after dinner", () => {
    // A dessert spot at 11pm is a good call, not a fallback.
    expect(adj("dessert", at(23))).toBeGreaterThan(-4);
  });
});

describe("guards", () => {
  it("leaves non-café formats alone", () => {
    expect(adj("restaurant", at(19))).toBe(0);
    expect(adj("", at(19))).toBe(0);
  });

  it("falls back to midday rather than assuming the worst when the time is unknown", () => {
    expect(adj("café", undefined)).toBe(adj("café", at(12)));
  });

  it("cancels the penalty for someone who actually favours cafés", () => {
    // Their own behaviour outranks the heuristic.
    expect(adj("café", at(19), cafeLover)).toBe(0);
  });
});
