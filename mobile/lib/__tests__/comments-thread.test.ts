import fs from "fs";
import path from "path";
import { threadComments, type FeedComment } from "../feed-comments";

const ROOT = path.resolve(__dirname, "..", "..");

function c(id: string, parentId: string | null, createdAt: string): FeedComment {
  return {
    id, parentId, feedEventId: "e1", userId: "u1", body: id,
    createdAt, likeCount: 0, iLiked: false, replyCount: 0,
    author: { displayName: "A", username: "a", avatarUrl: null },
    canDelete: false,
  };
}

describe("threadComments", () => {
  it("keeps each reply under the comment it answers", () => {
    const out = threadComments([
      c("root1", null, "2026-01-01"),
      c("reply1a", "root1", "2026-01-02"),
      c("root2", null, "2026-01-03"),
      c("reply1b", "root1", "2026-01-04"),
    ]);
    expect(out.map((t) => t.comment.id)).toEqual(["root1", "root2"]);
    expect(out[0].replies.map((r) => r.id)).toEqual(["reply1a", "reply1b"]);
    expect(out[1].replies).toEqual([]);
  });

  it("drops nothing when there are no replies", () => {
    const out = threadComments([c("a", null, "1"), c("b", null, "2")]);
    expect(out).toHaveLength(2);
    expect(out.every((t) => t.replies.length === 0)).toBe(true);
  });

  it("does not lose a reply whose parent is not in the page", () => {
    // A reply can outlive its parent's slice of a paginated list. It must not
    // silently vanish into a Map nobody reads — better an empty result than a
    // comment the user wrote and can no longer see.
    const out = threadComments([c("orphanReply", "missingRoot", "1")]);
    expect(out).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// The glitch, as a guard.
// ----------------------------------------------------------------------------
// The first comments release visibly glitched, from two faults that a type
// checker and a unit test both happily accept:
//
//   1. <CommentsSheet> was rendered inside FeedRow, so every post in the feed
//      mounted its own <Modal>.
//   2. The screen passed `onCountChange={(n) => setCommentCount(ev.id, n)}` —
//      a new function identity every render — and the sheet listed that
//      callback in a useCallback dep array feeding a useEffect. Effect ->
//      parent setState -> re-render -> new arrow -> effect, forever.
//
// Neither is visible in a diff unless you already know to look, so this checks
// the source directly.
// ----------------------------------------------------------------------------
describe("the comments sheet is mounted once, with a stable callback", () => {
  const feed = fs.readFileSync(path.join(ROOT, "app/(tabs)/feed.tsx"), "utf8");

  it("renders exactly one CommentsSheet", () => {
    const mounts = feed.match(/<CommentsSheet\b/g) ?? [];
    expect(mounts).toHaveLength(1);
  });

  it("mounts it at screen level, not inside the row component", () => {
    const rowStart = feed.indexOf("function FeedRow(");
    expect(rowStart).toBeGreaterThan(-1);
    const mountAt = feed.indexOf("<CommentsSheet");
    expect(mountAt).toBeLessThan(rowStart);
  });

  it("never passes an inline arrow as onCountChange", () => {
    // An inline arrow here is the render loop. A named/`useCallback` reference
    // is stable across renders; `{(n) => ...}` is not.
    expect(feed).not.toMatch(/onCountChange=\{\s*\(/);
    expect(feed).toMatch(/onCountChange=\{setCommentCount\}/);
  });

  it("the sheet does not depend on that callback's identity", () => {
    const sheet = fs.readFileSync(path.join(ROOT, "components/CommentsSheet.tsx"), "utf8");
    // Held in a ref and read at call time, so its identity invalidates nothing.
    expect(sheet).toMatch(/countCb\s*=\s*useRef\(/);
    expect(sheet).not.toMatch(/useCallback\([\s\S]{0,600}?\[[^\]]*onCountChange[^\]]*\]\)/);
  });
});
