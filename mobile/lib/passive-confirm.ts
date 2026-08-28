// ============================================================================
// passive-confirm.ts — Phase 4: turn a resolved visit into a confirmation.
// ----------------------------------------------------------------------------
// Fires a local notification on DEPARTURE ("Did you eat at [X]?") that deep-links
// into the existing /confirm-visit screen. Respects quiet hours (→ inbox, never
// the void) and a hard daily notification cap (two bad prompts and the user kills
// notifications forever). Unconfirmed inbox entries expire so it never becomes a
// chore list.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import type { Restaurant } from "./places";
import type { ResolvedVisit } from "./passive-pipeline";
import { track } from "./analytics";
import { recentlyPrompted } from "./visits";

// Quiet hours (local): default ~9pm–8am. Suppressed visits go to the inbox.
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 8;
// Hard cap on confirmation notifications per day.
export const MAX_NOTIFS_PER_DAY = 3;

/** How long a dismissed venue stays suppressed. Short enough that lunch and
 *  dinner at the same place both get asked about; long enough that walking
 *  back past somewhere you just rejected stays quiet. */
export const REPROMPT_SUPPRESSION_MIN = 180;
// Inbox entries older than this are dropped so the list never becomes a chore.
const INBOX_EXPIRY_HOURS = 24;

const INBOX_KEY = "palate.passive.inbox";
const RATE_KEY = "palate.passive.notifRate"; // { day: "YYYY-MM-DD", count: n }

export type InboxEntry = {
  id: string;
  place_id: string;
  name: string;
  address: string;
  alternates: Restaurant[];
  detectedAt: number; // epoch ms
  dwellMin: number;
  // Detection characteristics, carried through to the confirm/dismiss event so
  // thresholds can be tuned against what people actually accept rather than
  // against a guess. Optional: entries written before this existed lack them.
  accuracyM?: number;
  source?: string;
  /** How many venues were in range — the honest measure of attribution difficulty. */
  candidateCount?: number;
};

export function isQuietHours(date = new Date()): boolean {
  const h = date.getHours();
  // Wraps midnight: 21:00–23:59 or 00:00–07:59.
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

function todayKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Exported for tests: the daily cap is a promise to the user, so it needs one. */
export async function notifCountToday(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(RATE_KEY);
    if (!raw) return 0;
    const r = JSON.parse(raw) as { day: string; count: number };
    return r.day === todayKey() ? r.count : 0;
  } catch {
    return 0;
  }
}

export async function bumpNotifCount(): Promise<void> {
  const day = todayKey();
  const current = await notifCountToday();
  await AsyncStorage.setItem(RATE_KEY, JSON.stringify({ day, count: current + 1 }));
}

// ----------------------------------------------------------------------------
// Inbox
// ----------------------------------------------------------------------------

export async function getInbox(): Promise<InboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(INBOX_KEY);
    const all = raw ? (JSON.parse(raw) as InboxEntry[]) : [];
    const cutoff = Date.now() - INBOX_EXPIRY_HOURS * 3_600_000;
    const live = all.filter((e) => e.detectedAt >= cutoff);
    if (live.length !== all.length) await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(live));
    return live.sort((a, b) => b.detectedAt - a.detectedAt);
  } catch {
    return [];
  }
}

async function addToInbox(entry: InboxEntry): Promise<void> {
  const existing = await getInbox();
  if (existing.some((e) => e.place_id === entry.place_id && Math.abs(e.detectedAt - entry.detectedAt) < 3_600_000)) {
    return; // dedupe same place within an hour
  }
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify([entry, ...existing]));
}

export async function removeFromInbox(id: string): Promise<void> {
  const existing = await getInbox();
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(existing.filter((e) => e.id !== id)));
}

/** Params for the shared /confirm-visit screen, from an inbox entry. */
export function confirmParamsFor(entry: InboxEntry) {
  return {
    place_id: entry.place_id,
    name: entry.name,
    address: entry.address,
    alternates: JSON.stringify(entry.alternates),
    confidence: "high" as const,
    inbox_id: entry.id,
    // Threaded through so the outcome event can report what the detection
    // looked like. Strings: expo-router params are strings either way.
    dwell_min: String(Math.round(entry.dwellMin)),
    accuracy_m: entry.accuracyM == null ? "" : String(Math.round(entry.accuracyM)),
    detect_source: entry.source ?? "",
    candidate_count: String(entry.candidateCount ?? 0),
  };
}

// ----------------------------------------------------------------------------
// Notify-or-inbox
// ----------------------------------------------------------------------------

async function scheduleConfirmNotification(entry: InboxEntry): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Did you eat at ${entry.name}?`,
      body: "Tap to confirm your visit.",
      data: { kind: "passive_confirm", ...confirmParamsFor(entry) },
    },
    trigger: null, // deliver now (called on departure)
  });
}

export type NotifyResult =
  | "notified"
  | "inboxed-quiet"
  | "inboxed-rate-limited"
  | "suppressed-recent";

/** Fire a confirmation for a resolved visit, or route it to the inbox. */
export async function notifyOrInbox(resolved: ResolvedVisit, dwellMin: number): Promise<NotifyResult> {
  const [top, ...rest] = resolved.candidates;
  const entry: InboxEntry = {
    id: resolved.raw.id,
    place_id: top.google_place_id,
    name: top.name,
    address: top.address ?? "",
    alternates: rest,
    detectedAt: resolved.raw.departureAt ?? resolved.raw.capturedAt,
    dwellMin,
    accuracyM: resolved.raw.horizontalAccuracy,
    source: resolved.raw.source ?? "visit",
    candidateCount: resolved.candidates.length,
  };

  // A venue the user just dismissed does NOT go to the inbox. The
  // "never lose a prompt" rule protects prompts we couldn't deliver; this one
  // was delivered and actively rejected, so re-surfacing it is nagging. With a
  // 5-minute floor this matters more than it used to: walking past a place
  // twice in an afternoon is ordinary.
  if (await recentlyPrompted(entry.place_id, REPROMPT_SUPPRESSION_MIN).catch(() => false)) {
    void track("confirm_notif_suppressed", { reason: "recently_dismissed", place_id: entry.place_id });
    return "suppressed-recent";
  }

  // Always land in the inbox so a prompt we couldn't deliver is never lost.
  await addToInbox(entry);
  void track("visit_resolved", {
    place_id: entry.place_id,
    dwell_min: Math.round(dwellMin),
    cache_hit: resolved.cacheHit,
    accuracy_m: Math.round(resolved.raw.horizontalAccuracy),
    source: resolved.raw.source ?? "visit",
    candidate_count: resolved.candidates.length,
  });

  if (isQuietHours()) {
    void track("confirm_notif_suppressed", { reason: "quiet_hours", place_id: entry.place_id });
    return "inboxed-quiet";
  }
  if ((await notifCountToday()) >= MAX_NOTIFS_PER_DAY) {
    void track("confirm_notif_suppressed", { reason: "rate_limit", place_id: entry.place_id });
    return "inboxed-rate-limited";
  }

  // No notification permission → leave it in the inbox and DON'T burn the daily
  // cap on a prompt the OS will never present.
  const perm = await Notifications.getPermissionsAsync().catch(() => null);
  if (!perm?.granted) {
    void track("confirm_notif_suppressed", { reason: "no_permission", place_id: entry.place_id });
    return "inboxed-quiet";
  }

  await scheduleConfirmNotification(entry);
  await bumpNotifCount();
  void track("confirm_notif_sent", { place_id: entry.place_id });
  return "notified";
}
