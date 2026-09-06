import { IDENTITY_BLURB, WHAT_ARE_PALATES } from "../palate/palateCopy";
import { IDENTITY_NAME, indefinite, Indefinite } from "../palate/palateNames";

// ============================================================================
// Renaming the identities broke grammar the old names had been hiding.
// ----------------------------------------------------------------------------
// Curator, Forager, Steward and Anchor all start with a consonant, so prose
// could hard-code "A Forager would walk into the next door down" and read
// fine. "A Explorer" does not. These tests fail on any prose that names an
// identity with the wrong article, or that names an old identity at all.
// ============================================================================

describe("identity prose", () => {
  const OLD = /\b(Curator|Forager|Steward|Anchors?)\b/;

  it("never shows a name the app no longer uses", () => {
    for (const [key, b] of Object.entries(IDENTITY_BLURB)) {
      expect({ key, s: b.description }).not.toMatchObject({ s: expect.stringMatching(OLD) });
      expect(b.tagline).not.toMatch(OLD);
      expect(b.shareDescriptor).not.toMatch(OLD);
    }
    expect(WHAT_ARE_PALATES.intro).not.toMatch(OLD);
    expect(WHAT_ARE_PALATES.tagsIntro).not.toMatch(OLD);
  });

  it("never writes 'a Explorer'", () => {
    const all = Object.values(IDENTITY_BLURB)
      .flatMap((b) => [b.description, b.tagline, b.shareDescriptor])
      .concat(Object.values(WHAT_ARE_PALATES).filter((v) => typeof v === "string") as string[]);
    for (const name of Object.values(IDENTITY_NAME)) {
      const wrong = /^[AEIOU]/i.test(name) ? new RegExp(`\\ba ${name}\\b`, "i") : new RegExp(`\\ban ${name}\\b`, "i");
      for (const s of all) expect(s).not.toMatch(wrong);
    }
  });

  it("picks the article from the word, not from a guess", () => {
    expect(indefinite("Explorer")).toBe("an Explorer");
    expect(indefinite("Tastemaker")).toBe("a Tastemaker");
    expect(Indefinite("Explorer")).toBe("An Explorer");
    expect(Indefinite("Connoisseur")).toBe("A Connoisseur");
  });
});

// ============================================================================
// The house style, enforced.
// ----------------------------------------------------------------------------
// The founder: "Need to remove any language that includes hyphens and update
// it as that gives AI." He means the em dash, which is the strongest tell.
// This pins the identity copy, which is the largest block of prose in the app
// and the one most likely to grow by accretion.
// ============================================================================
describe("house style", () => {
  const prose = () => [
    ...Object.values(IDENTITY_BLURB).flatMap((b) => [b.description, b.tagline, b.shareDescriptor]),
    ...(Object.values(WHAT_ARE_PALATES).filter((v) => typeof v === "string") as string[]),
  ];

  it("uses no em dashes", () => {
    for (const s of prose()) expect(s).not.toMatch(/—/);
  });

  it("does not reach for the vague words", () => {
    for (const s of prose()) {
      expect(s.toLowerCase()).not.toMatch(/\b(elevated|seamless|curated|journey|delve|leverage)\b/);
    }
  });
});
