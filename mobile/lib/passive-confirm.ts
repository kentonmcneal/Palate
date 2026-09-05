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
import { allowsRealtimePrompt } from "./passive-digest";

// Quiet hours (local): default ~9pm–8am. Suppressed visits go to the inbox.
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 8;
// Hard cap on confirmation notifications per day.
// Raised from 3 (2026-08-31). Three was set when the dwell floor was 20 minutes
// and chains were excluded, so a prompt was a rare event. With a 5-minute floor
// and fast food now loggable, an ordinary food day — coffee, lunch, a snack,
// dinner — exceeds three, and the surplus was silently inboxed. From the user's
// seat that is indistinguishable from the feature not working.
export const MAX_NOTIFS_PER_DAY = 6;

/** How long a dismissed venue stays suppressed. Short enough that lunch and
 *  dinner at the same place both get asked about; long enough that walking
 *  back past somewhere you just rejected stays quiet. */
export const REPROMPT_SUPPRESSION_MIN = 180;
// Inbox entries older than this are dropped so the list never becomes a chore.
// 48, not 24. The digest for a Monday 21:10 dinner fires Tuesday 21:00 and
// names the place; at 24h the entry was purged five minutes after that
// notification, so tapping it showed "nothing captured". Two days covers the
// longest cycle (Friday 23:00 → Saturday 23:00) plus a reasonable evening.
const INBOX_EXPIRY_HOURS = 48;

const INBOX_KEY = "palate.passive.inbox";
const RATE_KEY = "palate.passive.notifRate"; // { day: "YYYY-MM-DD", count: n }
const LAST_NOTIF_KEY = "palate.passive.lastNotifAt";

/** Minimum gap between two confirm notifications, whatever the venue.
 *  A tester's lock screen showed Kobe twice and Nashmi three times in nine
 *  minutes: the inbox deduped those, but the notification path never consulted
 *  the inbox, so every detection still buzzed. The per-place check below stops
 *  repeats of ONE venue; this stops a burst across several. */
export const MIN_NOTIF_GAP_MIN = 15;

/** Notification category carrying the Yes/No lock-screen actions. */
export const CONFIRM_CATEGORY = "passive_confirm";

/**
 * Real-time per-visit prompts. OFF: confirmation happens in the nightly digest.
 *
 * The digest is the engagement loop — perfect passive capture leaves the user
 * no reason to open the app, and a prompt answered on the lock screen does not
 * bring them back either. Confirming a day at once is also cheaper than being
 * interrupted per meal, and it frees the notification budget for one message
 * that carries something back.
 *
 * Flip to true to restore per-visit prompts; the path below is intact and
 * gated on the High band only.
 */
export const REALTIME_PROMPTS_ENABLED = false;

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
  /** Confidence in this attribution at the time it was raised, plus its band.
   *  Recorded so calibration is answerable: of entries scored High, what
   *  fraction get confirmed? Below ~85% the pre-check is costing trust. */
  confidence?: number;
  confidenceBand?: string;
  /** How many venues were in range — the honest measure of attribution difficulty. */
  candidateCount?: number;
  /** Several venues within CLUSTER_RADIUS_M — ask as a multi-select rather
   *  than picking a winner and asking about it alone. */
  cluster?: boolean;
};

/** Radius within which several venues are one decision, not several. Food
 *  halls, strip malls and dense blocks all land here: the phone genuinely
 *  cannot tell which counter you ate at, and asking N separate times is the
 *  storm a tester reported from the other direction. */
export const CLUSTER_RADIUS_M = 75;

function metersBetween(
  a: { latitude?: number | null; longitude?: number | null },
  b: { latitude?: number | null; longitude?: number | null },
): number | null {
  if (a.latitude == null || a.longitude == null) return null;
  if (b.latitude == null || b.longitude == null) return null;
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Candidates that sit on top of each other — ask once, as a multi-select,
 * instead of guessing a winner and asking about it alone.
 * Exported for tests.
 */
export function clusteredCandidates<T extends { latitude?: number | null; longitude?: number | null }>(
  candidates: T[],
): T[] {
  if (candidates.length < 2) return [];
  const [top, ...rest] = candidates;
  const near = rest.filter((c) => {
    const d = metersBetween(top, c);
    return d != null && d <= CLUSTER_RADIUS_M;
  });
  return near.length >= 1 ? [top, ...near] : [];
}

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

/** Exported for tests. */
export async function minutesSinceLastNotif(now = Date.now()): Promise<number | null> {
  const raw = await AsyncStorage.getItem(LAST_NOTIF_KEY);
  if (!raw) return null;
  const t = Number(raw);
  if (!Number.isFinite(t)) return null;
  return (now - t) / 60_000;
}

export async function bumpNotifCount(): Promise<void> {
  await AsyncStorage.setItem(LAST_NOTIF_KEY, String(Date.now()));
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
    if (live.length !== all.length) {
      await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(live));
      // An entry that expires unanswered is an IGNORE, and ignores are almost
      // certainly the most common outcome. Dropping them silently would bias
      // calibration upward: "of entries scored High, what fraction get
      // confirmed?" would only count the ones people bothered to answer, so a
      // stream of bad High prompts that everyone ignores would score as
      // excellent. The denominator has to include everything we claimed.
      for (const e of all.filter((x) => x.detectedAt < cutoff)) {
        void track("visit_ignored", {
          place_id: e.place_id,
          confidence: e.confidence == null ? null : Number(e.confidence.toFixed(3)),
          confidence_band: e.confidenceBand ?? null,
          dwell_min: Math.round(e.dwellMin),
          source: e.source ?? null,
          candidate_count: e.candidateCount ?? null,
        });
      }
    }
    return live.sort((a, b) => b.detectedAt - a.detectedAt);
  } catch {
    return [];
  }
}

/** Returns false when this was a duplicate of an entry we already hold. The
 *  caller needs that answer: a duplicate must not produce a second buzz. */
async function addToInbox(entry: InboxEntry): Promise<boolean> {
  const existing = await getInbox();
  if (existing.some((e) => e.place_id === entry.place_id && Math.abs(e.detectedAt - entry.detectedAt) < 3_600_000)) {
    return false; // dedupe same place within an hour
  }
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify([entry, ...existing]));
  return true;
}

/**
 * Debug only: drop a spread of entries into the inbox so the digest can be
 * exercised without waiting for a real capture and 8:30pm.
 *
 * Bands are set explicitly rather than scored, because the point is to verify
 * the DIGEST — pre-check state, section ordering, the "which one?" picker —
 * not the scorer, which has its own tests. One ambiguous entry is included
 * since that path renders differently from the rest.
 */
export async function seedDigestFixtures(): Promise<number> {
  const now = Date.now();
  const at = (hoursAgo: number) => now - hoursAgo * 3_600_000;
  const fixtures: InboxEntry[] = [
    {
      id: `dbg-high-${now}`, place_id: `dbg-high-${now}`, name: "Test Diner (high)",
      address: "", alternates: [], detectedAt: at(6), dwellMin: 42,
      confidence: 0.88, confidenceBand: "high", candidateCount: 1, source: "stop",
    },
    {
      id: `dbg-med-${now}`, place_id: `dbg-med-${now}`, name: "Test Cafe (medium)",
      address: "", alternates: [], detectedAt: at(3), dwellMin: 9,
      confidence: 0.55, confidenceBand: "medium", candidateCount: 1, source: "stop",
    },
    {
      id: `dbg-low-${now}`, place_id: `dbg-low-${now}`, name: "Test Food Hall (low, ambiguous)",
      address: "", alternates: [
        { google_place_id: `dbg-alt1-${now}`, name: "Stall One" },
        { google_place_id: `dbg-alt2-${now}`, name: "Stall Two" },
      ] as InboxEntry["alternates"],
      detectedAt: at(1), dwellMin: 7,
      confidence: 0.22, confidenceBand: "low", candidateCount: 4, source: "stop",
    },
  ];
  const existing = await getInbox();
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify([...fixtures, ...existing]));
  return fixtures.length;
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
    confidence: (entry.confidenceBand ?? "high") as "high" | "medium" | "low",
    inbox_id: entry.id,
    // Threaded through so the outcome event can report what the detection
    // looked like. Strings: expo-router params are strings either way.
    dwell_min: String(Math.round(entry.dwellMin)),
    accuracy_m: entry.accuracyM == null ? "" : String(Math.round(entry.accuracyM)),
    detect_source: entry.source ?? "",
    confidence_score: entry.confidence == null ? "" : entry.confidence.toFixed(3),
    candidate_count: String(entry.candidateCount ?? 0),
    cluster: entry.cluster ? "1" : "",
  };
}

// ----------------------------------------------------------------------------
// Notify-or-inbox
// ----------------------------------------------------------------------------

/**
 * Register the Yes/No actions once per launch. opensAppToForeground:false is
 * the whole point — the tester asked to answer "without opening the app".
 */
export async function registerConfirmCategory(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(CONFIRM_CATEGORY, [
      {
        identifier: "confirm_yes",
        buttonTitle: "Yes, I ate here",
        options: { opensAppToForeground: false },
      },
      {
        identifier: "confirm_no",
        buttonTitle: "No",
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);
  } catch {
    // Categories are a native capability; never let this break launch.
  }
}

async function scheduleConfirmNotification(entry: InboxEntry): Promise<void> {
  // A cluster has no single right answer, so it gets no Yes/No buttons —
  // tapping opens the multi-select instead. Attaching Yes/No here would make
  // "Yes" mean "the one we guessed", which is the wrong guess by definition.
  const isCluster = entry.cluster === true;
  const count = 1 + entry.alternates.length;
  await Notifications.scheduleNotificationAsync({
    content: isCluster
      ? {
          title: `Where'd you eat near ${entry.name}?`,
          body: `${count} spots in range. Tap to check off the ones you ate at.`,
          data: { kind: "passive_confirm", multi: "1", ...confirmParamsFor(entry) },
        }
      : {
          title: `Did you eat at ${entry.name}?`,
          body: "Yes or No, no need to open the app.",
          categoryIdentifier: CONFIRM_CATEGORY,
          data: { kind: "passive_confirm", ...confirmParamsFor(entry) },
        },
    trigger: null, // deliver now (called on departure)
  });
}

/** Rewrite tonight's digest to include everything captured so far today. */
async function rescheduleDigest(): Promise<void> {
  try {
    const { scheduleDigest, DIGEST_NOTIF_ID_STORAGE_KEY } = await import("./passive-digest");
    await scheduleDigest(
      await getInbox(),
      () => AsyncStorage.getItem(DIGEST_NOTIF_ID_STORAGE_KEY),
      async (id) => {
        if (id) await AsyncStorage.setItem(DIGEST_NOTIF_ID_STORAGE_KEY, id);
        else await AsyncStorage.removeItem(DIGEST_NOTIF_ID_STORAGE_KEY);
      },
    );
  } catch {
    // Scheduling is best-effort; the entry is already safely in the inbox.
  }
}

export type NotifyResult =
  | "notified"
  | "inboxed-quiet"
  | "inboxed-rate-limited"
  | "suppressed-recent"
  | "suppressed-duplicate"
  | "inboxed-digest";

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
    confidence: resolved.confidence,
    confidenceBand: resolved.confidenceBand,
    candidateCount: resolved.candidates.length,
    cluster: clusteredCandidates(resolved.candidates).length >= 2,
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
  const isNew = await addToInbox(entry);
  void track("visit_resolved", {
    place_id: entry.place_id,
    dwell_min: Math.round(dwellMin),
    cache_hit: resolved.cacheHit,
    accuracy_m: Math.round(resolved.raw.horizontalAccuracy),
    source: resolved.raw.source ?? "visit",
    candidate_count: resolved.candidates.length,
    // Optional on purpose: a ResolvedVisit built by an older build — or held in
    // the inbox from before scoring existed — has no confidence, and telemetry
    // must not throw on it.
    confidence: resolved.confidence == null ? null : Number(resolved.confidence.toFixed(3)),
    confidence_band: resolved.confidenceBand ?? null,
  });

  // Already holding this venue from a recent detection: the inbox collapsed
  // it, and the notification must collapse with it. This is the duplicate
  // storm a tester screenshotted.
  if (!isNew) {
    void track("confirm_notif_suppressed", { reason: "duplicate_recent", place_id: entry.place_id });
    return "suppressed-duplicate";
  }

  // Digest-only: the entry is captured, and tonight's digest is rewritten to
  // include it. No per-visit interruption.
  if (!REALTIME_PROMPTS_ENABLED) {
    await rescheduleDigest();
    return "inboxed-digest";
  }

  // Everything below is the real-time path, kept intact behind the flag.
  // High band only — a Medium guess is not worth interrupting anyone for.
  if (!allowsRealtimePrompt(entry)) {
    void track("confirm_notif_suppressed", { reason: "below_high_band", place_id: entry.place_id });
    await rescheduleDigest();
    return "inboxed-digest";
  }

  if (isQuietHours()) {
    void track("confirm_notif_suppressed", { reason: "quiet_hours", place_id: entry.place_id });
    return "inboxed-quiet";
  }
  const sinceLast = await minutesSinceLastNotif();
  if (sinceLast != null && sinceLast < MIN_NOTIF_GAP_MIN) {
    void track("confirm_notif_suppressed", { reason: "min_gap", place_id: entry.place_id });
    return "inboxed-rate-limited";
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
  void track("confirm_notif_sent", {
    place_id: entry.place_id,
    confidence_band: entry.confidenceBand ?? null,
  });
  return "notified";
}

// ----------------------------------------------------------------------------
// Headless confirm — the lock-screen action path
// ----------------------------------------------------------------------------
// A tester asked to confirm or deny a visit without opening the app: "as least
// friction as possible". The notification now carries Yes/No actions, and an
// action with opensAppToForeground:false gives us a short background window
// with NO UI mounted. So the write path can't live in app/confirm-visit.tsx —
// it lives here, callable from the notification response handler.
//
// Two things follow from having no UI:
//   • Failures are invisible. A dropped write would silently lose the visit,
//     so anything that fails is queued and drained on next foreground.
//   • Success is invisible too. saveVisit() is already idempotent inside its
//     dedup window, so a replayed queue item can't double-log.

const CONFIRM_QUEUE_KEY = "palate.passive.confirmQueue";

export type QueuedAction = {
  kind: "confirm" | "decline";
  placeId: string;
  name: string;
  inboxId?: string;
  queuedAt: number;
};

async function readQueue(): Promise<QueuedAction[]> {
  try {
    const raw = await AsyncStorage.getItem(CONFIRM_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

async function enqueue(action: QueuedAction): Promise<void> {
  const q = await readQueue();
  // Drop anything older than a day — a stale "I ate here" is worse than none.
  const fresh = q.filter((a) => Date.now() - a.queuedAt < 24 * 3_600_000);
  fresh.push(action);
  await AsyncStorage.setItem(CONFIRM_QUEUE_KEY, JSON.stringify(fresh));
}

/**
 * Log a visit from a notification action, with no screen mounted.
 * Returns true when the write landed, false when it was queued for retry.
 */
export async function confirmVisitById(input: {
  placeId: string;
  name?: string;
  inboxId?: string;
}): Promise<boolean> {
  const { saveVisit, recordPromptDecision } = await import("./visits");
  try {
    await saveVisit({ googlePlaceId: input.placeId, source: "auto" });
    await recordPromptDecision(input.placeId, "confirmed").catch(() => {});
    if (input.inboxId) await removeFromInbox(input.inboxId).catch(() => {});
    void track("confirm_yes", { place_id: input.placeId, source: "notification_action" });
    return true;
  } catch {
    await enqueue({
      kind: "confirm",
      placeId: input.placeId,
      name: input.name ?? "",
      inboxId: input.inboxId,
      queuedAt: Date.now(),
    });
    void track("confirm_action_queued", { place_id: input.placeId, kind: "confirm" });
    return false;
  }
}

/** Record a "No" from a notification action. Queued on failure too: losing a
 *  dismissal means we re-prompt for a place the user already rejected. */
export async function declineVisitById(input: {
  placeId: string;
  name?: string;
  inboxId?: string;
}): Promise<boolean> {
  const { recordPromptDecision } = await import("./visits");
  try {
    await recordPromptDecision(input.placeId, "dismissed");
    if (input.inboxId) await removeFromInbox(input.inboxId).catch(() => {});
    void track("confirm_no", { place_id: input.placeId, source: "notification_action" });
    return true;
  } catch {
    await enqueue({
      kind: "decline",
      placeId: input.placeId,
      name: input.name ?? "",
      inboxId: input.inboxId,
      queuedAt: Date.now(),
    });
    void track("confirm_action_queued", { place_id: input.placeId, kind: "decline" });
    return false;
  }
}

/** Replay queued actions. Safe to call on every foreground: saveVisit dedups
 *  server-side, so a double-drain cannot double-log. */
export async function drainConfirmQueue(): Promise<number> {
  const q = await readQueue();
  if (q.length === 0) return 0;
  await AsyncStorage.removeItem(CONFIRM_QUEUE_KEY);

  let done = 0;
  for (const a of q) {
    const ok = a.kind === "confirm"
      ? await confirmVisitById({ placeId: a.placeId, name: a.name, inboxId: a.inboxId })
      : await declineVisitById({ placeId: a.placeId, name: a.name, inboxId: a.inboxId });
    if (ok) done++;
    // A failed replay re-queues itself inside confirm/declineVisitById.
  }
  if (done > 0) void track("confirm_queue_drained", { count: done });
  return done;
}
