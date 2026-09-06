// ============================================================================
// passive-inbox-sync.ts — the pending inbox survives a reinstall.
// ----------------------------------------------------------------------------
// The device stays the source of truth. It writes offline, in the background,
// with no network and often with the app killed; a server round trip cannot be
// on that path. This is a MIRROR, and it is read in exactly one situation —
// the local inbox is empty and the server has rows, which is what a reinstall
// looks like.
//
// What travels: the resolved venue, its alternates, and detection metadata.
// Every coordinate in that payload belongs to a RESTAURANT and is already
// public in public.restaurants.
//
// What never travels: the raw location trail. The unresolved queue, the retry
// queue and the 500-point cluster history hold where a person actually stood,
// including their home. Those stay on the phone. The privacy property here is
// that raw location does not leave the device until somebody has said "yes, I
// ate there", and a backup is not a good enough reason to break it. The cost
// is that home/work suppression relearns after a reinstall, which is three
// overnight stays.
//
// Every function is best-effort and silent. A sync failure must never cost a
// detection, block a prompt, or surface an error to somebody who has just
// walked out of a restaurant.
// ============================================================================

import { supabase } from "./supabase";
import type { InboxEntry } from "./passive-confirm";

/** Push the whole inbox up. Idempotent on (user_id, entry_id). */
export async function mirrorInbox(entries: InboxEntry[]): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (entries.length === 0) {
      // An emptied inbox means everything was answered or expired. Clearing
      // the mirror is what stops a reinstall resurrecting prompts somebody
      // already dealt with.
      await supabase.from("passive_inbox").delete().eq("user_id", user.id);
      return;
    }

    await supabase.from("passive_inbox").upsert(
      entries.map((e) => ({
        user_id: user.id,
        entry_id: e.id,
        payload: e as unknown as Record<string, unknown>,
        detected_at: new Date(e.detectedAt).toISOString(),
      })),
      { onConflict: "user_id,entry_id" },
    );

    // Remove anything the device no longer holds, so an answered entry cannot
    // come back from the mirror.
    const keep = entries.map((e) => e.id);
    await supabase
      .from("passive_inbox")
      .delete()
      .eq("user_id", user.id)
      .not("entry_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  } catch {
    // Silent on purpose. See the header.
  }
}

/**
 * Rebuild the local inbox from the mirror, but ONLY when local is empty.
 *
 * The guard is the whole safety property. Merging would let the server
 * resurrect an entry the device has deliberately removed — a confirmation, a
 * dismissal, an expiry — and the user would be asked about the same meal
 * twice. Empty-local is unambiguous: a fresh install, or an inbox that has
 * genuinely been cleared, and in the second case the mirror is empty too.
 */
export async function hydrateInboxIfEmpty(
  localCount: number,
): Promise<InboxEntry[] | null> {
  if (localCount > 0) return null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from("passive_inbox")
      .select("payload")
      .eq("user_id", user.id)
      .order("detected_at", { ascending: false })
      .limit(50);
    if (error || !data || data.length === 0) return null;
    return data
      .map((r) => (r as { payload: InboxEntry }).payload)
      .filter((e) => e && e.id && e.place_id);
  } catch {
    return null;
  }
}
