// ============================================================================
// friends.ts — friend request flow + friends list + search.
// ----------------------------------------------------------------------------
// Mutual + approval-required model:
//   request -> friendship row with status 'pending'
//   accept  -> status 'accepted'
//   decline -> row deleted
//   unfriend -> row deleted (either party)
// ============================================================================

import { supabase } from "./supabase";

export type FriendshipStatus = "pending" | "accepted" | "blocked";

export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  accepted_at: string | null;
};

export type FriendProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility: "private" | "friends" | "public";
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function currentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
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
// Request / accept / decline / unfriend
// ----------------------------------------------------------------------------

export async function requestFriendship(targetId: string): Promise<void> {
  const me = await currentUserId();
  if (targetId === me) throw new Error("Can't friend yourself");

  // If a row already exists in either direction, normalize:
  // - if accepted: no-op
  // - if pending you sent: no-op
  // - if pending they sent: auto-accept (treat second request as acceptance)
  const existing = await findFriendshipBetween(me, targetId);
  if (existing) {
    if (existing.status === "accepted") return;
    if (existing.requester_id === targetId && existing.status === "pending") {
      await acceptFriendship(existing.requester_id);
      return;
    }
    return; // pending I already sent
  }

  const { error } = await supabase.from("friendships").insert({
    requester_id: me,
    addressee_id: targetId,
    status: "pending",
  });
  if (error) throw error;
  void (async () => {
    const { track } = await import("./analytics");
    track("friend_requested");
  })();
}

export async function acceptFriendship(requesterId: string): Promise<void> {
  const me = await currentUserId();
  const { error } = await supabase
    .from("friendships")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("requester_id", requesterId)
    .eq("addressee_id", me);
  if (error) throw error;
  void (async () => {
    const { track } = await import("./analytics");
    track("friend_accepted");
  })();
}

export async function declineFriendship(requesterId: string): Promise<void> {
  const me = await currentUserId();
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("requester_id", requesterId)
    .eq("addressee_id", me);
  if (error) throw error;
}

export async function unfriend(otherUserId: string): Promise<void> {
  const me = await currentUserId();
  const f = await findFriendshipBetween(me, otherUserId);
  if (!f) return;
  const { error } = await supabase.from("friendships").delete().eq("id", f.id);
  if (error) throw error;
}

async function findFriendshipBetween(a: string, b: string): Promise<Friendship | null> {
  const { data } = await supabase
    .from("friendships")
    .select("*")
    .or(
      `and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`,
    )
    .maybeSingle();
  return (data as Friendship | null) ?? null;
}

// ----------------------------------------------------------------------------
// Lists
// ----------------------------------------------------------------------------

export type FriendListItem = {
  friendship: Friendship;
  /** The other user (not me) in the friendship. */
  friend: FriendProfile;
};

export async function listFriends(): Promise<FriendListItem[]> {
  const me = await currentUserId();
  const { data, error } = await supabase
    .from("friendships")
    .select(`
      *,
      requester:profiles!friendships_requester_id_fkey ( id, email, display_name, avatar_url, profile_visibility ),
      addressee:profiles!friendships_addressee_id_fkey ( id, email, display_name, avatar_url, profile_visibility )
    `)
    .eq("status", "accepted")
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
    .order("accepted_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    friendship: {
      id: row.id,
      requester_id: row.requester_id,
      addressee_id: row.addressee_id,
      status: row.status,
      created_at: row.created_at,
      accepted_at: row.accepted_at,
    },
    friend: row.requester_id === me ? row.addressee : row.requester,
  }));
}

export async function listIncomingRequests(): Promise<FriendListItem[]> {
  const me = await currentUserId();
  const { data, error } = await supabase
    .from("friendships")
    .select(`
      *,
      requester:profiles!friendships_requester_id_fkey ( id, email, display_name, avatar_url, profile_visibility )
    `)
    .eq("status", "pending")
    .eq("addressee_id", me)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    friendship: {
      id: row.id,
      requester_id: row.requester_id,
      addressee_id: row.addressee_id,
      status: row.status,
      created_at: row.created_at,
      accepted_at: row.accepted_at,
    },
    friend: row.requester,
  }));
}

export async function listOutgoingRequests(): Promise<FriendListItem[]> {
  const me = await currentUserId();
  const { data, error } = await supabase
    .from("friendships")
    .select(`
      *,
      addressee:profiles!friendships_addressee_id_fkey ( id, email, display_name, avatar_url, profile_visibility )
    `)
    .eq("status", "pending")
    .eq("requester_id", me)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    friendship: {
      id: row.id,
      requester_id: row.requester_id,
      addressee_id: row.addressee_id,
      status: row.status,
      created_at: row.created_at,
      accepted_at: row.accepted_at,
    },
    friend: row.addressee,
  }));
}
