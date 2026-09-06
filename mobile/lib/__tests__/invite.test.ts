import { normalizeCode, shareText, joinedLine, INVITE_URL } from "../invite";

describe("invite codes", () => {
  it("forgives how a code was typed without changing what it says", () => {
    expect(normalizeCode("k7m4pq")).toBe("K7M4PQ");
    expect(normalizeCode(" K7M4-PQ ")).toBe("K7M4PQ");
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("   ")).toBeNull();
  });

  it("never substitutes a character for one that looks like it", () => {
    // The generator's alphabet has no I, O, 0 or 1, so those never appear in a
    // real code. Mapping them to a lookalike would quietly redeem somebody
    // else's code; an unmatched code should just fail to match.
    expect(normalizeCode("IO01AB")).toBe("IO01AB");
  });

  it("says who is inviting and where to go, with the code on its own line", () => {
    const text = shareText("K7M4PQ", "Kenton");
    expect(text).toContain("Kenton is on Palate");
    expect(text).toContain("Invite code: K7M4PQ");
    expect(text).toContain(INVITE_URL);
    expect(text).not.toMatch(/—/);
    // Falls back to first person when the profile has no name yet.
    expect(shareText("K7M4PQ")).toContain("I am on Palate");
    expect(shareText("K7M4PQ", "   ")).toContain("I am on Palate");
  });

  it("shows a join count only once there is one", () => {
    expect(joinedLine(0)).toBeNull();
    expect(joinedLine(1)).toBe("1 person has joined with your code");
    expect(joinedLine(4)).toBe("4 people have joined with your code");
  });
});
