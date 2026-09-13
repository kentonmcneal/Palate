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

/**
 * The subset of an InboxEntry that may leave the phone.
 *
 * A WHITELIST, and it must stay one. This used to be `payload: e`, spreading
 * the entire entry — and `stopLat`/`stopLng` were added to InboxEntry later
 * (migration 0145, so a refusal could be recorded against a position rather
 * than a brand). Nobody revisited this line, so the moment those two fields
 * existed they began travelling: the exact raw-location-before-confirmation
 * leak the header of this file promises does not happen.
 *
 * That is why it is a whitelist. A blacklist, or a spread-and-delete, is one
 * future field away from the same bug — and the next person adding a field to
 * InboxEntry will not think about this file either.
 *
 * Every coordinate that remains belongs to a RESTAURANT and is already public
 * in public.restaurants. Where the PERSON stood is not here.
 *
 * Cost of the fix: after a reinstall, a restored entry cannot record a
 * location-scoped refusal, because the stop position is gone. It degrades to a
 * brand-scoped one. That is the correct trade — the learning is a nicety, the
 * privacy property is a promise.
 */
function mirrorPayload(e: InboxEntry): Record<string, unknown> {
  return {
    id: e.id,
    place_id: e.place_id,
    name: e.name,
    address: e.address,
    alternates: e.alternates,
    detectedAt: e.detectedAt,
    dwellMin: e.dwellMin,
    accuracyM: e.accuracyM,
    source: e.source,
    confidence: e.confidence,
    confidenceBand: e.confidenceBand,
    candidateCount: e.candidateCount,
    cluster: e.cluster,
    // stopLat / stopLng deliberately absent. See above.
  };
}

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
        payload: mirrorPayload(e),
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
