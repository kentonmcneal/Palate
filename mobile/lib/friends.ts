// ============================================================================
// friends.ts — following, and what "friend" means now.
// ----------------------------------------------------------------------------
// The old model was mutual-accept: you asked, they approved, and only then did
// anything happen. Across fourteen accounts it produced one accepted friendship
// and two requests nobody ever answered. Asking permission to look at where
// somebody ate was too much ceremony for the size of the favour.
//
// Now it is Instagram's shape:
//   follow      -> one row, immediate, no approval
//   they follow back -> the two rows together are a friendship
//   unfollow    -> your row goes; theirs is theirs to remove
//
// "Friends" is therefore not a state anyone sets. It is reciprocity, computed.
// Everything that used to gate on an accepted friendship now gates on either a
// public profile (most surfaces) or a MUTUAL follow (a friends-only profile) —
// following someone must never be a way into a private life.
// ============================================================================

import { supabase } from "./supabase";

/** Where you stand with one other person. */
export type FollowState = "none" | "following" | "follows_you" | "mutual";

export type FriendProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  profile_visibility: "private" | "friends" | "public";
};

export type FollowListItem = {
  friend: FriendProfile;
  followsYou: boolean;
  youFollow: boolean;
  since: string | null;
};

/** Kept as an alias so the group/eat-together screens read unchanged. */
export type FriendListItem = FollowListItem;

export function followStateOf(item: { followsYou: boolean; youFollow: boolean }): FollowState {
  if (item.youFollow && item.followsYou) return "mutual";
  if (item.youFollow) return "following";
  if (item.followsYou) return "follows_you";
  return "none";
}

/** The word for the button, given where you stand. */
export function followLabel(state: FollowState): string {
  switch (state) {
    case "mutual": return "Friends";
    case "following": return "Following";
    case "follows_you": return "Follow back";
    default: return "Follow";
  }
}

// ----------------------------------------------------------------------------
// Search
// ----------------------------------------------------------------------------

export async function searchUsers(query: string): Promise<FriendProfile[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc("search_users", { q });
  if (error) throw error;
  return (data ?? []) as FriendProfile[];
}

// ----------------------------------------------------------------------------
// Follow / unfollow
// ----------------------------------------------------------------------------

/** Follow someone. No approval, no pending state. Returns where you now stand. */
export async function followUser(targetId: string): Promise<FollowState> {
  const { data, error } = await supabase.rpc("follow_user", { target: targetId });
  if (error) throw error;
  void (async () => {
    const { track } = await import("./analytics");
    track("user_followed", { became_friends: data === "mutual" });
  })();
  return (data as FollowState) ?? "following";
}

/** Stop following. Their follow of you, if any, is theirs to remove. */
export async function unfollowUser(targetId: string): Promise<FollowState> {
  const { data, error } = await supabase.rpc("unfollow_user", { target: targetId });
  if (error) throw error;
  return (data as FollowState) ?? "none";
}

// ----------------------------------------------------------------------------
// Lists — one definer RPC (0116), never a PostgREST embed.
// ----------------------------------------------------------------------------
// The embed through profiles came back with the OTHER person null, because the
// only SELECT policy on profiles is own-row. A screen ran `.id` on that and the
// whole app fell into the error boundary (the Board crash). The RPC returns
// exactly what the screens need, and no email.
function rowToItem(row: any): FollowListItem {
  return {
    friend: {
      id: row.id,
      email: null,
      display_name: row.display_name ?? null,
      username: row.username ?? null,
      avatar_url: row.avatar_url ?? null,
      profile_visibility: row.profile_visibility ?? "public",
    },
    followsYou: !!row.follows_you,
    youFollow: !!row.you_follow,
    since: row.since ?? null,
  };
}

async function listFollows(kind: "following" | "followers" | "friends"): Promise<FollowListItem[]> {
  const { data, error } = await supabase.rpc("list_follows", { p_kind: kind });
  if (error) throw error;
  return ((data ?? []) as any[]).filter((r) => r.id).map(rowToItem);
}

export const listFollowing = () => listFollows("following");
export const listFollowers = () => listFollows("followers");
/** Reciprocal follows only — the people the app calls friends. */
export const listFriends = () => listFollows("friends");

export type FollowCounts = { followers: number; following: number; friends: number };

export async function followCounts(userId: string): Promise<FollowCounts> {
  const { data, error } = await supabase.rpc("follow_counts", { target: userId });
  if (error) throw error;
  const row = (data ?? [])[0] as any;
  return {
    followers: row?.followers ?? 0,
    following: row?.following ?? 0,
    friends: row?.friends ?? 0,
  };
}

// ----------------------------------------------------------------------------
// Leaderboard — the people you follow, ranked.
// ----------------------------------------------------------------------------
export type LeaderboardEntry = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  persona_label: string | null;
  total_visits: number;
  visits_this_week: number;
  unique_cuisines: number;
};

export async function loadFriendsLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("friends_leaderboard");
  if (error) throw error;
  return (data ?? []) as LeaderboardEntry[];
}
