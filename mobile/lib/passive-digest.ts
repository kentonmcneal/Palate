// ============================================================================
// passive-digest.ts — the nightly confirmation digest.
// ----------------------------------------------------------------------------
// Strategic, not cosmetic. Perfect passive capture means the user has no reason
// to open the app; the digest is that reason. So it must RETURN value, not only
// request a chore — see docs/CAPTURE_SPEC.md.
//
// Ordering is the load-bearing decision. Confidence ranking and chronological
// order pull against each other, and chronology is how people actually
// reconstruct a day ("lunch, then coffee, then dinner"). Sorting purely by
// confidence would destroy the recall scaffold that makes confirmation fast.
//
// Resolution: BAND first, CHRONOLOGICAL within band. A user who only ever
// touches the High section still ends up with an accurate ledger; Medium and
// Low are upside, not obligation.
// ============================================================================

import type { InboxEntry } from "./passive-confirm";
import type { ConfidenceBand } from "./passive-confidence";
import { confidenceBand, HIGH_BAND_MIN } from "./passive-confidence";

export type DigestEntry = InboxEntry & {
  band: ConfidenceBand;
  /** High-band entries arrive pre-checked; everything else is opt-in. */
  preChecked: boolean;
  /** Several plausible venues — ask "which one?" rather than yes/no. */
  ambiguous: boolean;
};

export type Digest = {
  date: string;
  high: DigestEntry[];
  medium: DigestEntry[];
  low: DigestEntry[];
  total: number;
};

/** More than one plausible venue in range makes yes/no the wrong question. */
export const AMBIGUOUS_CANDIDATE_COUNT = 2;

/**
 * Band an entry. Entries written before scoring existed carry no confidence;
 * they are treated as Medium — shown, never pre-checked. Silently promoting
 * unscored history to High would pre-check guesses.
 */
export function bandFor(entry: InboxEntry): ConfidenceBand {
  if (entry.confidenceBand) return entry.confidenceBand as ConfidenceBand;
  if (typeof entry.confidence === "number") return confidenceBand(entry.confidence);
  return "medium";
}

function toDigestEntry(entry: InboxEntry): DigestEntry {
  const band = bandFor(entry);
  return {
    ...entry,
    band,
    preChecked: band === "high",
    ambiguous: (entry.candidateCount ?? 1) >= AMBIGUOUS_CANDIDATE_COUNT,
  };
}

const byTime = (a: DigestEntry, b: DigestEntry) => a.detectedAt - b.detectedAt;

/**
 * Start of the period a digest covers: the most recent digest hour at or before
 * `now`, minus a day.
 *
 * This replaced a strict same-calendar-day filter that silently destroyed data.
 * The digest fires at 8:30pm; a 9pm dinner is detected AFTER it fires, so it
 * misses that evening. Under the old rule the next evening's digest asked for
 * "today" only — and the 9pm visit belonged to yesterday, so it was never shown
 * again by anything. Every meal eaten after 8:30pm disappeared, which for a
 * dining app is close to the worst possible slice to lose.
 *
 * Anchoring to the digest hour rather than using a plain rolling 24h keeps the
 * list stable while somebody works through it: opening the digest at 8:35pm and
 * again at 11pm shows the same set, instead of items falling off the top as the
 * clock moves.
 */
export function digestWindowStart(now: Date): Date {
  // The most recent digest moment at or before `now` — today's if it has
  // passed, otherwise yesterday's.
  let anchorDay = new Date(now);
  if (digestMomentOn(anchorDay).getTime() > now.getTime()) {
    anchorDay.setDate(anchorDay.getDate() - 1);
  }
  // The window opens at the digest BEFORE that one, so it always spans a full
  // cycle. Computed from the previous day rather than by subtracting 24 hours,
  // because the hour differs by weekday: the window that closes Saturday at
  // 11pm opened Friday at 9pm, and that is 26 hours, not 24.
  const prevDay = new Date(anchorDay);
  prevDay.setDate(prevDay.getDate() - 1);
  return digestMomentOn(prevDay);
}

/** Entries detected within the current digest window. */
export function entriesForDigest(entries: InboxEntry[], now: Date): InboxEntry[] {
  const start = digestWindowStart(now).getTime();
  const end = now.getTime();
  return entries.filter((e) => e.detectedAt > start && e.detectedAt <= end);
}

export function buildDigest(entries: InboxEntry[], now = new Date()): Digest {
  const pending = entriesForDigest(entries, now).map(toDigestEntry);
  return {
    date: now.toISOString().slice(0, 10),
    high: pending.filter((e) => e.band === "high").sort(byTime),
    medium: pending.filter((e) => e.band === "medium").sort(byTime),
    low: pending.filter((e) => e.band === "low").sort(byTime),
    total: pending.length,
  };
}

/** Nothing to confirm and nothing to show — do not send a notification. */
export function isDigestWorthSending(digest: Digest): boolean {
  return digest.high.length + digest.medium.length > 0;
}

/**
 * Notification copy. Declarative, not interrogative: "Chipotle, 12:40pm", never
 * "Did you eat at Chipotle?". Confirmation is far cheaper cognitively than
 * input, and the phrasing is what makes it feel like confirming rather than
 * being interrogated.
 */
export function digestNotificationBody(digest: Digest, formatTime: (ms: number) => string): string {
  const shown = [...digest.high, ...digest.medium];
  if (!shown.length) return "";
  if (shown.length === 1) {
    return `${shown[0].name}, ${formatTime(shown[0].detectedAt)}. Tap to confirm.`;
  }
  const names = shown.slice(0, 2).map((e) => e.name).join(", ");
  const rest = shown.length - 2;
  return rest > 0
    ? `${names} and ${rest} more. Tap to confirm.`
    : `${names}. Tap to confirm.`;
}

/**
 * Whether a real-time prompt is permitted for this entry. High band only —
 * everything else waits for the digest. Dense-retail cases can never qualify
 * because the density ceiling keeps them below the High threshold.
 */
export function allowsRealtimePrompt(entry: InboxEntry): boolean {
  return (entry.confidence ?? 0) >= HIGH_BAND_MIN;
}

// ----------------------------------------------------------------------------
// Scheduling
// ----------------------------------------------------------------------------
//
// A local notification's content is fixed when it is scheduled, and iOS gives
// us no reliable way to run code just before one fires. So we cannot schedule a
// blank 8:30pm digest each morning and fill it in later.
//
// Instead the digest is (re)scheduled every time a visit lands in the inbox,
// for tonight at that night's digest hour, with copy reflecting everything so far.
// The consequence is the behaviour we want: a day with no captures schedules
// nothing and the user hears nothing.

import * as Notifications from "expo-notifications";
import { track } from "./analytics";

// The digest fires later on the nights people actually eat later — Friday and
// Saturday, the two nights a table is still full at 10pm. Sunday sits
// with the weekdays: Sunday dinner is an early meal in a way Saturday night is
// not. One table, so moving a night is a one-line change and every consumer —
// the scheduler, the window, and the Home copy — moves with it.
//
// Index is JS getDay(): 0 = Sunday.
export const DIGEST_HOUR_BY_WEEKDAY: readonly number[] = [
  21, // Sun
  21, // Mon
  21, // Tue
  21, // Wed
  21, // Thu
  23, // Fri
  23, // Sat
];
export const DIGEST_MINUTE = 0;

export function digestHourOn(day: Date): number {
  return DIGEST_HOUR_BY_WEEKDAY[day.getDay()];
}

/** The digest moment on the calendar day `day` falls in. */
export function digestMomentOn(day: Date): Date {
  const at = new Date(day);
  at.setHours(digestHourOn(day), DIGEST_MINUTE, 0, 0);
  return at;
}
export const DIGEST_KIND = "passive_digest";

const DIGEST_NOTIF_ID_KEY = "palate.passive.digestNotifId";

/**
 * When tonight's digest should fire, or null if that moment has already passed.
 * A capture at 11pm does not get a digest — it rolls into tomorrow's, which is
 * better than buzzing someone at midnight about dinner.
 */
export function digestTimeFor(now: Date): Date {
  const at = digestMomentOn(now);
  // Past tonight's slot, roll to tomorrow's rather than returning null.
  //
  // Returning null meant a visit detected AFTER 8:30 — a late dinner, the
  // single most likely thing to be captured in an evening — scheduled no
  // notification at all. Nothing re-ran the scheduler the next day either,
  // because rescheduleDigest only fires when a new entry lands in the inbox.
  // So the entry sat there and nobody was ever asked about it.
  //
  // This is the other half of the calendar-day bug: buildDigest now carries a
  // late visit into the next digest, and this makes sure that digest is
  // actually announced.
  if (at.getTime() > now.getTime()) return at;
  // Tomorrow — and tomorrow may be a later night, so take its own hour rather
  // than carrying today's forward.
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return digestMomentOn(tomorrow);
}

/**
 * Schedule (or reschedule) tonight's digest. Cancels the previous one first —
 * every new capture rewrites the copy, and two digests in an evening would
 * spend the notification budget twice for one job.
 */
export async function scheduleDigest(
  entries: InboxEntry[],
  getStoredId: () => Promise<string | null>,
  setStoredId: (id: string | null) => Promise<void>,
  now = new Date(),
): Promise<string | null> {
  const digest = buildDigest(entries, now);
  const when = digestTimeFor(now);

  const previous = await getStoredId();
  if (previous) {
    await Notifications.cancelScheduledNotificationAsync(previous).catch(() => {});
    await setStoredId(null);
  }

  if (!isDigestWorthSending(digest)) return null;

  const body = digestNotificationBody(digest, (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  );

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: digest.total === 1 ? "One place to confirm" : `${digest.high.length + digest.medium.length} places to confirm`,
      body,
      data: { kind: DIGEST_KIND, date: digest.date },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
  });
  await setStoredId(id);
  void track("digest_scheduled", {
    at: when.toISOString(),
    high: digest.high.length,
    medium: digest.medium.length,
    low: digest.low.length,
  });
  return id;
}

export const DIGEST_NOTIF_ID_STORAGE_KEY = DIGEST_NOTIF_ID_KEY;
