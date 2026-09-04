import {
  applyMood, buildMoodChips, moodFallbackNote, isIntentMood,
  QUICK, SIT_DOWN, SOMEWHERE_NEW, SURPRISE,
} from "../mood";

const place = (
  name: string,
  cuisine: string,
  format_class: string | null,
  visited = false,
) => ({ name, cuisine, format_class, visited });

const nearby = [
  place("Chipotle", "mexican", "fast_casual"),
  place("K'Far Cafe", "bakery", "café", true),
  place("Sampan", "asian", "casual_dining", true),
  place("Vetri", "italian", "fine_dining"),
  place("Hen House", "american", "casual_dining"),
];

// A mood is not always "what food" — often it is "what kind of evening", and
// the row could only ever ask the first.
describe("intent moods", () => {
  it("Quick keeps counter service, cafés and bakeries", () => {
    const { items, matched } = applyMood(nearby, QUICK, []);
    expect(matched).toBe(true);
    expect(items.map((r) => r.name)).toEqual(["Chipotle", "K'Far Cafe"]);
  });

  it("Sit down keeps casual and fine dining", () => {
    const { items } = applyMood(nearby, SIT_DOWN, []);
    expect(items.map((r) => r.name)).toEqual(["Sampan", "Vetri", "Hen House"]);
  });

  it("Somewhere new drops places you have been", () => {
    const { items } = applyMood(nearby, SOMEWHERE_NEW, []);
    expect(items.map((r) => r.name)).toEqual(["Chipotle", "Vetri", "Hen House"]);
  });

  it("preserves ranking — a mood narrows, it never re-scores", () => {
    const { items } = applyMood(nearby, SIT_DOWN, []);
    const original = nearby.filter((r) => items.includes(r));
    expect(items).toEqual(original);
  });

  it("never claims an unlabelled venue for either format mood", () => {
    // The classifier has not labelled this one, so no mood may assert it
    // satisfies them — silence beats a wrong promise.
    const unknown = [place("Mystery", "american", null)];
    expect(applyMood(unknown, QUICK, []).matched).toBe(false);
    expect(applyMood(unknown, SIT_DOWN, []).matched).toBe(false);
  });

  it("falls back to the full list rather than showing nothing", () => {
    const onlyQuick = [place("Chipotle", "mexican", "fast_casual")];
    const { items, matched } = applyMood(onlyQuick, SIT_DOWN, []);
    expect(matched).toBe(false);
    expect(items).toHaveLength(1);
  });

  it("explains the fallback in words specific to the mood", () => {
    expect(moodFallbackNote(QUICK)).toMatch(/quick/i);
    expect(moodFallbackNote(SIT_DOWN)).toMatch(/sit down/i);
    expect(moodFallbackNote(SOMEWHERE_NEW)).toMatch(/been to everything/i);
  });

  it("keeps intents distinct from cuisines, which could otherwise collide", () => {
    expect(isIntentMood(QUICK)).toBe(true);
    expect(isIntentMood("mexican")).toBe(false);
    expect(isIntentMood(SURPRISE)).toBe(false);
    expect(isIntentMood(null)).toBe(false);
  });

  it("Somewhere new and Surprise me are not the same question", () => {
    // A new burger place is new but not surprising to a burger eater.
    const list = [place("New Burger Co", "american", "fast_casual")];
    expect(applyMood(list, SOMEWHERE_NEW, ["american"]).matched).toBe(true);
    expect(applyMood(list, SURPRISE, ["american"]).matched).toBe(false);
  });
});

describe("buildMoodChips", () => {
  const breakdown = [
    { cuisine: "american", count: 9, pct: 0.4 },
    { cuisine: "mexican", count: 4, pct: 0.2 },
    { cuisine: "italian", count: 3, pct: 0.15 },
    { cuisine: "thai", count: 2, pct: 0.1 },
    { cuisine: "korean", count: 2, pct: 0.1 },
    { cuisine: "other", count: 5, pct: 0.05 },
  ] as never;

  it("leads with intents, because you know the evening before the food", () => {
    const chips = buildMoodChips(breakdown);
    expect(chips.slice(0, 4).map((c) => c.label))
      .toEqual(["Anything", "Quick", "Sit down", "Somewhere new"]);
    expect(chips[chips.length - 1].label).toBe("Surprise me");
  });

  it("stays a shortcut rather than a menu", () => {
    // Four intents plus cuisines plus Surprise; the cuisine cap came down to
    // make room rather than letting the row grow without limit.
    expect(buildMoodChips(breakdown).length).toBeLessThanOrEqual(9);
  });

  it("still never offers 'other', which nobody is in the mood for", () => {
    expect(buildMoodChips(breakdown).map((c) => c.key)).not.toContain("other");
  });
});
