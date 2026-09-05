// ============================================================================
// notification-dedupe.ts — cancel by what a notification IS, not by an id we
// hoped to remember.
// ----------------------------------------------------------------------------
// The founder's lock screen on 2026-09-05: six identical "Saturday brunch,
// sorted" at 10:00, six buzzes. Every scheduler in the app used the same
// pattern — store the ids you scheduled, cancel those ids next time — and
// that pattern loses ids whenever two runs overlap. refreshDiscoveryPings is
// called from an effect keyed on `session?.user`, which changes identity on
// INITIAL_SESSION, SIGNED_IN and TOKEN_REFRESHED, so on a normal launch it
// ran three times at once: each read the same stored ids, each cancelled
// them, each scheduled three more, and the last writer's ids were the only
// ones remembered. The other six were orphans that no later run could see.
//
// iOS keeps the list. `getAllScheduledNotificationsAsync` returns everything
// pending with its content, so the honest cancel is: every scheduled
// notification whose data says it is ours of this kind, gone, and then
// schedule exactly one. No stored ids, nothing to lose, nothing to race.
//
// `serialize` wraps a scheduler so overlapping calls queue rather than
// interleave, which closes the last gap: two runs that both read "nothing
// pending" and both schedule.
// ============================================================================

type NotificationsLib = typeof import("expo-notifications");

export type ScheduledLike = {
  identifier: string;
  content: { data?: Record<string, unknown> | null };
};

/** Pure: which of the pending notifications belong to this kind. */
export function ownedBy(
  pending: ScheduledLike[],
  field: "type" | "kind",
  value: string,
): string[] {
  return pending
    .filter((n) => (n.content?.data ?? {})[field] === value)
    .map((n) => n.identifier);
}

/** Cancel every pending notification of ours matching `field === value`. */
export async function cancelScheduledOfKind(
  Notifications: NotificationsLib,
  field: "type" | "kind",
  value: string,
): Promise<number> {
  let pending: ScheduledLike[] = [];
  try {
    pending = (await Notifications.getAllScheduledNotificationsAsync()) as unknown as ScheduledLike[];
  } catch {
    return 0;
  }
  const ids = ownedBy(pending, field, value);
  for (const id of ids) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
  return ids.length;
}

/** Run at most one instance at a time; later callers wait for the earlier. */
export function serialize<T>(fn: () => Promise<T>): () => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return () => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
}
