import {
  buildDigest, bandFor, entriesForDigest, isDigestWorthSending,
  digestNotificationBody, allowsRealtimePrompt,
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

  it("pre-checks High and nothing else", () => {
    const d = buildDigest([
      entry({ id: "sure", detectedAt: at(12), confidenceBand: "high" }),
      entry({ id: "maybe", detectedAt: at(13), confidenceBand: "medium" }),
      entry({ id: "doubt", detectedAt: at(14), confidenceBand: "low" }),
    ], DAY);
    expect(d.high[0].preChecked).toBe(true);
    expect(d.medium[0].preChecked).toBe(false);
    expect(d.low[0].preChecked).toBe(false);
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

  it("stays silent when only Low entries exist", () => {
    // Low is collapsed behind "Anything else?" — not worth spending the day's
    // single notification on.
    expect(isDigestWorthSending(buildDigest([
      entry({ id: "a", detectedAt: at(12), confidenceBand: "low" }),
    ], DAY))).toBe(false);
  });
});

describe("digestNotificationBody", () => {
  const fmt = (ms: number) => new Date(ms).getHours() + ":00";

  it("is declarative, not interrogative", () => {
    const body = digestNotificationBody(buildDigest([
      entry({ id: "Chipotle", detectedAt: at(12), confidenceBand: "high" }),
    ], DAY), fmt);
    expect(body).toContain("Chipotle");
    expect(body).not.toMatch(/did you|\?/i);
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

