import {
  buildDigest, bandFor, entriesForDigest, isDigestWorthSending,
  digestNotificationBody, digestNotificationTitle, isLowOnlyDigest, allowsRealtimePrompt,
} from "../passive-digest";
import type { InboxEntry } from "../passive-confirm";

const DAY = new Date("2026-08-31T21:00:00");

function entry(p: Partial<InboxEntry> & { id: string; detectedAt: number }): InboxEntry {
  return {
    place_id: `pid-${p.id}`, name: p.id, address: "", alternates: [], dwellMin: 30,
    ...p,
  } as InboxEntry;
}

function at(hour: number, min = 0): number {
  return new Date(2026, 7, 31, hour, min).getTime();
}

describe("bandFor", () => {
  it("uses the stored band when present", () => {
    expect(bandFor(entry({ id: "a", detectedAt: at(12), confidenceBand: "high" }))).toBe("high");
  });

  it("derives a band from a bare score", () => {
    expect(bandFor(entry({ id: "a", detectedAt: at(12), confidence: 0.9 }))).toBe("high");
    expect(bandFor(entry({ id: "b", detectedAt: at(12), confidence: 0.2 }))).toBe("low");
  });

  it("treats unscored history as Medium, never High", () => {
    // Entries written before scoring existed. Promoting them to High would
    // pre-check a guess nobody ever evaluated.
    expect(bandFor(entry({ id: "old", detectedAt: at(12) }))).toBe("medium");
  });
});

describe("buildDigest", () => {
  it("bands entries and orders chronologically WITHIN each band", () => {
    const d = buildDigest([
      entry({ id: "dinner", detectedAt: at(19), confidenceBand: "high" }),
      entry({ id: "coffee", detectedAt: at(9), confidenceBand: "medium" }),
      entry({ id: "lunch", detectedAt: at(12), confidenceBand: "high" }),
      entry({ id: "maybe", detectedAt: at(15), confidenceBand: "medium" }),
    ], DAY);

    // Band first — the whole point is that section 1 alone yields a good ledger.
    expect(d.high.map((e) => e.name)).toEqual(["lunch", "dinner"]);
    // Chronology preserved inside the band: it is the recall scaffold.
    expect(d.medium.map((e) => e.name)).toEqual(["coffee", "maybe"]);
  });

  it("pre-checks everything it presents as a likely visit", () => {
    // The notification counts high + medium — "2 places to confirm" — so
    // pre-checking only high meant tapping a notification about two places and
    // landing on a button that said "Confirm 1".
    const d = buildDigest([
      entry({ id: "sure", detectedAt: at(12), confidenceBand: "high" }),
      entry({ id: "maybe", detectedAt: at(13), confidenceBand: "medium" }),
      entry({ id: "doubt", detectedAt: at(14), confidenceBand: "low" }),
    ], DAY);
    expect(d.high[0].preChecked).toBe(true);
    expect(d.medium[0].preChecked).toBe(true);
    // Low is where ambiguous stops live, and an ambiguous entry needs you to
    // pick WHICH place first. Pre-ticking a guess is the one thing this screen
    // must never do.
    expect(d.low[0].preChecked).toBe(false);
  });

  it("agrees with the count the notification promised", () => {
    const d = buildDigest([
      entry({ id: "sure", detectedAt: at(12), confidenceBand: "high" }),
      entry({ id: "maybe", detectedAt: at(13), confidenceBand: "medium" }),
      entry({ id: "doubt", detectedAt: at(14), confidenceBand: "low" }),
    ], DAY);
    const promised = d.high.length + d.medium.length;
    const ticked = [...d.high, ...d.medium, ...d.low].filter((e) => e.preChecked).length;
    expect(ticked).toBe(promised);
  });

  it("flags multi-candidate entries as ambiguous, for a which-one picker", () => {
    const d = buildDigest([
      entry({ id: "clear", detectedAt: at(12), confidenceBand: "high", candidateCount: 1 }),
      entry({ id: "foodhall", detectedAt: at(13), confidenceBand: "low", candidateCount: 4 }),
    ], DAY);
    expect(d.high[0].ambiguous).toBe(false);
    expect(d.low[0].ambiguous).toBe(true);
  });

  it("excludes entries older than the current digest window", () => {
    // Was "other days". The window is now a full cycle rather than a calendar
    // day, so the excluded case has to be genuinely stale — two days back —
    // and yesterday evening is deliberately still included (that is the
    // late-dinner fix).
    const yesterday = new Date(2026, 7, 29, 12).getTime();
    const d = buildDigest([
      entry({ id: "today", detectedAt: at(12), confidenceBand: "high" }),
      entry({ id: "yesterday", detectedAt: yesterday, confidenceBand: "high" }),
    ], DAY);
    expect(d.total).toBe(1);
    expect(d.high.map((e) => e.name)).toEqual(["today"]);
  });
});

describe("isDigestWorthSending", () => {
  it("sends when there is anything to confirm", () => {
    expect(isDigestWorthSending(buildDigest([
      entry({ id: "a", detectedAt: at(12), confidenceBand: "medium" }),
    ], DAY))).toBe(true);
  });

  it("stays silent on an empty day", () => {
    expect(isDigestWorthSending(buildDigest([], DAY))).toBe(false);
  });

  it("speaks up on a low-only day, because silence is the worse failure", () => {
    // This assertion used to be `false`. A day made entirely of low-confidence
    // stops said nothing at all, which is exactly what the founder reported:
    // "I am not getting sent notifications to log food." Low band is where the
    // ambiguous stops are, so it asks a softer question rather than none.
    const d = buildDigest([entry({ id: "a", detectedAt: at(12), confidenceBand: "low" })], DAY);
    expect(isDigestWorthSending(d)).toBe(true);
    expect(isLowOnlyDigest(d)).toBe(true);
    expect(digestNotificationTitle(d)).toBe("Were you out today?");
  });
});

describe("digestNotificationBody", () => {
  const fmt = (ms: number) => new Date(ms).getHours() + ":00";

  it("names the place and asks, rather than announcing a task", () => {
    // The founder read "2 places to confirm" as a chore. It is a question now.
    // The name still has to appear somewhere — it is the recall scaffold —
    // but for a single place it belongs in the title, where iOS shows it bold.
    const d = buildDigest([entry({ id: "Chipotle", detectedAt: at(12), confidenceBand: "high" })], DAY);
    const title = digestNotificationTitle(d);
    const body = digestNotificationBody(d, fmt);
    expect(title).toBe("Did you eat at Chipotle?");
    expect(`${title} ${body}`).toContain("Chipotle");
    expect(body).toMatch(/no need to open the app/i);
  });

  it("asks about several places in the founder's own words", () => {
    const d = buildDigest([
      entry({ id: "Chipotle", detectedAt: at(12), confidenceBand: "high" }),
      entry({ id: "Ruby's", detectedAt: at(19), confidenceBand: "medium" }),
    ], DAY);
    expect(digestNotificationTitle(d)).toBe("Looks like you ate at 2 places today");
    expect(digestNotificationBody(d, fmt)).toMatch(/can you confirm/i);
  });

  it("summarises rather than listing everything", () => {
    const body = digestNotificationBody(buildDigest([
      entry({ id: "A", detectedAt: at(9), confidenceBand: "high" }),
      entry({ id: "B", detectedAt: at(12), confidenceBand: "high" }),
      entry({ id: "C", detectedAt: at(15), confidenceBand: "high" }),
      entry({ id: "D", detectedAt: at(19), confidenceBand: "high" }),
    ], DAY), fmt);
    expect(body).toContain("2 more");
  });
});

describe("allowsRealtimePrompt", () => {
  it("permits only High-band entries", () => {
    expect(allowsRealtimePrompt(entry({ id: "a", detectedAt: at(12), confidence: 0.9 }))).toBe(true);
    expect(allowsRealtimePrompt(entry({ id: "b", detectedAt: at(12), confidence: 0.6 }))).toBe(false);
  });

  it("refuses an unscored entry rather than assuming the best", () => {
    expect(allowsRealtimePrompt(entry({ id: "c", detectedAt: at(12) }))).toBe(false);
  });
});


// ============================================================================
// The count and the screen must agree.
// ----------------------------------------------------------------------------
// getInbox keeps 48 hours; the digest window spans about 26. An entry in
// between was counted by Home and by the Visits banner and shown by neither
// the digest nor anything else, so it asked forever and could not be answered.
// ============================================================================
describe("the digest screen shows everything the inbox counts", () => {
  const thirtyHoursAgo = DAY.getTime() - 30 * 3_600_000;

  it("windows for the notification", () => {
    const d = buildDigest([entry({ id: "old", detectedAt: thirtyHoursAgo, confidenceBand: "high" })], DAY);
    expect(d.total).toBe(0);
  });

  it("but shows the same entry on the screen, where it can be answered", () => {
    const d = buildDigest(
      [entry({ id: "old", detectedAt: thirtyHoursAgo, confidenceBand: "high" })],
      DAY,
      { windowed: false },
    );
    expect(d.total).toBe(1);
    expect(d.high).toHaveLength(1);
  });
});

// ============================================================================
// The notification must never promise more than the screen can show.
// ----------------------------------------------------------------------------
// The notification's copy is baked when it is scheduled; the screen is built
// when you open it, and the digest window moves in between. So the two can
// disagree, and the direction of the disagreement is what matters. A
// notification saying "3 places" that opens onto one answerable row is the
// founder's "it's asking for the same info" — you cannot clear what you cannot
// see. The reverse is harmless: the screen showing more than the notification
// mentioned is just more you can do.
//
// The screen is unwindowed and the notification is a windowed subset of the
// same inbox, so this holds by construction. The test is here to keep it that
// way.
// ============================================================================
describe("notification vs screen", () => {
  it("the screen always offers at least as much as the notification claimed", () => {
    const entries = [
      entry({ id: "old", detectedAt: DAY.getTime() - 30 * 3_600_000, confidenceBand: "high" }),
      entry({ id: "lunch", detectedAt: DAY.getTime() - 8 * 3_600_000, confidenceBand: "high" }),
      entry({ id: "dinner", detectedAt: DAY.getTime() - 1 * 3_600_000, confidenceBand: "medium" }),
    ];
    const notified = buildDigest(entries, DAY);
    const onScreen = buildDigest(entries, DAY, { windowed: false });
    const promised = notified.high.length + notified.medium.length;
    const answerable = onScreen.high.length + onScreen.medium.length + onScreen.low.length;
    expect(answerable).toBeGreaterThanOrEqual(promised);
    expect(onScreen.total).toBe(3);
  });
});
