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
  const anchor = new Date(now);
  anchor.setHours(DIGEST_HOUR, DIGEST_MINUTE, 0, 0);
  // Before today's digest hour, the live window is still the one that opened
  // at yesterday's.
  if (anchor.getTime() > now.getTime()) anchor.setDate(anchor.getDate() - 1);
  anchor.setDate(anchor.getDate() - 1);
  return anchor;
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
// for tonight at DIGEST_HOUR, with copy reflecting everything captured so far.
// The consequence is the behaviour we want: a day with no captures schedules
// nothing and the user hears nothing.

import * as Notifications from "expo-notifications";
import { track } from "./analytics";

export const DIGEST_HOUR = 20;
export const DIGEST_MINUTE = 30;
export const DIGEST_KIND = "passive_digest";

const DIGEST_NOTIF_ID_KEY = "palate.passive.digestNotifId";

/**
 * When tonight's digest should fire, or null if that moment has already passed.
 * A capture at 11pm does not get a digest — it rolls into tomorrow's, which is
 * better than buzzing someone at midnight about dinner.
 */
export function digestTimeFor(now: Date): Date | null {
  const at = new Date(now);
  at.setHours(DIGEST_HOUR, DIGEST_MINUTE, 0, 0);
  return at.getTime() <= now.getTime() ? null : at;
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

  if (!when || !isDigestWorthSending(digest)) return null;

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
