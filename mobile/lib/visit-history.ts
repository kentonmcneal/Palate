// ============================================================================
// visit-history.ts — turning a flat list of visits into a dining memory.
// ----------------------------------------------------------------------------
// The product thesis is that passive capture builds a history worth having, and
// until now that history had nowhere to live: /all-visits existed but was not a
// tab, and it rendered an undifferentiated stack of cards. A memory has shape —
// days, and the fact that you keep going back.
//
// Repeat count is the load-bearing one. Palate's whole claim is that RETURNING
// to a place says more than rating it, so "4th visit" is the most informative
// thing on the row and the only number here that earns its place.
// ============================================================================

export type VisitLike = {
  id: string;
  visited_at: string;
  restaurant_id: string;
  is_public?: boolean;
  restaurant?: { name?: string | null; chain_name?: string | null } | null;
};

export type VisitDay<T extends VisitLike> = {
  /** Stable local-day key, for list keys and tests. */
  key: string;
  label: string;
  visits: T[];
};

function localDayKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Which visit-to-this-restaurant each one was, counting from the first.
 *
 * Computed over the whole list rather than per day, and always from oldest to
 * newest regardless of the order handed in, so the ordinal means "your Nth time
 * here" and not "the Nth row we happened to render".
 */
export function repeatOrdinals(visits: VisitLike[]): Map<string, number> {
  const chronological = [...visits].sort(
    (a, b) => Date.parse(a.visited_at) - Date.parse(b.visited_at),
  );
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const v of chronological) {
    const n = (seen.get(v.restaurant_id) ?? 0) + 1;
    seen.set(v.restaurant_id, n);
    out.set(v.id, n);
  }
  return out;
}

/** Total visits per restaurant, for "you've been here 4 times". */
export function visitCounts(visits: VisitLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of visits) out.set(v.restaurant_id, (out.get(v.restaurant_id) ?? 0) + 1);
  return out;
}

export function dayLabel(d: Date, now: Date): string {
  const a = localDayKey(d);
  const today = localDayKey(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (a === today) return "Today";
  if (a === localDayKey(yesterdayDate)) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Newest day first, and newest visit first within each day. */
export function groupByDay<T extends VisitLike>(visits: T[], now = new Date()): VisitDay<T>[] {
  const buckets = new Map<string, T[]>();
  for (const v of visits) {
    const key = localDayKey(new Date(v.visited_at));
    const list = buckets.get(key);
    if (list) list.push(v);
    else buckets.set(key, [v]);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({
      key,
      label: dayLabel(new Date(list[0].visited_at), now),
      visits: list.sort((a, b) => Date.parse(b.visited_at) - Date.parse(a.visited_at)),
    }));
}

/**
 * Punctuation and case are dropped from both sides before comparing, so typing
 * "kfar" finds "K'Far Cafe" and "dbos" finds "D'Bo's". Nobody types the
 * apostrophe, and a search that fails on the restaurants people actually go to
 * is worse than no search.
 */
function searchable(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Substring match on restaurant name or chain. Empty query returns everything. */
export function filterVisits<T extends VisitLike>(visits: T[], query: string): T[] {
  const q = searchable(query);
  if (!q) return visits;
  return visits.filter((v) =>
    searchable(v.restaurant?.name).includes(q)
    || searchable(v.restaurant?.chain_name).includes(q),
  );
}
