import { confirmDigest, type ConfirmableEntry, type ConfirmDeps } from "../digest-confirm";

function entry(id: string): ConfirmableEntry {
  return { id, name: `Place ${id}`, place_id: `pid-${id}`, detectedAt: Date.now(), band: "high" };
}

function deps(over: Partial<ConfirmDeps> = {}): ConfirmDeps & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    saveVisit: jest.fn().mockResolvedValue({ id: "v1" }),
    removeFromInbox: jest.fn(async (id: string) => { removed.push(id); }),
    recordPromptDecision: jest.fn().mockResolvedValue(undefined),
    track: jest.fn(),
    ...over,
  } as ConfirmDeps & { removed: string[] };
}

// The digest is the one moment the user actively hands us data. Dropping an
// entry there — which is what happened when removeFromInbox ran outside the try
// around saveVisit — means they answered the question and got nothing for it,
// with no visit written and nothing left to retry.
describe("confirmDigest", () => {
  it("keeps an entry in the inbox when its save fails", async () => {
    const d = deps({ saveVisit: jest.fn().mockRejectedValue(new Error("offline")) });
    const res = await confirmDigest([entry("a")], [], {}, d);

    expect(res.savedIds).toEqual([]);
    expect(res.failed).toEqual([{ id: "a", name: "Place a" }]);
    expect(d.removed).not.toContain("a");
  });

  it("removes an entry once its save succeeds", async () => {
    const d = deps();
    const res = await confirmDigest([entry("a")], [], {}, d);

    expect(res.savedIds).toEqual(["v1"]);
    expect(res.failed).toEqual([]);
    expect(d.removed).toContain("a");
  });

  it("saves the good ones when one in the middle fails", async () => {
    const saveVisit = jest.fn()
      .mockResolvedValueOnce({ id: "v1" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: "v3" });
    const d = deps({ saveVisit });

    const res = await confirmDigest([entry("a"), entry("b"), entry("c")], [], {}, d);

    expect(res.savedIds).toEqual(["v1", "v3"]);
    expect(res.failed.map((f) => f.id)).toEqual(["b"]);
    expect(d.removed).toEqual(["a", "c"]);
  });

  it("does not resurrect a saved entry when telemetry fails", async () => {
    // A failed analytics call must not leave the entry behind — the retry
    // would write the same visit a second time.
    const d = deps({
      recordPromptDecision: jest.fn().mockRejectedValue(new Error("nope")),
      track: jest.fn(() => { throw new Error("nope"); }),
    });
    const res = await confirmDigest([entry("a")], [], {}, d).catch((e) => e);

    expect(d.removed).toContain("a");
    expect((res as { savedIds: string[] }).savedIds).toEqual(["v1"]);
  });

  it("uses the corrected place when the user picked a different one", async () => {
    const saveVisit = jest.fn().mockResolvedValue({ id: "v1" });
    const d = deps({ saveVisit });
    await confirmDigest([entry("a")], [], { a: { google_place_id: "corrected" } }, d);

    expect(saveVisit).toHaveBeenCalledWith(expect.objectContaining({ googlePlaceId: "corrected" }));
    expect(d.recordPromptDecision).toHaveBeenCalledWith("corrected", "wrong_place");
  });

  it("clears skipped entries without writing anything", async () => {
    const d = deps();
    const res = await confirmDigest([], [entry("s")], {}, d);

    expect(d.saveVisit).not.toHaveBeenCalled();
    expect(d.removed).toContain("s");
    expect(res.failed).toEqual([]);
  });
});
