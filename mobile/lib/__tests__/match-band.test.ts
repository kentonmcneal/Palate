import { matchBand, matchScoreColor } from "../match-score";

// The card led with a large glowing "93 match". The score is a weighted sum of
// attribute overlaps with a neutral 50 floor and a hand-tuned personal
// adjustment — a few points is noise, so presenting it as a headline figure
// claims precision the model does not have, and reads as an AI app rather than
// a dining app. Bands are the resolution that is actually real.
describe("matchBand", () => {
  it("bands the score the same way the colour tiers always did", () => {
    expect(matchBand(93)).toBe("Strong match");
    expect(matchBand(80)).toBe("Strong match");
    expect(matchBand(79)).toBe("Good match");
    expect(matchBand(60)).toBe("Good match");
    expect(matchBand(59)).toBe("Worth a look");
    expect(matchBand(40)).toBe("Worth a look");
    expect(matchBand(39)).toBe("A stretch");
  });

  it("agrees with matchScoreColor at every boundary", () => {
    // If these ever diverge, a card shows a red "A stretch" or a grey
    // "Strong match" and the user rightly stops trusting both.
    for (const n of [0, 39, 40, 59, 60, 79, 80, 99]) {
      const sameBand = [n, n].map(matchBand);
      const sameColor = [n, n].map(matchScoreColor);
      expect(sameBand[0]).toBe(sameBand[1]);
      expect(sameColor[0]).toBe(sameColor[1]);
    }
    expect(matchScoreColor(80)).toBe(matchScoreColor(99));
    expect(matchBand(80)).toBe(matchBand(99));
    expect(matchScoreColor(79)).not.toBe(matchScoreColor(80));
    expect(matchBand(79)).not.toBe(matchBand(80));
  });

  it("never claims a match it cannot back when the score is missing", () => {
    expect(matchBand(null)).toBe("Worth a look");
    expect(matchBand(undefined)).toBe("Worth a look");
  });

  it("says nothing numeric", () => {
    for (const n of [0, 25, 50, 75, 99]) {
      expect(matchBand(n)).not.toMatch(/\d/);
    }
  });
});
