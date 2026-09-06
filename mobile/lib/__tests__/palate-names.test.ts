import {
  IDENTITY_NAME, identityName, identityWithArticle, identityTitle, displayStoredPersona, storedPersonaKey,
} from "../palate/palateNames";

describe("identity names", () => {
  it("renames every quadrant without touching the keys", () => {
    expect(IDENTITY_NAME.Curator).toBe("Tastemaker");
    expect(IDENTITY_NAME.Forager).toBe("Explorer");
    expect(IDENTITY_NAME.Steward).toBe("Connoisseur");
    expect(IDENTITY_NAME.Anchor).toBe("Regular");
  });

  it("gets the article right, including the vowel", () => {
    expect(identityWithArticle("Forager")).toBe("an Explorer");
    expect(identityWithArticle("Curator")).toBe("a Tastemaker");
  });

  it("does not put an article in front of the learning state", () => {
    expect(identityWithArticle("Learning")).toBe("Warming Up");
    expect(identityTitle("Learning")).toBe("Warming Up");
  });

  it("maps the five names the server used to mint onto the real identities", () => {
    // The founder's complaint, exactly: this string on his own profile.
    expect(displayStoredPersona("The Fast Casual Regular")).toBe("The Regular");
    expect(displayStoredPersona("The Loyalist")).toBe("The Connoisseur");
    expect(displayStoredPersona("The Café Dweller")).toBe("The Regular");
  });

  it("accepts what the client itself writes, bare or titled", () => {
    expect(displayStoredPersona("Explorer")).toBe("The Explorer");
    expect(displayStoredPersona("The Explorer")).toBe("The Explorer");
  });

  it("passes through anything it does not recognise rather than blanking it", () => {
    expect(displayStoredPersona("The Sandwich Guy")).toBe("The Sandwich Guy");
    expect(displayStoredPersona(null)).toBeNull();
  });

  it("recovers the key behind a stored label, so its meaning can sit under it", () => {
    // The Wrapped hero shows a tagline under every name; the tagline is
    // looked up by key, so a stored string has to resolve to one.
    expect(storedPersonaKey("The Fast Casual Regular")).toBe("Anchor");
    expect(storedPersonaKey("Explorer")).toBe("Forager");
    expect(storedPersonaKey("The Tastemaker")).toBe("Curator");
    expect(storedPersonaKey("Warming Up")).toBe("Learning");
    expect(storedPersonaKey("The Sandwich Guy")).toBeNull();
    expect(storedPersonaKey(null)).toBeNull();
  });
});
