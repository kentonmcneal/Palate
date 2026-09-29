/** Change only the selected row; rollbacks must not erase unrelated updates. */
export type LikeState = { id: string; iLiked: boolean; likeCount: number };
export function applyLike<T extends LikeState>(rows: T[], id: string, liked: boolean): T[] {
  return rows.map(row => row.id === id ? {
    ...row, iLiked: liked,
    likeCount: Math.max(0, row.likeCount + (row.iLiked === liked ? 0 : liked ? 1 : -1)),
  } : row);
}
export function restoreLike<T extends LikeState>(rows: T[], before: LikeState): T[] {
  return applyLike(rows, before.id, before.iLiked);
}
/** Acquire synchronously, before React renders a disabled state. */
export function createLikeGate() {
  const pending = new Set<string>();
  return {
    acquire(id: string): boolean {
      if (pending.has(id)) return false;
      pending.add(id);
      return true;
    },
    release(id: string) { pending.delete(id); },
  };
}
