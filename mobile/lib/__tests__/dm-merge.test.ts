import {
  applyIncoming, reconcileSent, dropOptimistic, isPending, PENDING_PREFIX,
  type DmMessage,
} from "../messages";

const ME = "me-1";
const THEM = "them-1";

function msg(id: string, sender: string, body: string): DmMessage {
  return { id, thread_id: "t1", sender_id: sender, body, created_at: "2026-09-30T07:00:00Z" };
}
const pending = (body: string) => msg(`${PENDING_PREFIX}123`, ME, body);

/**
 * The race this file exists for.
 *
 * Sending is optimistic. The realtime echo and the dm_send response are two
 * independent round trips and either can win. The old inline dedupe only
 * recognised the echo by SERVER id, so when the echo arrived first the message
 * was appended and then the optimistic row was renamed to the same id —
 * two rows, one message. Worst on a slow connection, which is the case
 * optimism is for.
 */
describe("the echo can arrive before the send resolves", () => {
  it("does not duplicate when the echo wins the race", () => {
    let list: DmMessage[] | null = [msg("s1", THEM, "hi")];
    const opt = pending("hello");
    list = [...list, opt];                                  // optimistic append
    list = applyIncoming(list, msg("real-1", ME, "hello"), ME);  // echo arrives FIRST
    list = reconcileSent(list, opt.id, "real-1");               // then dm_send answers

    expect(list.filter((m) => m.body === "hello")).toHaveLength(1);
    expect(list.map((m) => m.id)).toEqual(["s1", "real-1"]);
    expect(list.some(isPending)).toBe(false);
  });

  it("does not duplicate when the response wins the race", () => {
    let list: DmMessage[] | null = [];
    const opt = pending("hello");
    list = [opt];
    list = reconcileSent(list, opt.id, "real-1");               // dm_send answers FIRST
    list = applyIncoming(list, msg("real-1", ME, "hello"), ME); // echo arrives after

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("real-1");
  });

  // The echo replaces the pending row in place, so an acknowledged message does
  // not jump to the bottom of the conversation.
  it("keeps the message in position when the echo replaces it", () => {
    const opt = pending("mine");
    let list: DmMessage[] | null = [opt, msg("s2", THEM, "theirs")];
    list = applyIncoming(list, msg("real-1", ME, "mine"), ME);
    expect(list.map((m) => m.body)).toEqual(["mine", "theirs"]);
  });
});

describe("it still delivers everything it should", () => {
  it("appends a message from the other person", () => {
    const list = applyIncoming([msg("s1", ME, "hi")], msg("s2", THEM, "hello"), ME);
    expect(list.map((m) => m.id)).toEqual(["s1", "s2"]);
  });

  it("initialises an empty thread", () => {
    expect(applyIncoming(null, msg("s1", THEM, "hi"), ME)).toHaveLength(1);
  });

  it("ignores a repeated delivery of the same server id", () => {
    const m = msg("s1", THEM, "hi");
    expect(applyIncoming([m], m, ME)).toHaveLength(1);
  });

  // Two identical messages I genuinely sent twice must both survive once
  // acknowledged — only a PENDING row may be consumed by an echo.
  it("does not swallow a real duplicate the user sent on purpose", () => {
    let list: DmMessage[] | null = [msg("real-1", ME, "ok")];
    list = applyIncoming(list, msg("real-2", ME, "ok"), ME);
    expect(list.map((m) => m.id)).toEqual(["real-1", "real-2"]);
  });

  // Same body from the other person must never consume my pending row.
  it("does not let their message consume my pending send", () => {
    const opt = pending("same words");
    const list = applyIncoming([opt], msg("real-1", THEM, "same words"), ME);
    expect(list).toHaveLength(2);
    expect(list.some(isPending)).toBe(true);
  });

  // me === null happens: getUser() is async and a fast sender beats it.
  it("cannot match a pending row when the viewer is unknown", () => {
    const opt = pending("hello");
    const list = applyIncoming([opt], msg("real-1", ME, "hello"), null);
    expect(list).toHaveLength(2);
  });
});

describe("a failed send loses nothing but itself", () => {
  it("drops only the optimistic row", () => {
    const opt = pending("oops");
    const list = dropOptimistic([msg("s1", THEM, "hi"), opt], opt.id);
    expect(list.map((m) => m.id)).toEqual(["s1"]);
  });

  it("tolerates a null list", () => {
    expect(dropOptimistic(null, "pending-1")).toEqual([]);
  });
});
