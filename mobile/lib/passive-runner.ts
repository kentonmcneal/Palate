// ============================================================================
// passive-runner.ts — glue: drain raw visits → qualify → resolve → confirm.
// ----------------------------------------------------------------------------
// Called on app foreground (and after an on-wake native visit event). Each raw
// visit runs the full pipeline exactly once; processed ids are remembered so a
// visit is never double-prompted. Every stage is gated by its own remote flag
// so any phase can be killed independently.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import { drainNativeVisits, PASSIVE_CAPTURE_FLAG, type RawVisit } from "./passive-capture";
import { qualifyVisit, resolveVenue, recordForClustering } from "./passive-pipeline";
import { notifyOrInbox } from "./passive-confirm";
import { isFlagEnabled } from "./flags";
import { track } from "./analytics";
import { logDetectorNote } from "../modules/palate-visit-monitor";

const PROCESSED_KEY = "palate.passive.processedIds";
const RETRY_KEY = "palate.passive.retryQueue";

// A raw visit that fails the pipeline is retried on the next foreground, but
// not forever: three attempts, then it is given up on and reported. Unbounded
// retries would mean a permanently unresolvable venue re-running the pipeline
// on every launch for the life of the install.
export const MAX_PIPELINE_ATTEMPTS = 3;
// Failures should never accumulate faster than they drain.
const MAX_RETRY_QUEUE = 50;

type RetryItem = { raw: RawVisit; attempts: number; firstFailedAt: number };
export const RESOLVE_FLAG = "passive_capture_resolve";
export const CONFIRM_FLAG = "passive_capture_confirm";

export type VisitOutcome = {
  id: string;
  stage: "suppressed" | "unqualified" | "resolved" | "notified" | "inboxed";
  detail: string;
};

export type RunSummary = {
  ran: boolean;
  detected: number;
  /** Raw visits re-attempted from a previous failed run. */
  retried: number;
  /** Raw visits given up on after MAX_PIPELINE_ATTEMPTS. */
  dropped: number;
  outcomes: VisitOutcome[];
};

async function loadProcessed(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(PROCESSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function markProcessed(ids: Set<string>): Promise<void> {
  // Cap to the most recent 1000 ids so this never grows unbounded.
  const arr = Array.from(ids).slice(-1000);
  await AsyncStorage.setItem(PROCESSED_KEY, JSON.stringify(arr));
}

async function loadRetries(): Promise<RetryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(RETRY_KEY);
    return raw ? (JSON.parse(raw) as RetryItem[]) : [];
  } catch {
    return [];
  }
}

async function saveRetries(items: RetryItem[]): Promise<void> {
  await AsyncStorage.setItem(RETRY_KEY, JSON.stringify(items.slice(-MAX_RETRY_QUEUE)));
}

/** Run the full pipeline for a single raw visit. Exposed for the debug screen. */
export async function runPipelineForRaw(raw: RawVisit): Promise<VisitOutcome> {
  void track("visit_detected", {
    simulated: raw.simulated,
    source: raw.source ?? "visit",
    accuracy_m: Math.round(raw.horizontalAccuracy),
  });
  // Feed clustering AFTER using it for suppression, so a place needs history to
  // be suppressed (its own first visit never suppresses itself).
  const q = await qualifyVisit(raw);
  await recordForClustering(raw);

  if (!q.ok) {
    if (q.reason === "home-work-suppressed") {
      void track("visit_suppressed", { reason: q.reason });
      logDetectorNote("miss", "home/work suppressed");
      return { id: raw.id, stage: "suppressed", detail: q.reason };
    }
    void track("visit_unqualified", {
      reason: q.reason,
      source: raw.source ?? "visit",
      accuracy_m: Math.round(raw.horizontalAccuracy),
    });
    logDetectorNote("miss", `unqualified: ${q.reason}`);
    return { id: raw.id, stage: "unqualified", detail: q.reason };
  }
  void track("visit_qualified", {
    dwell_min: Math.round(q.dwellMin),
    source: raw.source ?? "visit",
    accuracy_m: Math.round(raw.horizontalAccuracy),
  });

  if (!(await isFlagEnabled(RESOLVE_FLAG))) {
    logDetectorNote("miss", "resolve kill switch off");
    return { id: raw.id, stage: "resolved", detail: "resolve-flag-off" };
  }
  const resolved = await resolveVenue(raw);
  if (!resolved) {
    // The single most important miss to surface: the stop was real and
    // qualified, and we simply could not name anywhere you might have eaten.
    void track("visit_unresolved", {
      reason: "no-venue-found",
      source: raw.source ?? "visit",
      accuracy_m: Math.round(raw.horizontalAccuracy),
    });
    logDetectorNote("miss", "no food venue in range");
    return { id: raw.id, stage: "unqualified", detail: "no-venue-found" };
  }

  if (!(await isFlagEnabled(CONFIRM_FLAG))) {
    logDetectorNote("miss", "confirm kill switch off");
    return { id: raw.id, stage: "resolved", detail: `${resolved.candidates[0].name} (+${resolved.candidates.length - 1})` };
  }
  const result = await notifyOrInbox(resolved, q.dwellMin);
  if (result === "notified") {
    logDetectorNote("prompted", resolved.candidates[0].name);
  } else if (result === "inboxed-digest") {
    // Captured and queued for tonight's digest — the intended path, not a miss.
    logDetectorNote("queued_for_digest", resolved.candidates[0].name);
  } else {
    // Not a failure, but from the user's seat it looks identical to one: no
    // notification appeared.
    void track("visit_unresolved", { reason: result, source: raw.source ?? "visit" });
    logDetectorNote("miss", `${result}: ${resolved.candidates[0].name}`);
  }
  return {
    id: raw.id,
    stage: result === "notified" ? "notified" : result === "suppressed-recent" ? "suppressed" : "inboxed",
    detail: `${resolved.candidates[0].name} — ${result}`,
  };
}

// In-flight guard: the foreground effect can fire twice in quick succession
// (mount + AppState "active", or a token refresh re-running the effect). Without
// this, two overlapping runs read the same processedIds and double-notify.
let running = false;

/** Drain + process everything unprocessed. Safe to call on every foreground. */
export async function processPendingVisits(): Promise<RunSummary> {
  if (running) return { ran: false, detected: 0, retried: 0, dropped: 0, outcomes: [] };
  if (!(await isFlagEnabled(PASSIVE_CAPTURE_FLAG))) {
    return { ran: false, detected: 0, retried: 0, dropped: 0, outcomes: [] };
  }
  running = true;
  try {
    return await runProcess();
  } finally {
    running = false;
  }
}

async function runProcess(): Promise<RunSummary> {
  // `drainNativeVisits` EMPTIES the native queue, so anything taken here exists
  // nowhere else. Marking an id processed after a failure — which is what this
  // did — destroyed the visit permanently: the native copy was already gone and
  // the id would never be picked up again. A transient network blip while
  // resolving the venue was enough to lose a real meal, silently.
  const drained = await drainNativeVisits();
  const processed = await loadProcessed();
  const retries = await loadRetries();
  const retryIds = new Set(retries.map((r) => r.raw.id));

  const fresh = drained.filter((v) => !processed.has(v.id) && !retryIds.has(v.id));

  // Retries first: an old failure must not starve behind a stream of new
  // detections once the queue is at its cap.
  const work: RetryItem[] = [
    ...retries,
    ...fresh.map((raw) => ({ raw, attempts: 0, firstFailedAt: 0 })),
  ];

  const outcomes: VisitOutcome[] = [];
  const stillFailing: RetryItem[] = [];
  let dropped = 0;

  for (const item of work) {
    try {
      outcomes.push(await runPipelineForRaw(item.raw));
      // Processed means SUCCEEDED. Nothing else may set it.
      processed.add(item.raw.id);
    } catch (e: any) {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_PIPELINE_ATTEMPTS) {
        // Give up — but loudly. A visit disappearing is a real product failure
        // and it should show up in analytics rather than in nobody's history.
        processed.add(item.raw.id);
        dropped++;
        void track("visit_dropped", {
          attempts,
          reason: String(e?.message ?? e).slice(0, 120),
        });
      } else {
        stillFailing.push({
          raw: item.raw,
          attempts,
          firstFailedAt: item.firstFailedAt || Date.now(),
        });
      }
    }
  }

  await saveRetries(stillFailing);
  await markProcessed(processed);
  return {
    ran: true,
    detected: fresh.length,
    retried: retries.length,
    dropped,
    outcomes,
  };
}
