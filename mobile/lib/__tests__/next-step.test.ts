import { nextStep, wrappedPromise, type ActivationState } from "../next-step";

const base: ActivationState = {
  locationAlways: true,
  locationWhenInUse: true,
  gmailConnected: false,
  gmailImported: 4,
  visitCount: 10,
  friendCount: 3,
};

const s = (over: Partial<ActivationState> = {}): ActivationState => ({ ...base, ...over });

// This is the screen most likely to be somebody's entire impression of the app,
// and the funnel says the drop is at onboarding -> location. The ordering below
// is the actual product claim; these tests are what pin it.

describe("nextStep", () => {
  it("says nothing to a healthy account", () => {
    expect(nextStep(s())).toBeNull();
  });

  it("finishes half-done work before starting new work", () => {
    // Connected but never reviewed is the most wasteful state possible: the
    // hard permission ask is already granted and nothing came of it.
    const step = nextStep(s({
      gmailConnected: true, gmailImported: 0, locationAlways: false, visitCount: 0,
    }));
    expect(step?.key).toBe("import_review");
  });

  it("stops nagging about the mailbox once something came from it", () => {
    expect(nextStep(s({ gmailConnected: true, gmailImported: 1 }))?.key)
      .not.toBe("import_review");
  });

  it("puts background location ahead of everything but that", () => {
    expect(nextStep(s({ locationAlways: false, visitCount: 0 }))?.key).toBe("location");
  });

  it("distinguishes 'never granted' from 'granted, but only in-app'", () => {
    // These are different problems and the second one is invisible to the
    // user — they believe they already said yes.
    const never = nextStep(s({ locationAlways: false, locationWhenInUse: false }));
    const partial = nextStep(s({ locationAlways: false, locationWhenInUse: true }));
    expect(never?.title).toBe("Turn on location");
    expect(partial?.title).toBe("Let Palate notice where you eat");
    expect(partial?.body).toMatch(/[Bb]ackground/);
  });

  it("offers email import to a cold account before asking it to type", () => {
    const step = nextStep(s({ visitCount: 0, gmailConnected: false }));
    expect(step?.key).toBe("gmail");
  });

  it("asks for a manual log only once the automatic routes are exhausted", () => {
    // Hand-entering history is the Beli labour our whole approach exists to
    // avoid. It is the fallback, never the opener.
    expect(nextStep(s({ visitCount: 0, gmailConnected: true, gmailImported: 2 }))?.key).toBe("log_one");
  });

  it("does not invite friends to an empty account", () => {
    // Inviting people to look at nothing is how a social feature dies on its
    // first impression.
    expect(nextStep(s({ friendCount: 0, visitCount: 1 }))?.key).not.toBe("friends");
    expect(nextStep(s({ friendCount: 0, visitCount: 3 }))?.key).toBe("friends");
  });

  it("always offers exactly one step, never a menu", () => {
    const states: ActivationState[] = [
      s({ locationAlways: false, visitCount: 0, gmailConnected: false, friendCount: 0 }),
      s({ gmailConnected: true, gmailImported: 0, visitCount: 0, friendCount: 0, locationAlways: false }),
      s({ visitCount: 0, gmailConnected: true, gmailImported: 2, friendCount: 0 }),
      s({ friendCount: 0 }),
      s(),
    ];
    for (const st of states) {
      const step = nextStep(st);
      if (step) {
        expect(typeof step.cta).toBe("string");
        expect(step.cta.length).toBeGreaterThan(0);
        expect(step.route.startsWith("/")).toBe(true);
      }
    }
  });
});

describe("wrappedPromise", () => {
  it("describes what Wrapped will be, not that it is empty", () => {
    const copy = wrappedPromise(0, 3);
    expect(copy).toMatch(/3 visits/);
    // Concrete nouns, not encouragement.
    expect(copy).toMatch(/cuisine/);
    expect(copy).not.toMatch(/keep logging/i);
  });

  it("counts down honestly once there is some history", () => {
    expect(wrappedPromise(2, 3)).toMatch(/^1 more visit and/);
    expect(wrappedPromise(1, 3)).toMatch(/^2 more visits and/);
  });

  it("says nothing at all once Wrapped is unlocked", () => {
    expect(wrappedPromise(3, 3)).toBe("");
    expect(wrappedPromise(9, 3)).toBe("");
  });
});
