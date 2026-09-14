import { INVITE_URL } from "../invite";
import { INVITE_BASE_URL } from "../referrals";

/**
 * The word-of-mouth loop has TWO destinations, and they must move together.
 *
 * `INVITE_URL` (the invite card on every Profile) points at the TestFlight
 * group. `INVITE_BASE_URL` (settings, Home, Wrapped, compatibility and
 * FirstVisitCelebration) points at the marketing site. At public release both
 * have to become the App Store listing, and the failure that costs the most is
 * not forgetting both — it is migrating ONE. That leaves half the share
 * surfaces sending people to a beta they cannot join or a waitlist for an app
 * that already shipped, and it looks like it works.
 *
 * These cases do not pin the current values; pinning a constant only means the
 * test has to be edited whenever the constant is, which teaches people to edit
 * tests. They assert the COUPLING, so the suite goes red exactly when the two
 * destinations disagree about which era the app is in.
 */
const APP_STORE = /^https:\/\/apps\.apple\.com\//;
const PRE_RELEASE = /^https:\/\/(testflight\.apple\.com|palate-zm29\.vercel\.app|palate\.app)\//;

describe("invite destinations", () => {
  it("are absolute https URLs", () => {
    for (const url of [INVITE_URL, INVITE_BASE_URL]) {
      expect(url).toMatch(/^https:\/\//);
    }
  });

  // The one that matters.
  it("agree about whether the app has shipped", () => {
    const live = [INVITE_URL, INVITE_BASE_URL].filter((u) => APP_STORE.test(u));
    const pre = [INVITE_URL, INVITE_BASE_URL].filter((u) => PRE_RELEASE.test(u));
    expect(live.length + pre.length).toBe(2); // both recognised
    expect(live.length === 2 || pre.length === 2).toBe(true);
  });

  // palate.app does not resolve yet; referrals.ts says so in its header. If
  // someone flips a link to it before the domain and its AASA file are live,
  // every shared link 404s.
  it("do not point at palate.app before the domain is attached", () => {
    for (const url of [INVITE_URL, INVITE_BASE_URL]) {
      expect(url).not.toMatch(/^https:\/\/palate\.app\//);
    }
  });

  it("carry no query string of their own, so ?ref= can be appended cleanly", () => {
    expect(INVITE_BASE_URL).not.toContain("?");
  });
});
