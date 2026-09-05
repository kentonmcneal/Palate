import { ownedBy, serialize } from "../notification-dedupe";

// Six "Saturday brunch, sorted" on one lock screen, 2026-09-05. The fix is
// to cancel by kind from what iOS actually has pending, and to stop two
// refreshes from interleaving.
describe("ownedBy", () => {
  const pending = [
    { identifier: "a", content: { data: { type: "discovery_ping", key: "brunch" } } },
    { identifier: "b", content: { data: { type: "discovery_ping", key: "brunch" } } },
    { identifier: "c", content: { data: { type: "streak_reminder" } } },
    { identifier: "d", content: { data: { kind: "passive_digest" } } },
    { identifier: "e", content: { data: null } },
  ];

  it("finds every orphan of a kind, however many there are", () => {
    expect(ownedBy(pending, "type", "discovery_ping")).toEqual(["a", "b"]);
  });

  it("leaves the other kinds alone", () => {
    expect(ownedBy(pending, "type", "streak_reminder")).toEqual(["c"]);
    expect(ownedBy(pending, "kind", "passive_digest")).toEqual(["d"]);
  });

  it("tolerates notifications with no data", () => {
    expect(ownedBy(pending, "type", "nope")).toEqual([]);
  });
});

describe("serialize", () => {
  it("runs overlapping calls one after another, not interleaved", async () => {
    const order: string[] = [];
    let n = 0;
    const run = serialize(async () => {
      const me = ++n;
      order.push(`start${me}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end${me}`);
      return me;
    });
    const [a, b, c] = await Promise.all([run(), run(), run()]);
    expect([a, b, c]).toEqual([1, 2, 3]);
    expect(order).toEqual(["start1", "end1", "start2", "end2", "start3", "end3"]);
  });

  it("keeps going after a failure", async () => {
    let calls = 0;
    const run = serialize(async () => {
      calls++;
      if (calls === 1) throw new Error("first");
      return calls;
    });
    await expect(run()).rejects.toThrow("first");
    await expect(run()).resolves.toBe(2);
  });
});
