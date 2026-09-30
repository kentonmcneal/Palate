const mockRpc = jest.fn();
const mockCapture = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock("../observability", () => ({ captureError: (...a: unknown[]) => mockCapture(...a) }));

import { markRead } from "../messages";

const noSleep = async () => {};

beforeEach(() => { mockRpc.mockReset(); mockCapture.mockReset(); });

/**
 * The per-thread unread badge in app/messages.tsx is rendered from
 * dm_threads_list, i.e. from the SERVER's state. So a failed dm_mark_read
 * leaves a conversation you have just read showing unread.
 *
 * markRead used to be `.then(() => {}, () => {})` — a no-op on both branches.
 * supabase.rpc() RESOLVES with { error } rather than rejecting, so the rejection
 * handler caught only network faults while the success handler discarded the
 * error field. A refused dm_mark_read was indistinguishable from one that
 * worked, and nothing ever retried.
 */
describe("a read receipt reports whether it landed", () => {
  it("returns true when the server accepts it", async () => {
    mockRpc.mockResolvedValue({ error: null });
    await expect(markRead("t1", { sleep: noSleep })).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  // The case the old code could not see at all: a RESOLVED rejection.
  it("returns false when the RPC resolves with an error", async () => {
    mockRpc.mockResolvedValue({ error: { message: "permission denied" } });
    await expect(markRead("t1", { tries: 2, sleep: noSleep })).resolves.toBe(false);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it("returns false when the RPC throws", async () => {
    mockRpc.mockRejectedValue(new Error("network down"));
    await expect(markRead("t1", { tries: 2, sleep: noSleep })).resolves.toBe(false);
  });

  it("reports the final failure instead of swallowing it", async () => {
    mockRpc.mockResolvedValue({ error: { message: "nope" } });
    await markRead("t7", { tries: 2, sleep: noSleep });
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][1]).toMatchObject({ at: "messages:markRead", thread_id: "t7" });
  });
});

describe("a transient failure is retried, which is the whole point", () => {
  it("succeeds on a later attempt without reporting", async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: "timeout" } })
       .mockResolvedValueOnce({ error: null });
    await expect(markRead("t1", { sleep: noSleep })).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("recovers from a thrown fault followed by success", async () => {
    mockRpc.mockRejectedValueOnce(new Error("socket"))
       .mockResolvedValueOnce({ error: null });
    await expect(markRead("t1", { sleep: noSleep })).resolves.toBe(true);
  });

  it("stops at the configured number of attempts", async () => {
    mockRpc.mockResolvedValue({ error: { message: "still no" } });
    await markRead("t1", { tries: 4, sleep: noSleep });
    expect(mockRpc).toHaveBeenCalledTimes(4);
  });

  it("does not sleep after the last attempt", async () => {
    const waits: number[] = [];
    mockRpc.mockResolvedValue({ error: { message: "no" } });
    await markRead("t1", { tries: 3, baseDelayMs: 100, sleep: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([100, 200]);
  });

  it("passes the thread id through to the RPC", async () => {
    mockRpc.mockResolvedValue({ error: null });
    await markRead("thread-42", { sleep: noSleep });
    expect(mockRpc).toHaveBeenCalledWith("dm_mark_read", { p_thread: "thread-42" });
  });
});
