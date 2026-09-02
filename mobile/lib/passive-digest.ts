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

/** Entries detected on the same local calendar day as `now`. */
export function entriesForDay(entries: InboxEntry[], now: Date): InboxEntry[] {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  return entries.filter((e) => {
    const t = new Date(e.detectedAt);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  });
}

export function buildDigest(entries: InboxEntry[], now = new Date()): Digest {
  const today = entriesForDay(entries, now).map(toDigestEntry);
  return {
    date: now.toISOString().slice(0, 10),
    high: today.filter((e) => e.band === "high").sort(byTime),
    medium: today.filter((e) => e.band === "medium").sort(byTime),
    low: today.filter((e) => e.band === "low").sort(byTime),
    total: today.length,
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
