import {
  normalizeUsername, validateUsername, suggestUsername, USERNAME_MIN, USERNAME_MAX,
} from "../username";

// The handle is how everyone else refers to you, and it is now required at
// signup. A field that quietly changes your answer teaches you not to trust it.
describe("validateUsername", () => {
  it("accepts a plain handle", () => {
    expect(validateUsername("kenton")).toEqual({ ok: true, value: "kenton" });
  });

  it("lowercases without complaining — capitals are a habit, not a mistake", () => {
    expect(validateUsername("Kenton")).toEqual({ ok: true, value: "kenton" });
  });

  it("keeps underscores and digits", () => {
    expect(validateUsername("ken_ton99")).toEqual({ ok: true, value: "ken_ton99" });
  });

  it("says what is wrong instead of silently deleting it", () => {
    const r = validateUsername("ken ton!");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Letters, numbers and underscores/);
  });

  it("enforces the length the database enforces", () => {
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("a".repeat(USERNAME_MAX + 1)).ok).toBe(false);
    expect(validateUsername("a".repeat(USERNAME_MIN)).ok).toBe(true);
    expect(validateUsername("a".repeat(USERNAME_MAX)).ok).toBe(true);
  });

  it("asks rather than scolds when the field is empty", () => {
    const r = validateUsername("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toMatch(/invalid|error/i);
  });
});

describe("normalizeUsername", () => {
  it("matches what the database will store", () => {
    expect(normalizeUsername("  Ken_Ton99 ")).toBe("ken_ton99");
  });
});

describe("suggestUsername", () => {
  it("prefers the display name", () => {
    expect(suggestUsername("kentonmcneal@gmail.com", "Kenton M")).toBe("kentonm");
  });

  it("falls back to the email local part", () => {
    expect(suggestUsername("kentonmcneal@gmail.com", null)).toBe("kentonmcneal");
  });

  it("never suggests something the rules would reject", () => {
    for (const [email, name] of [["a@b.com", "K"], [null, null], ["x@y.com", "!!"]] as const) {
      const s = suggestUsername(email, name);
      if (s) expect(validateUsername(s).ok).toBe(true);
    }
  });

  it("truncates a long name to the maximum", () => {
    const s = suggestUsername(null, "A".repeat(40));
    expect(s.length).toBe(USERNAME_MAX);
  });
});
