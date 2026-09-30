import {
  mergeCatchUp, newestServerTimestamp, isPending, PENDING_PREFIX,
  type DmMessage,
} from "../messages";

const ME = "me-1";
const THEM = "them-1";

function msg(id: string, sender: string, body: string, at: string): DmMessage {
  return { id, thread_id: "t1", sender_id: sender, body, created_at: at };
}
const pending = (body: string, at: string) => msg(`${PENDING_PREFIX}9`, ME, body, at);

/**
 * The defect this closes.
 *
 * A postgres_changes subscription only delivers what happens while it is
 * connected. Anything inserted between a drop and a reconnect is never pushed,
 * and nothing refetched — so a brief loss of signal silently ATE messages until
 * the screen was left and re-entered, and the socket returning looked exactly
 * like never having lost it.
 */
describe("catching up after a dropped subscription", () => {
  it("recovers messages sent during the gap", () => {
    const before = [msg("s1", THEM, "you there?", "2026-09-30T07:00:00Z")];
    const gap = [
      msg("s2", THEM, "hello?", "2026-09-30T07:01:00Z"),
      msg("s3", THEM, "still there?", "2026-09-30T07:02:00Z"),
    ];
    const after = mergeCatchUp(before, gap, ME);
    expect(after.map((m) => m.id)).toEqual(["s1", "s2", "s3"]);
  });

  // A flapping connection resubscribes repeatedly; the same batch can arrive
  // more than once and must not multiply.
  it("is idempotent when the same batch replays", () => {
    const before = [msg("s1", THEM, "hi", "2026-09-30T07:00:00Z")];
    const gap = [msg("s2", THEM, "again", "2026-09-30T07:01:00Z")];
    const once = mergeCatchUp(before, gap, ME);
    const twice = mergeCatchUp(once, gap, ME);
    const thrice = mergeCatchUp(twice, gap, ME);
    expect(thrice.map((m) => m.id)).toEqual(["s1", "s2"]);
  });

  it("does not drop an unacknowledged send while filling the gap", () => {
    const list = [msg("s1", THEM, "hi", "2026-09-30T07:00:00Z"), pending("typed offline", "2026-09-30T07:05:00Z")];
    const after = mergeCatchUp(list, [msg("s2", THEM, "gap", "2026-09-30T07:01:00Z")], ME);
    expect(after.some(isPending)).toBe(true);
    expect(after).toHaveLength(3);
  });

  // My own message coming back in the catch-up is the same race as the realtime
  // echo, so it consumes the pending row rather than duplicating it.
  it("reconciles my own message when it returns in the batch", () => {
    const list = [pending("sent during the drop", "2026-09-30T07:05:00Z")];
    const after = mergeCatchUp(list, [msg("real-1", ME, "sent during the drop", "2026-09-30T07:05:01Z")], ME);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe("real-1");
  });

  it("handles a gap batch that is empty, and a list that is null", () => {
    expect(mergeCatchUp([msg("s1", THEM, "hi", "2026-09-30T07:00:00Z")], [], ME)).toHaveLength(1);
    expect(mergeCatchUp(null, [msg("s1", THEM, "hi", "2026-09-30T07:00:00Z")], ME)).toHaveLength(1);
  });
});

/**
 * The boundary has to come from the server's clock, not ours.
 */
describe("choosing the catch-up boundary", () => {
  it("takes the newest server timestamp", () => {
    const list = [
      msg("s1", THEM, "a", "2026-09-30T07:00:00Z"),
      msg("s2", THEM, "b", "2026-09-30T07:02:00Z"),
      msg("s3", THEM, "c", "2026-09-30T07:01:00Z"),
    ];
    expect(newestServerTimestamp(list)).toBe("2026-09-30T07:02:00Z");
  });

  // The load-bearing case. A pending row's created_at is the LOCAL clock, which
  // can run ahead of the database. Using it as the boundary would skip real
  // messages and reopen the hole this whole change closes.
  it("ignores a pending row whose local clock runs ahead", () => {
    const list = [
      msg("s1", THEM, "real", "2026-09-30T07:00:00Z"),
      pending("mine, local clock fast", "2026-09-30T09:99:00Z"),
    ];
    expect(newestServerTimestamp(list)).toBe("2026-09-30T07:00:00Z");
  });

  // Null means "no server-confirmed anchor", and the caller must refetch the
  // window rather than invent a boundary.
  it("returns null when nothing is server-confirmed", () => {
    expect(newestServerTimestamp(null)).toBeNull();
    expect(newestServerTimestamp([])).toBeNull();
    expect(newestServerTimestamp([pending("only mine", "2026-09-30T07:00:00Z")])).toBeNull();
  });
});
