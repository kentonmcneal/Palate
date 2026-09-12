import { buildDigest, MAX_DIGEST_ASKS } from "../passive-digest";
import type { InboxEntry } from "../passive-confirm";

// ============================================================================
// A digest nobody can answer is a digest nobody answers.
// ----------------------------------------------------------------------------
// There was no limit on how many stops one digest asked about. On an ordinary
// day that is fine — there are two or three. On the founder's travel day his
// phone produced 141 detections and the digest listed every resolved one.
//
// "On my way to the airport I got hit with like 10 restaurants" was not ten
// notifications. Real-time prompts are off entirely
// (REALTIME_PROMPTS_ENABLED = false). It was one notification opening onto a
// list too long to work through.
// ============================================================================

let n = 0;
const entry = (band: "high" | "medium" | "low", minsAgo: number): InboxEntry => ({
  id: `e${n++}`,
  place_id: `p${n}`,
  name: `Place ${n}`,
  address: "",
  alternates: [],
  detectedAt: Date.now() - minsAgo * 60_000,
  dwellMin: 20,
  confidenceBand: band,
  confidence: band === "high" ? 0.9 : band === "medium" ? 0.6 : 0.2,
});

const build = (entries: InboxEntry[]) => buildDigest(entries, new Date(), { windowed: false });

describe("the digest asks a number of questions a person will answer", () => {
  it("asks about everything on an ordinary day", () => {
    const d = build([entry("high", 200), entry("medium", 100), entry("low", 50)]);
    expect(d.total).toBe(3);
    expect(d.heldBack ?? 0).toBe(0);
  });

  it("caps a travel day rather than listing forty stops", () => {
    const many = Array.from({ length: 40 }, (_, i) => entry("medium", i * 10));
    const d = build(many);
    expect(d.total).toBe(MAX_DIGEST_ASKS);
    expect(d.heldBack).toBe(40 - MAX_DIGEST_ASKS);
  });

  it("spends the budget on the answerable ones first", () => {
    // High before medium before low. A guess somebody can confirm at a glance
    // beats an ambiguous one they have to think about, and thinking is what
    // makes a list get abandoned.
    const mix = [
      ...Array.from({ length: 5 }, (_, i) => entry("low", i)),
      ...Array.from({ length: 5 }, (_, i) => entry("high", i)),
      ...Array.from({ length: 5 }, (_, i) => entry("medium", i)),
    ];
    const d = build(mix);
    expect(d.high).toHaveLength(5);
    expect(d.medium).toHaveLength(1);
    expect(d.low).toHaveLength(0);
    expect(d.total).toBe(MAX_DIGEST_ASKS);
  });

  it("counts total as what it ASKED, so callers do not think it is empty", () => {
    // Every caller uses `total` to decide whether there is anything to show.
    // Counting detections here would claim a digest of 40 while showing 6.
    const d = build(Array.from({ length: 20 }, (_, i) => entry("high", i)));
    expect(d.total).toBe(d.high.length + d.medium.length + d.low.length);
  });

  it("holds the rest back rather than dropping them", () => {
    // They stay in the inbox. The next digest can ask, by which time they are
    // usually stale enough not to matter — but nothing is silently lost.
    const d = build(Array.from({ length: 10 }, (_, i) => entry("medium", i)));
    expect((d.heldBack ?? 0) + d.total).toBe(10);
  });
});
