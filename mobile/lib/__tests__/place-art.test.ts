import { initialsOf } from "../../components/PlaceArt";

// The art is the only thing standing in for photography, so the two
// properties that make it work are worth pinning: it must be stable, and the
// initials must be the ones a person would pick.
describe("initialsOf", () => {
  it("takes the first letters of the first two real words", () => {
    expect(initialsOf("Kirk's SteakBurgers")).toBe("KS");
    expect(initialsOf("Hong Kong Restaurant")).toBe("HK");
  });

  it("skips a leading article — 'The Anchor' is AN, not TH", () => {
    expect(initialsOf("The Anchor")).toBe("AN");
    expect(initialsOf("El Farolito")).toBe("FA");
    expect(initialsOf("The Cheesecake Factory")).toBe("CF");
  });

  it("falls back to two letters of a one-word name", () => {
    expect(initialsOf("ANINA")).toBe("AN");
  });

  it("survives punctuation, accents and emoji without producing junk", () => {
    expect(initialsOf("Café Réveille")).toBe("CR");
    expect(initialsOf("🍕 Tony's")).toBe("TO");
  });

  it("never returns empty, whatever it is handed", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("!!!")).toBe("?");
  });
});
