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

const PROCESSED_KEY = "palate.passive.processedIds";
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

/** Run the full pipeline for a single raw visit. Exposed for the debug screen. */
export async function runPipelineForRaw(raw: RawVisit): Promise<VisitOutcome> {
  void track("visit_detected", { simulated: raw.simulated });
  // Feed clustering AFTER using it for suppression, so a place needs history to
  // be suppressed (its own first visit never suppresses itself).
  const q = await qualifyVisit(raw);
  await recordForClustering(raw);

  if (!q.ok) {
    if (q.reason === "home-work-suppressed") {
      void track("visit_suppressed", { reason: q.reason });
      return { id: raw.id, stage: "suppressed", detail: q.reason };
    }
    return { id: raw.id, stage: "unqualified", detail: q.reason };
  }
  void track("visit_qualified", { dwell_min: Math.round(q.dwellMin) });

  if (!(await isFlagEnabled(RESOLVE_FLAG))) {
    return { id: raw.id, stage: "resolved", detail: "resolve-flag-off" };
  }
  const resolved = await resolveVenue(raw);
  if (!resolved) return { id: raw.id, stage: "unqualified", detail: "no-venue-found" };

  if (!(await isFlagEnabled(CONFIRM_FLAG))) {
    return { id: raw.id, stage: "resolved", detail: `${resolved.candidates[0].name} (+${resolved.candidates.length - 1})` };
  }
  const result = await notifyOrInbox(resolved, q.dwellMin);
  return {
    id: raw.id,
    stage: result === "notified" ? "notified" : "inboxed",
    detail: `${resolved.candidates[0].name} — ${result}`,
  };
}

// In-flight guard: the foreground effect can fire twice in quick succession
// (mount + AppState "active", or a token refresh re-running the effect). Without
// this, two overlapping runs read the same processedIds and double-notify.
let running = false;

/** Drain + process everything unprocessed. Safe to call on every foreground. */
export async function processPendingVisits(): Promise<RunSummary> {
  if (running) return { ran: false, detected: 0, outcomes: [] };
  if (!(await isFlagEnabled(PASSIVE_CAPTURE_FLAG))) {
    return { ran: false, detected: 0, outcomes: [] };
  }
  running = true;
  try {
    return await runProcess();
  } finally {
    running = false;
  }
}

async function runProcess(): Promise<RunSummary> {
  const queue = await drainNativeVisits();
  const processed = await loadProcessed();
  const fresh = queue.filter((v) => !processed.has(v.id));

  const outcomes: VisitOutcome[] = [];
  for (const raw of fresh) {
    try {
      outcomes.push(await runPipelineForRaw(raw));
    } catch {
      // one bad visit must never break the batch
    }
    processed.add(raw.id);
  }
  await markProcessed(processed);
  return { ran: true, detected: fresh.length, outcomes };
}
