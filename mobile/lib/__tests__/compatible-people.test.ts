import { compatibilityLine, type CompatiblePerson } from "../social";

const person = (over: Partial<CompatiblePerson> = {}): CompatiblePerson => ({
  id: "1", display_name: "Candice", username: null, avatar_url: null,
  shared_places: 0, shared_cuisines: 0, score: 0, top_shared: null, ...over,
});

// A row has to say something the reader can check. "You have both been to
// McDonald's" is verifiable; "82% match" is a number you either trust or you
// do not, and this app has already removed one of those from Discover cards.
describe("compatibilityLine", () => {
  it("names the place when there is exactly one", () => {
    expect(compatibilityLine(person({ shared_places: 1, top_shared: "K'Far Cafe" })))
      .toBe("You have both been to K'Far Cafe");
  });

  it("counts them and still names one when there are several", () => {
    const line = compatibilityLine(person({ shared_places: 4, top_shared: "Sampan" }));
    expect(line).toContain("4 places");
    expect(line).toContain("Sampan");
  });

  it("falls back to cuisines when no place is shared", () => {
    expect(compatibilityLine(person({ shared_cuisines: 3 }))).toBe("You eat 3 of the same cuisines");
  });

  it("uses the singular for one cuisine", () => {
    expect(compatibilityLine(person({ shared_cuisines: 1 }))).toMatch(/one of the same/);
  });

  it("never claims a place it cannot name", () => {
    // shared_places > 0 but the name did not resolve: do not say "both been to null".
    expect(compatibilityLine(person({ shared_places: 2, top_shared: null })))
      .not.toContain("null");
  });

  it("says something honest when there is only faint overlap", () => {
    expect(compatibilityLine(person())).toBe("Some overlap with how you eat");
  });
});
