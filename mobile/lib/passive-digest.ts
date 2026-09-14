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
//
// WHEN it fires is personal. The weekday table below is the default for an
// account we do not know yet; once a person has ten confirmed visits the
// digest fires an hour after THIS person is usually done eating (see
// lib/eating-pattern). Someone who always eats at six is asked at eight, not
// left waiting until nine; someone who eats at ten is asked at eleven, not
// interrupted mid-meal. Every function that reads the hour takes the pattern
// as an optional last argument so the notification, its window, and the Home
// copy all move together.
// ============================================================================

import type { InboxEntry } from "./passive-confirm";
import type { ConfidenceBand } from "./passive-confidence";
import { confidenceBand, HIGH_BAND_MIN } from "./passive-confidence";
import { loadEatingPattern, type EatingPattern } from "./eating-pattern";

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
  /** Stops in the window this digest chose not to ask about, because the list
   *  would have been too long to answer. They stay in the inbox. */
  heldBack?: number;
};

/**
 * The notification category carrying the Yes/No buttons.
 *
 * This and confirmParamsFor live HERE rather than in passive-confirm, which is
 * where they read more naturally, because passive-confirm already imports from
 * this module. Importing back created a cycle: the dynamically-imported
 * passive-digest saw CONFIRM_CATEGORY as undefined, scheduleDigest threw, and
 * the caller's try/catch swallowed it — so the nightly digest silently stopped
 * being scheduled at all. Dependencies point one way.
 */
export const CONFIRM_CATEGORY = "passive_confirm";

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

/** More than one plausible venue in range makes yes/no the wrong question. */
export const AMBIGUOUS_CANDIDATE_COUNT = 2;

/**
 * Band an entry. An entry with NO confidence at all lands in Low.
 *
 * It used to land in Medium, reasoning that promoting unscored history to High
 * would pre-check guesses. Right instinct, wrong floor: it put entries we know
 * NOTHING about in the same bucket as entries we scored and found middling,
 * and the measured result is that Medium performs WORSE than Low.
 *
 * From live prompt outcomes:
 *
 *   high    20 confirmed /  2 refused   91%
 *   medium  24 confirmed / 43 refused   36%
 *   low     14 confirmed / 17 refused   45%
 *   unbanded 2 confirmed / 30 refused    6%
 *
 * Low outranking Medium is not noise, it is this line. A scored-weak entry has
 * evidence behind it; an unscored one has none, and the unbanded column is what
 * those are actually worth. Mixing them dragged Medium below the band beneath
 * it and made the whole ladder unreadable — you cannot calibrate a threshold
 * when one bucket is two populations.
 *
 * Low is the honest floor: still shown, never pre-checked, asked last, and the
 * first thing dropped when the digest's budget runs out. That is the correct
 * treatment for a detection we cannot vouch for.
 */
export function bandFor(entry: InboxEntry): ConfidenceBand {
  if (entry.confidenceBand) return entry.confidenceBand as ConfidenceBand;
  if (typeof entry.confidence === "number") return confidenceBand(entry.confidence);
  return "low";
}

function toDigestEntry(entry: InboxEntry): DigestEntry {
  const band = bandFor(entry);
  return {
    ...entry,
    band,
    // High AND medium arrive ticked. The notification that brought you here
    // counts both — "2 places to confirm" is high + medium — so pre-checking
    // only high meant tapping a notification about two places and landing on a
    // button that said "Confirm 1". The screen now agrees with the thing that
    // opened it.
    //
    // Low stays unticked, and that is not symmetry for its own sake: the low
    // band is where ambiguous stops live, and an ambiguous entry needs you to
    // pick WHICH place before it can be confirmed at all. Pre-ticking a guess
    // is the one thing this screen must not do.
    // HIGH ONLY.
    //
    // This pre-ticked Medium too, and Medium is both the largest band (108 of
    // 262) and, measured on live outcomes, right 36% of the time. Since
    // REALTIME_PROMPTS_ENABLED is false the digest is the ONLY confirmation
    // path in production, and one tap on Confirm writes every ticked row into
    // the diary, the taste graph, Wrapped and the public profile.
    //
    // So the default answer to "were you at this restaurant?" was yes, for a
    // guess that is wrong two times in three, on the one screen where saying
    // yes is irreversible. A pre-tick is a claim; Medium has not earned one.
    // High runs at 91% and has.
    //
    // Sections below High are upside, not obligation: they are still shown,
    // still one tap to accept, just not answered on the person's behalf.
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
export function digestWindowStart(now: Date, pattern?: EatingPattern | null): Date {
  // The most recent digest moment at or before `now` — today's if it has
  // passed, otherwise yesterday's.
  let anchorDay = new Date(now);
  if (digestMomentOn(anchorDay, pattern).getTime() > now.getTime()) {
    anchorDay.setDate(anchorDay.getDate() - 1);
  }
  // The window opens at the digest BEFORE that one, so it always spans a full
  // cycle. Computed from the previous day rather than by subtracting 24 hours,
  // because the hour differs by weekday: the window that closes Saturday at
  // 11pm opened Friday at 9pm, and that is 26 hours, not 24.
  const prevDay = new Date(anchorDay);
  prevDay.setDate(prevDay.getDate() - 1);
  return digestMomentOn(prevDay, pattern);
}

/** Entries detected within the current digest window. */
export function entriesForDigest(
  entries: InboxEntry[],
  now: Date,
  pattern?: EatingPattern | null,
): InboxEntry[] {
  const start = digestWindowStart(now, pattern).getTime();
  const end = now.getTime();
  return entries.filter((e) => e.detectedAt > start && e.detectedAt <= end);
}

/**
 * `windowed` is the difference between the notification and the screen.
 *
 * The notification is about tonight, so it is windowed — that is what keeps
 * the list stable while somebody works through it. The SCREEN must not be:
 * getInbox keeps entries for 48 hours and the digest window spans about 26, so
 * an entry aged thirty hours was counted by Home ("1 visit is waiting for
 * you") and by the Visits banner, and then did not appear on the digest you
 * opened to clear it. There was no way to answer it; it just asked until it
 * silently expired. That is the founder's "I hit Visits and it's asking for
 * the same info".
 */
/**
 * How many stops one digest may ask about.
 *
 * There was no limit. On an ordinary day that is fine, because there are two
 * or three. On a travel day the founder's phone produced 141 detections and
 * the digest listed every resolved one of them — which is what "on my way to
 * the airport I got hit with like 10 restaurants" actually was. Not ten
 * notifications: one notification opening onto a list nobody can answer.
 *
 * A person will answer a handful of questions about their own day and will
 * abandon a form. Six is roughly the most anyone will work through, and the
 * ones that do not fit are not lost — they stay in the inbox and the next
 * digest can ask, by which time they are usually stale enough not to matter.
 *
 * Confidence decides who makes the cut, not time, because the alternative is
 * asking about the first six stops of the morning and never about dinner.
 */
export const MAX_DIGEST_ASKS = 6;

/** Keep the most answerable entries, newest first within a band. High before
 *  medium before low: a guess somebody can confirm at a glance beats an
 *  ambiguous one they have to think about, and thinking is what makes a list
 *  get abandoned. */
function capAsks(
  high: DigestEntry[], medium: DigestEntry[], low: DigestEntry[],
): { high: DigestEntry[]; medium: DigestEntry[]; low: DigestEntry[]; dropped: number } {
  let budget = MAX_DIGEST_ASKS;
  const take = <T>(xs: T[]): T[] => {
    const kept = xs.slice(0, Math.max(0, budget));
    budget -= kept.length;
    return kept;
  };
  const keptHigh = take(high);
  const keptMedium = take(medium);
  const keptLow = take(low);
  const dropped =
    (high.length - keptHigh.length) +
    (medium.length - keptMedium.length) +
    (low.length - keptLow.length);
  return { high: keptHigh, medium: keptMedium, low: keptLow, dropped };
}

export function buildDigest(
  entries: InboxEntry[],
  now = new Date(),
  opts: { windowed?: boolean; pattern?: EatingPattern | null } = {},
): Digest {
  const windowed = opts.windowed ?? true;
  const source = windowed ? entriesForDigest(entries, now, opts.pattern) : entries;
  const pending = source.map(toDigestEntry);
  const capped = capAsks(
    pending.filter((e) => e.band === "high").sort(byTime),
    pending.filter((e) => e.band === "medium").sort(byTime),
    pending.filter((e) => e.band === "low").sort(byTime),
  );
  return {
    date: now.toISOString().slice(0, 10),
    high: capped.high,
    medium: capped.medium,
    low: capped.low,
    // `total` counts what was ASKED, not what was detected, because every
    // caller uses it to decide whether there is anything to show. The stops
    // that did not fit are still in the inbox.
    total: capped.high.length + capped.medium.length + capped.low.length,
    /** How many stops the window held that this digest did not ask about. */
    heldBack: capped.dropped,
  };
}

/** Nothing at all in the window — do not send a notification.
 *
 *  This used to require a high- or medium-band entry, which meant a day made
 *  entirely of low-confidence stops said NOTHING. The founder's report was
 *  exactly that: "I am not getting sent notifications to log food." A low-only
 *  day is the case where the app most needs a human, because low band is where
 *  the ambiguous stops are — it just has to ask a softer question. */
export function isDigestWorthSending(digest: Digest): boolean {
  return digest.total > 0;
}

/** True when the digest has nothing it is confident about — the question
 *  becomes "were you out?" rather than "confirm these". */
export function isLowOnlyDigest(digest: Digest): boolean {
  return digest.high.length + digest.medium.length === 0 && digest.low.length > 0;
}

/**
 * Notification copy.
 *
 * It used to read "2 places to confirm" / "Chipotle, Ruby's. Tap to confirm."
 * — accurate, and it sounds like a task queue. The founder's note: it should
 * read "Looks like you ate at 2 places today, can you confirm this?" That is
 * the same information asked as a question, and a question is answerable.
 *
 * The place and the time still lead the body, because they are the recall
 * scaffold — you remember the day by what you did, not by a count.
 */
export function digestNotificationTitle(digest: Digest): string {
  // The confident count is HIGH ONLY, and it has to match what the screen
  // pre-ticks.
  //
  // This counted high + medium, and the digest pre-ticked the same set, so the
  // two agreed — by both being wrong. "Looks like you ate at 2 places today"
  // is a CLAIM, and Medium is right 36% of the time. Now that only High is
  // pre-ticked, counting Medium here would put "2 places" on the notification
  // and "Confirm 1" on the button, which is the mismatch the old behaviour was
  // introduced to avoid. Fixing the count is the correct half to change: the
  // tick and the claim should both be as confident as the evidence, not as
  // confident as each other.
  //
  // A digest with nothing in High still fires — those entries are worth
  // asking about — but it asks rather than asserts.
  if (digest.high.length === 0) return "Were you out today?";
  if (digest.high.length === 1) {
    return `Did you eat at ${digest.high[0].name}?`;
  }
  return `Looks like you ate at ${digest.high.length} places today`;
}

export function digestNotificationBody(digest: Digest, formatTime: (ms: number) => string): string {
  if (isLowOnlyDigest(digest)) {
    const near = digest.low[0];
    return near
      ? `We think you were near ${near.name}. Tap to say where you actually ate.`
      : "Tap to log anything you ate out.";
  }
  const shown = [...digest.high, ...digest.medium];
  if (!shown.length) return "";
  if (shown.length === 1) {
    return `${formatTime(shown[0].detectedAt)} today. Answer here, no need to open the app.`;
  }
  const names = shown.slice(0, 2).map((e) => e.name).join(" and ");
  const rest = shown.length - 2;
  return rest > 0
    ? `${names} and ${rest} more. Can you confirm?`
    : `${names}. Can you confirm?`;
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
import { cancelScheduledOfKind } from "./notification-dedupe";
import { track } from "./analytics";

// WHEN THE DIGEST FIRES. Fixed, by weekday, and no longer negotiable.
//
// 9pm every night except Friday and Saturday, which fire at midnight — the two
// nights a table is still full at eleven. Sunday sits with the weekdays:
// Sunday dinner is an early meal in a way Saturday night is not.
//
// 24, not 0, for the weekend nights. Date.setHours(24) rolls to 00:00 the NEXT
// morning, which is what "Friday at midnight" means to a person: the end of
// Friday, not the start of it. Writing 0 here would fire the Friday digest
// twenty-four hours early, covering Thursday.
//
// THE PERSONAL HOUR IS GONE. digestHourOn used to ask personalDigestHour
// first, which shifted the fire time to an hour after that individual's usual
// last meal. It is why a Sunday digest was scheduled for 11pm and the founder
// was still waiting at nine — the schedule was personalised past the point of
// being predictable, and a notification you cannot anticipate is one you stop
// trusting. A fixed time is a promise the app can keep.
//
// Index is JS getDay(): 0 = Sunday.
export const DIGEST_HOUR_BY_WEEKDAY: readonly number[] = [
  21, // Sun
  21, // Mon
  21, // Tue
  21, // Wed
  21, // Thu
  24, // Fri -> Saturday 00:00
  24, // Sat -> Sunday 00:00
];
export const DIGEST_MINUTE = 0;

/**
 * The hour the digest fires on `day`: this person's own hour when we know
 * them, the weekday default when we do not. Callers without a pattern to hand
 * (or with null, meaning "none stored") get the default, so nothing that
 * compiled before this parameter existed changes behaviour.
 */
export function digestHourOn(day: Date, _pattern?: EatingPattern | null): number {
  // The pattern argument is kept so every existing caller still compiles, and
  // ignored: see the table above. A predictable hour beats a personalised one.
  return DIGEST_HOUR_BY_WEEKDAY[day.getDay()];
}

/** The digest moment on the calendar day `day` falls in. */
export function digestMomentOn(day: Date, pattern?: EatingPattern | null): Date {
  const at = new Date(day);
  at.setHours(digestHourOn(day, pattern), DIGEST_MINUTE, 0, 0);
  return at;
}
export const DIGEST_KIND = "passive_digest";

const DIGEST_NOTIF_ID_KEY = "palate.passive.digestNotifId";

/**
 * When tonight's digest should fire, or null if that moment has already passed.
 * A capture at 11pm does not get a digest — it rolls into tomorrow's, which is
 * better than buzzing someone at midnight about dinner.
 */
export function digestTimeFor(
  now: Date,
  pattern?: EatingPattern | null,
  digest?: Digest,
): Date {
  // Nothing worth confirming tonight: carry it to tomorrow's slot.
  //
  // A low-only digest is a day of ambiguous stops — places we could not name
  // with any confidence. Asking "were you out today?" at 9pm and being wrong
  // is how a person learns to ignore the one notification the whole product
  // depends on. Given another day those same entries are usually joined by
  // something we CAN name, and then they get asked alongside it.
  //
  // Deferred by MOVING the notification, never by declining to schedule one.
  // Scheduling nothing is how entries used to sit in the inbox forever:
  // rescheduleDigest only runs when a new capture lands, so a quiet tomorrow
  // meant nobody was ever asked at all.
  if (digest && isLowOnlyDigest(digest)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const slot = digestMomentOn(tomorrow, pattern);
    if (slot.getTime() > now.getTime()) return slot;
  }
  const at = digestMomentOn(now, pattern);
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
  return digestMomentOn(tomorrow, pattern);
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
  // Read once and threaded through both the window and the fire time, so the
  // set of visits the notification describes is the set that fell between
  // this person's last digest and this one. AsyncStorage only: this is
  // called from the passive pipeline, which may be running in the background.
  const pattern = await loadEatingPattern();
  const digest = buildDigest(entries, now, { pattern });
  const when = digestTimeFor(now, pattern, digest);

  const previous = await getStoredId();
  if (previous) {
    await Notifications.cancelScheduledNotificationAsync(previous).catch(() => {});
    await setStoredId(null);
  }
  // And anything the stored id does not know about. Two captures landing at
  // once used to leave one digest orphaned; the person got it twice.
  await cancelScheduledOfKind(Notifications, "kind", DIGEST_KIND);

  if (!isDigestWorthSending(digest)) return null;

  const body = digestNotificationBody(digest, (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  );

  // One confident place is a yes/no question, so it gets the Yes/No buttons
  // the realtime prompt already registers — that is the "verify without
  // opening the app" the founder asked for, and it costs nothing extra
  // because the category is already registered at launch. Two or more places
  // is not a yes/no question, so those still open the digest.
  const confident = [...digest.high, ...digest.medium];
  const single = confident.length === 1 ? confident[0] : null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: digestNotificationTitle(digest),
      body,
      ...(single ? { categoryIdentifier: CONFIRM_CATEGORY } : {}),
      data: single
        ? { kind: DIGEST_KIND, date: digest.date, ...confirmParamsFor(single) }
        : { kind: DIGEST_KIND, date: digest.date },
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
