// ============================================================================
// next-step.ts — the ONE thing to do next, and nothing else.
// ----------------------------------------------------------------------------
// The activation funnel, measured on 2026-09-02:
//
//   signed in 10 -> started onboarding 6 -> finished 4 -> granted location 3
//   -> ever detected 1
//
// Two of thirteen accounts have ever logged a visit. The drop is not at the
// end, it is at onboarding -> location, and everything downstream of it is
// empty shelves: a recommendation rail with nothing to recommend from, a
// Wrapped with nothing to wrap, a People directory of strangers with no data.
//
// The old empty state offered three CTAs of equal weight. Three equal choices
// is a menu, and a menu asks the user to diagnose their own account. This
// picks one, in the order that actually unblocks things:
//
//   1. REVIEW A CONNECTED MAILBOX, because that is the most wasteful state the
//      app can be in — the hard permission ask already granted, nothing come
//      of it. Finishing started work beats starting new work.
//   2. LOCATION, because passive capture is the entire product thesis and
//      nothing downstream works without it.
//   3. CONNECT EMAIL, the only thing that fills a cold account with real
//      history rather than asking someone to type it.
//   4. LOG ONE by hand — the Beli move, and deliberately last. Making people
//      hand-enter their history is the labour our whole approach exists to
//      avoid, so we ask for it only when the automatic routes are exhausted.
//   5. FIND A FRIEND, once there is something on the account worth showing.
//
// Pure and exhaustively tested, because this is the screen most likely to be
// somebody's entire impression of the app.
// ============================================================================

export type ActivationState = {
  /** "Always" location — what passive capture actually needs. */
  locationAlways: boolean;
  /** "When in use" — granted, but not enough for background detection. */
  locationWhenInUse: boolean;
  gmailConnected: boolean;
  /**
   * How many visits this account has ever committed from email. Read from
   * `gmail_connection_status`, which is free — deliberately NOT a live receipt
   * count, because knowing that would mean scanning someone's mailbox on every
   * render of the home screen.
   */
  gmailImported: number;
  visitCount: number;
  friendCount: number;
};

export type NextStep = {
  key: "location" | "import_review" | "gmail" | "log_one" | "friends" | "none";
  title: string;
  /** Why this, said in terms of what the person gets — never in feature names. */
  body: string;
  cta: string;
  route: string;
};

export function nextStep(s: ActivationState): NextStep | null {
  // Half-finished work first. Connecting Gmail and then never reviewing what
  // it found is the most wasteful state the app can be in: the permission is
  // granted, the hard ask is already made, and nothing came of it.
  if (s.gmailConnected && s.gmailImported === 0) {
    return {
      key: "import_review",
      title: "Your email is connected — see what's in it",
      body: "Reservation and delivery confirmations become visits. Nothing is saved until you've looked at the list.",
      cta: "Review what we found",
      route: "/import-review",
    };
  }

  // The thesis. Without background location Palate is a worse Beli — a place
  // to type in restaurants by hand.
  if (!s.locationAlways) {
    return {
      key: "location",
      title: s.locationWhenInUse
        ? "Let Palate notice where you eat"
        : "Turn on location",
      body: s.locationWhenInUse
        ? "You've allowed location while the app is open. Background access is what lets it catch a meal without you opening anything."
        : "Palate works by noticing the restaurants you already go to, then asking. Nothing is logged until you say yes.",
      cta: "Set it up",
      route: "/passive-capture-intro",
    };
  }

  // Cold start. The account works but has nothing in it yet.
  if (s.visitCount === 0 && !s.gmailConnected) {
    return {
      key: "gmail",
      title: "Start from what you've already eaten",
      body: "Reservation and delivery confirmations in your email become visits. You'll see everything we find before anything is saved.",
      cta: "Scan my email",
      route: "/import-email",
    };
  }

  // Last resort, and only when the automatic routes have produced nothing.
  if (s.visitCount === 0) {
    return {
      key: "log_one",
      title: "Log one meal",
      body: "One is enough to start. After that Palate mostly does this on its own.",
      cta: "Add a visit",
      route: "/(tabs)/add",
    };
  }

  // Only worth asking once the profile has something on it. Inviting people to
  // an empty account is how a social feature dies on its first impression.
  if (s.friendCount === 0 && s.visitCount >= 3) {
    return {
      key: "friends",
      title: "Add someone who eats like you",
      body: "The feed and the group picks both need one other person before they do anything.",
      cta: "Find friends",
      route: "/friends",
    };
  }

  // Nothing to teach. The app should get out of the way.
  return null;
}

/**
 * What Wrapped will be, said concretely, for an account that cannot generate
 * one yet. Vague encouragement ("keep logging!") is what an empty screen says
 * when it has nothing to promise.
 */
export function wrappedPromise(visitCount: number, needed: number): string {
  const short = Math.max(0, needed - visitCount);
  if (short === 0) return "";
  if (visitCount === 0) {
    return `Wrapped reads your week back to you — what you actually ate, which cuisine you drifted toward, the one place you kept returning to. It needs ${needed} visits.`;
  }
  return `${short} more visit${short === 1 ? "" : "s"} and Wrapped will tell you what your week actually said — the cuisine you drifted toward, the place you kept going back to.`;
}
