import { normalizeRouteId, isUsableProfileId, profileIdFromRoute } from "../profile-route";

const REAL = "c766a8ba-3716-4cb7-b6f4-b3f25667da5e";

/**
 * The case this file exists for.
 *
 * Three of four notification deep-links push `/profile/${data.user_id ?? ""}`,
 * so a payload without user_id navigates with an empty id. That reached
 * get_friend_profile_snapshot("") and fired captureError against the one RPC
 * this project watches after it failed silently for sixty-five migrations — a
 * bad push payload manufacturing a false alarm on the signal most likely to be
 * believed.
 */
describe("an unusable id never reaches the database", () => {
  it.each([
    ["empty string, the `?? \"\"` case", ""],
    ["whitespace only", "   "],
    ["undefined", undefined],
    ["null", null],
    ["the literal string undefined", "undefined"],
    ["the literal string null", "null"],
    ["a username rather than an id", "kenton"],
    ["a truncated uuid", "c766a8ba-3716"],
    ["a uuid with a trailing comma from array interpolation", `${REAL},${REAL}`],
  ])("rejects %s", (_label, input) => {
    expect(profileIdFromRoute(input as string | undefined)).toBeNull();
    expect(isUsableProfileId(input as string | undefined)).toBe(false);
  });
});

describe("a real id passes through unchanged", () => {
  it("accepts a uuid", () => {
    expect(profileIdFromRoute(REAL)).toBe(REAL);
  });

  it("accepts uppercase, because Postgres does", () => {
    expect(profileIdFromRoute(REAL.toUpperCase())).toBe(REAL.toUpperCase());
  });

  it("trims incidental whitespace rather than rejecting a good id", () => {
    expect(profileIdFromRoute(` ${REAL} `)).toBe(REAL);
  });

  // expo-router types a param as string | string[]; a repeated segment arrives
  // as an array, and the old `id as string` cast would have interpolated it.
  it("takes the first value when the router hands over an array", () => {
    expect(profileIdFromRoute([REAL, "second"])).toBe(REAL);
  });

  it("rejects an array whose first value is unusable", () => {
    expect(profileIdFromRoute(["", REAL])).toBeNull();
  });
});

describe("normalizeRouteId is only about shape", () => {
  it("keeps a non-uuid string, leaving judgement to the caller", () => {
    expect(normalizeRouteId("kenton")).toBe("kenton");
  });

  it("returns null for absent or blank input", () => {
    expect(normalizeRouteId(undefined)).toBeNull();
    expect(normalizeRouteId("")).toBeNull();
    expect(normalizeRouteId([])).toBeNull();
  });
});
