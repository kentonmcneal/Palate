import { normalizeHandle, instagramUrl, tiktokUrl } from "../social";

// People paste whatever is on their clipboard. Storing that verbatim produces
// a broken link on someone else's profile, which is the kind of bug nobody
// reports — they just quietly stop tapping it.
describe("normalizeHandle", () => {
  it("takes a bare handle", () => {
    expect(normalizeHandle("kenton")).toBe("kenton");
  });

  it("strips a leading @", () => {
    expect(normalizeHandle("@kenton")).toBe("kenton");
    expect(normalizeHandle("@@kenton")).toBe("kenton");
  });

  it("reduces a pasted profile URL to the handle", () => {
    expect(normalizeHandle("https://www.instagram.com/kenton")).toBe("kenton");
    expect(normalizeHandle("instagram.com/kenton/")).toBe("kenton");
    expect(normalizeHandle("https://www.tiktok.com/@kenton")).toBe("kenton");
    expect(normalizeHandle("tiktok.com/@kenton?lang=en")).toBe("kenton");
  });

  it("keeps dots and underscores, which are legal in both", () => {
    expect(normalizeHandle("ken.ton_1")).toBe("ken.ton_1");
  });

  it("rejects anything the database CHECK would reject, rather than failing on write", () => {
    // A rejected write surfaces as an error the user cannot act on, so the
    // client has to agree with migration 0056's constraints.
    expect(normalizeHandle("ken ton")).toBeNull();
    expect(normalizeHandle("ken/ton")).toBeNull();
    expect(normalizeHandle("a".repeat(31))).toBeNull();
    expect(normalizeHandle("")).toBeNull();
    expect(normalizeHandle("   ")).toBeNull();
    expect(normalizeHandle(null)).toBeNull();
    expect(normalizeHandle(undefined)).toBeNull();
  });

  it("does not mistake a bare word for a URL", () => {
    expect(normalizeHandle("tiktok")).toBe("tiktok");
  });
});

describe("profile links", () => {
  it("rebuilds the canonical URL from a bare handle", () => {
    expect(instagramUrl("kenton")).toBe("https://instagram.com/kenton");
    expect(tiktokUrl("kenton")).toBe("https://tiktok.com/@kenton");
  });
});
