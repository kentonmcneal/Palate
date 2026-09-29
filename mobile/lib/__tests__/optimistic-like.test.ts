import { applyLike, restoreLike, createLikeGate } from "../optimistic-like";
const initial = [{ id: "a", iLiked: false, likeCount: 0, body: "first" }, { id: "b", iLiked: false, likeCount: 2, body: "second" }];
test("failure rollback keeps another successful like and newly added comments", () => {
  const bothLiked = applyLike(applyLike(initial, "a", true), "b", true);
  const withNew = [...bothLiked, { id: "c", iLiked: false, likeCount: 0, body: "new comment" }];
  const restored = restoreLike(withNew, initial[0]);
  expect(restored[0].iLiked).toBe(false);
  expect(restored[1]).toMatchObject({ iLiked: true, likeCount: 3 });
  expect(restored[2].body).toBe("new comment");
  expect(restoreLike(withNew.filter(row => row.id !== "a"), initial[0])).toHaveLength(2);
});
test("repeated likes are idempotent and stale unlike counts cannot become negative", () => {
  expect(applyLike(applyLike(initial, "a", true), "a", true)[0].likeCount).toBe(1);
  expect(applyLike([{ id: "a", iLiked: true, likeCount: 0 }], "a", false)[0].likeCount).toBe(0);
});
test("rapid taps lock one row while other rows remain interactive; settlement unlocks", () => {
  const gate = createLikeGate();
  expect(gate.acquire("a")).toBe(true);
  expect(gate.acquire("a")).toBe(false);
  expect(gate.acquire("b")).toBe(true);
  gate.release("a");
  expect(gate.acquire("a")).toBe(true);
  expect(gate.acquire("b")).toBe(false);
});

test("rollback preserves a newer count from other people", () => {
  const refreshed = [{ id: "a", iLiked: true, likeCount: 5 }];
  expect(restoreLike(refreshed, initial[0])[0]).toMatchObject({ iLiked: false, likeCount: 4 });
});
