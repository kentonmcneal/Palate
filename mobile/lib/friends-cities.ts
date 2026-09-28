// ============================================================================
// friends-cities.ts — which of your people are in which city lately.
// ----------------------------------------------------------------------------
// One read of `friends_cities` (migration 0180). Everything that matters about
// this feature is enforced in the database, not here: mutual follow only,
// private profiles excluded, two visits minimum before a city appears, month
// grain rather than timestamps, and no restaurant identity in the payload.
// A client cannot widen any of that by asking differently.
//
// It costs nothing to run. City is derived from addressComponents already
// stored on restaurants, so this screen never triggers a Google call.
// ============================================================================

import { supabase } from "./supabase";

export type FriendCity = {
  friendId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  city: string;
  region: string | null;
  visitCount: number;
  /** First of the month of their most recent visit there. Never a timestamp. */
  lastMonth: string;
};

/** "Philadelphia, PA" — region included so Portland OR and Portland ME differ. */
export function cityLabel(c: Pick<FriendCity, "city" | "region">): string {
  return c.region ? `${c.city}, ${c.region}` : c.city;
}

/** "this month" / "last month" / "March" — deliberately no day, ever. */
export function whenLabel(lastMonth: string, now = new Date()): string {
  const d = new Date(`${lastMonth}T00:00:00Z`);
  const months = (now.getUTCFullYear() - d.getUTCFullYear()) * 12
    + (now.getUTCMonth() - d.getUTCMonth());
  if (months <= 0) return "this month";
  if (months === 1) return "last month";
  return d.toLocaleString(undefined, { month: "long", timeZone: "UTC" });
}

/** One friend, and the cities they have been eating in. */
export type FriendCityGroup = {
  friendId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  cities: FriendCity[];
};

export async function friendsCities(days = 90): Promise<FriendCity[]> {
  const { data, error } = await supabase.rpc("friends_cities", { p_days: days });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    friendId: String(r.friend_id),
    displayName: (r.display_name as string) ?? null,
    username: (r.username as string) ?? null,
    avatarUrl: (r.avatar_url as string) ?? null,
    city: String(r.city),
    region: (r.region as string) ?? null,
    visitCount: Number(r.visit_count ?? 0),
    lastMonth: String(r.last_month),
  }));
}

/** Group by person, most recent city first. The RPC already orders by
 *  recency, so first-seen order is preserved rather than re-sorted. */
export function groupByFriend(rows: FriendCity[]): FriendCityGroup[] {
  const out: FriendCityGroup[] = [];
  const index = new Map<string, FriendCityGroup>();
  for (const r of rows) {
    let g = index.get(r.friendId);
    if (!g) {
      g = {
        friendId: r.friendId,
        displayName: r.displayName,
        username: r.username,
        avatarUrl: r.avatarUrl,
        cities: [],
      };
      index.set(r.friendId, g);
      out.push(g);
    }
    g.cities.push(r);
  }
  return out;
}
