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

// Quiet hours (local): default ~9pm–8am. Suppressed visits go to the inbox.
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 8;
// Hard cap on confirmation notifications per day.
const MAX_NOTIFS_PER_DAY = 3;
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

async function notifCountToday(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(RATE_KEY);
    if (!raw) return 0;
    const r = JSON.parse(raw) as { day: string; count: number };
    return r.day === todayKey() ? r.count : 0;
  } catch {
    return 0;
  }
}

async function bumpNotifCount(): Promise<void> {
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

export type NotifyResult = "notified" | "inboxed-quiet" | "inboxed-rate-limited";

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
  };

  // Always land in the inbox so a suppressed prompt is never lost.
  await addToInbox(entry);
  void track("visit_resolved", { place_id: entry.place_id, dwell_min: Math.round(dwellMin), cache_hit: resolved.cacheHit });

  if (isQuietHours()) {
    void track("confirm_notif_suppressed", { reason: "quiet_hours", place_id: entry.place_id });
    return "inboxed-quiet";
  }
  if ((await notifCountToday()) >= MAX_NOTIFS_PER_DAY) {
    void track("confirm_notif_suppressed", { reason: "rate_limit", place_id: entry.place_id });
    return "inboxed-rate-limited";
  }

  await scheduleConfirmNotification(entry);
  await bumpNotifCount();
  void track("confirm_notif_sent", { place_id: entry.place_id });
  return "notified";
}
