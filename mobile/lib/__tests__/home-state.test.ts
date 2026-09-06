jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
}));

import { homeState, whenLabel, type HomeInputs } from "../home-state";
import { buildEatingPattern } from "../eating-pattern";

const healthy = {
  locationAlways: true, locationWhenInUse: true, notificationsGranted: true,
  gmailConnected: false, gmailImported: 0,
  visitCount: 30, friendCount: 2,
};

function inputs(over: Partial<HomeInputs> = {}): HomeInputs {
  return { pending: [], activation: healthy, trackingOn: true, ...over };
}

// 2026-09-03 is a Thursday, so the digest fires at 9pm (11pm on Saturdays).
const at = (h: number, m = 0) => new Date(2026, 8, 3, h, m);

describe("homeState priority", () => {
  it("puts pending confirmations above everything", () => {
    // The only thing on this screen the user can finish. It outranks even a
    // cold account: confirming is what makes the rest of the app work.
    const s = homeState(inputs({
      pending: [{ name: "K'Far Cafe" }, { name: "Sampan" }],
      activation: { ...healthy, visitCount: 0, locationAlways: false },
    }), at(21));
    expect(s.kind).toBe("review");
    if (s.kind === "review") {
      expect(s.headline).toContain("2 visits");
      expect(s.body).toBe("K'Far Cafe and Sampan.");
      expect(s.route).toBe("/digest");
    }
  });

  it("says one visit in the singular, and offers to review it", () => {
    const s = homeState(inputs({ pending: [{ name: "ANINA" }] }), at(21));
    expect(s.kind).toBe("review");
    if (s.kind === "review") {
      expect(s.headline).toContain("One visit");
      expect(s.cta).toBe("Review it");
      expect(s.body).toBe("ANINA.");
    }
  });

  it("names two and counts the rest, the way a person would", () => {
    const s = homeState(inputs({
      pending: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
    }), at(21));
    if (s.kind === "review") expect(s.body).toBe("A, B and 2 more.");
  });

  it("falls through to activation for a cold account", () => {
    const s = homeState(inputs({
      activation: { ...healthy, visitCount: 0, locationAlways: false, locationWhenInUse: false },
    }), at(12));
    expect(s.kind).toBe("activation");
  });

  it("reassures before the digest fires, and asks for nothing", () => {
    const s = homeState(inputs(), at(14));
    expect(s.kind).toBe("waiting");
    if (s.kind === "waiting") expect(s.body).toContain("9pm");
    // No CTA on this state — a screen with no task must not invent one.
    expect("cta" in s).toBe(false);
  });

  it("switches out of waiting the minute the digest is due", () => {
    expect(homeState(inputs(), at(20, 59)).kind).toBe("waiting");
    expect(homeState(inputs(), at(21, 0)).kind).toBe("steady");
  });

  it("tells someone with tracking off what would fix it", () => {
    const s = homeState(inputs({ trackingOn: false }), at(23));
    expect(s.kind).toBe("steady");
    expect(s.body).toContain("Turn tracking on");
  });

  it("never mentions the machinery", () => {
    const states = [
      homeState(inputs({ pending: [{ name: "X" }] }), at(21)),
      homeState(inputs(), at(14)),
      homeState(inputs(), at(23)),
      homeState(inputs({ trackingOn: false }), at(9)),
    ];
    for (const s of states) {
      const text = `${s.headline} ${s.body}`.toLowerCase();
      for (const banned of ["ai", "algorithm", "detect", "confidence", "model", "palate noticed"]) {
        expect(text).not.toContain(banned);
      }
    }
  });
});

// The hour Home quotes has to be the hour the digest actually fires for this
// person. An early eater is asked at eight, so "ready at 9pm" would be a lie.
describe("personal digest hour on Home", () => {
  const hourly: number[] = new Array(24).fill(0);
  hourly[18] = 30;
  const earlyEater = buildEatingPattern(hourly, new Array(7).fill(0));

  it("quotes this person's hour, not the default", () => {
    const s = homeState(inputs({ pattern: earlyEater }), at(14));
    expect(s.kind).toBe("waiting");
    if (s.kind === "waiting") expect(s.body).toContain("8pm");
  });

  it("switches out of waiting at that hour", () => {
    expect(homeState(inputs({ pattern: earlyEater }), at(19, 59)).kind).toBe("waiting");
    expect(homeState(inputs({ pattern: earlyEater }), at(20, 0)).kind).toBe("steady");
  });

  it("keeps the default when no pattern is stored", () => {
    const s = homeState(inputs({ pattern: null }), at(14));
    if (s.kind === "waiting") expect(s.body).toContain("9pm");
    expect(homeState(inputs({ pattern: null }), at(20, 30)).kind).toBe("waiting");
  });
});

describe("whenLabel", () => {
  it("names the part of the day a person would name", () => {
    expect(whenLabel(at(9))).toBe("Thursday morning");
    expect(whenLabel(at(13))).toBe("Thursday afternoon");
    expect(whenLabel(at(19))).toBe("Thursday evening");
    expect(whenLabel(at(23, 57))).toBe("Thursday, late");
  });
});

// ============================================================================
// Detection with no way to deliver it.
// ----------------------------------------------------------------------------
// Location granted, meals being noticed and filed, notifications off. Nothing
// ever asks, so the person sees an app that appears to do nothing and
// concludes passive capture is broken. Home must say so rather than sitting
// on "steady".
// ============================================================================
describe("notifications off", () => {
  it("outranks the steady state, because the app is asking nobody", () => {
    const s = homeState(
      inputs({ activation: { ...healthy, notificationsGranted: false } }),
      at(14),
    );
    expect(s.kind).toBe("activation");
    if (s.kind === "activation") {
      expect(s.step.key).toBe("notifications");
    }
  });

  it("still lets a pending confirmation come first", () => {
    // If there is something to confirm, the notification never mattered:
    // they are already here and can just do it.
    const s = homeState(inputs({
      pending: [{ name: "K'Far Cafe" }],
      activation: { ...healthy, notificationsGranted: false },
    }), at(21));
    expect(s.kind).toBe("review");
  });
});
