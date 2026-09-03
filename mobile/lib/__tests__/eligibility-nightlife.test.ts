import { inferRecommendationEligibility } from "../../../supabase/functions/_shared/classifier";

function derived(occasion_tags: string[] = []) {
  return { chain_type: "independent", cuisine_type: "american", format_class: "casual", occasion_tags };
}

function place(opts: {
  name?: string;
  primaryType?: string;
  types?: string[];
  /** Occasion tags mined from review text — the only window this function has
   *  into how a venue actually behaves. */
  occasionTags?: string[];
}) {
  return {
    id: "x",
    displayName: { text: opts.name ?? "Some Place" },
    primaryType: opts.primaryType,
    types: opts.types ?? [],
  } as never;
}

function eligibility(opts: Parameters<typeof place>[0]) {
  return inferRecommendationEligibility(place(opts), derived(opts.occasionTags));
}

describe("nightclub exclusion", () => {
  // The bug this replaces: the rule required !hasRestaurantType(types), and
  // RESTAURANT_TYPES contains `bar`. So any club tagged night_club + bar —
  // essentially every club that serves anything — escaped entirely. The guard
  // caught only clubs with no food type at all, which would never have
  // surfaced anyway.
  it("excludes a bar-primary venue that reads as a party spot", () => {
    // This is the case the user hit: Google tags it `bar`, RESTAURANT_TYPES
    // contains `bar`, so it passed every gate and was recommended for dinner.
    const r = eligibility({
      name: "Sable", primaryType: "bar", types: ["bar", "restaurant"],
      occasionTags: ["party"],
    });
    expect(r.eligibility).toBe(0);
    expect(r.reason).toBe("nightlife");
  });

  it("excludes a night_club primary type (already handled upstream)", () => {
    const r = eligibility({ name: "Nightfall", primaryType: "night_club", types: ["night_club", "bar"] });
    expect(r.eligibility).toBe(0);
  });

  it("excludes a club by name even without the party tag", () => {
    const r = eligibility({
      name: "Velvet Nightclub", primaryType: "bar", types: ["bar", "restaurant"],
    });
    expect(r.eligibility).toBe(0);
  });

  it("excludes a restaurant carrying night_club that reviews as a party spot", () => {
    const r = eligibility({
      name: "Aura", primaryType: "restaurant", types: ["restaurant", "night_club"],
      occasionTags: ["party"],
    });
    expect(r.eligibility).toBe(0);
    expect(r.reason).toBe("nightlife");
  });

  it("keeps a restaurant with a late licence that reviews as a restaurant", () => {
    // A secondary night_club tag alone must not condemn a real dining room, or
    // the fix trades one wrong answer for another.
    const r = eligibility({
      name: "Marabella", primaryType: "restaurant", types: ["restaurant", "night_club"],
      occasionTags: ["date-night"],
    });
    expect(r.eligibility).toBeGreaterThan(0);
  });

  it("keeps an ordinary bar that nobody describes as a party", () => {
    // A neighbourhood gastropub is a real dining destination.
    const r = eligibility({ name: "Corner Tap", primaryType: "bar", types: ["bar", "restaurant"] });
    expect(r.eligibility).toBeGreaterThan(0);
  });

  it("keeps a normal restaurant with 'Lounge' in the name", () => {
    const r = eligibility({ name: "The Garden Lounge", primaryType: "restaurant", types: ["restaurant"] });
    expect(r.eligibility).toBeGreaterThan(0);
  });
});
