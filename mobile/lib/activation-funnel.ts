// ============================================================================
// activation-funnel.ts — where the pipeline actually stops.
// ----------------------------------------------------------------------------
// Reconstructing this on 2026-09-02 took four hand-written SQL queries, which
// is why nobody had looked at it in weeks. It is the only way to know whether
// any of the passive-capture work does anything, so it should take five
// seconds and live in the app.
//
//   detected -> qualified -> resolved -> notified -> confirmed
//
// Five stages, not the six the brief sketched: "confirmed" and "logged" are
// the same event. Confirming IS the write — saveVisit runs inside the confirm
// handler — so a separate "logged" row would always equal "confirmed" and
// would imply a failure mode that cannot happen.
//
// The suppression counts matter as much as the stages. A detection that is
// suppressed looks identical to a detection that never happened if you only
// read the stage totals — and on 2026-09-02, `recently_dismissed` was 4 of 7
// suppressions, silently eating prompts because of a bug in confirm-multi that
// recorded a dismissal for every unticked option. The number that would have
// caught that in a glance is the one this makes visible.
//
// buildFunnel is pure over an event list so the stage and suppression logic is
// testable without a database; loadFunnel is the thin read that feeds it.
// ============================================================================

import { supabase } from "./supabase";

export type FunnelEvent = {
  event: string;
  props: Record<string, unknown> | null;
  created_at: string;
};

export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  /** Percentage kept from the stage before it, or null for the first stage. */
  keptPct: number | null;
};

export type SuppressionCount = { reason: string; label: string; count: number };

export type Funnel = {
  stages: FunnelStage[];
  suppressions: SuppressionCount[];
  /** The stage where the largest proportional drop happened, if any. */
  worstDrop: { from: string; to: string; lostPct: number } | null;
};

// Each stage counts the events that mean "reached here". Several stages have
// more than one event name because the pipeline grew a batched path
// (confirm-multi) alongside the single-place one, and both are the same step
// as far as the funnel is concerned.
const STAGES: { key: string; label: string; events: string[] }[] = [
  { key: "detected",  label: "Detected",  events: ["visit_detected"] },
  { key: "qualified", label: "Qualified", events: ["visit_qualified"] },
  { key: "resolved",  label: "Resolved",  events: ["visit_resolved"] },
  { key: "notified",  label: "Notified",  events: ["confirm_notif_sent"] },
  { key: "confirmed", label: "Confirmed", events: ["confirm_yes", "confirm_multi_saved", "inbox_confirmed"] },
];

const SUPPRESSION_LABELS: Record<string, string> = {
  recently_dismissed: "Recently dismissed",
  duplicate_recent:   "Duplicate of a recent one",
  quiet_hours:        "Quiet hours",
  min_gap:            "Too soon after the last",
  rate_limit:         "Daily cap reached",
  no_permission:      "No permission",
};

const SUPPRESSION_EVENTS = ["confirm_notif_suppressed", "visit_suppressed"];

export function buildFunnel(events: FunnelEvent[]): Funnel {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.event, (counts.get(e.event) ?? 0) + 1);

  const stages: FunnelStage[] = STAGES.map((s, i) => {
    const count = s.events.reduce((n, name) => n + (counts.get(name) ?? 0), 0);
    return { key: s.key, label: s.label, count, keptPct: i === 0 ? null : 0 };
  });

  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count;
    // A stage can exceed the one before it — events expire out of the query
    // window at different points in the pipeline, and a confirm can arrive
    // from the inbox days after its detection. Cap at 100 rather than
    // printing "140% kept", which reads as a bug in the funnel.
    stages[i].keptPct = prev === 0 ? null : Math.min(100, Math.round((stages[i].count / prev) * 100));
  }

  const byReason = new Map<string, number>();
  for (const e of events) {
    if (!SUPPRESSION_EVENTS.includes(e.event)) continue;
    const reason = typeof e.props?.reason === "string" ? e.props.reason : "unknown";
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const suppressions: SuppressionCount[] = [...byReason.entries()]
    .map(([reason, count]) => ({
      reason,
      label: SUPPRESSION_LABELS[reason] ?? reason.replace(/_/g, " "),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  // Only meaningful between stages that had something to lose.
  let worstDrop: Funnel["worstDrop"] = null;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1];
    if (prev.count === 0 || stages[i].keptPct === null) continue;
    const lostPct = 100 - (stages[i].keptPct as number);
    if (lostPct > 0 && (worstDrop === null || lostPct > worstDrop.lostPct)) {
      worstDrop = { from: prev.label, to: stages[i].label, lostPct };
    }
  }

  return { stages, suppressions, worstDrop };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * The caller's own pipeline events for the last `days`.
 *
 * Own-rows only: `analytics_events` is RLS'd per user and this is a debug view
 * of your own account, not an admin dashboard.
 */
export async function loadFunnel(days = 30): Promise<Funnel> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return buildFunnel([]);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("analytics_events")
    .select("event, props, created_at")
    .eq("user_id", user.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return buildFunnel([]);

  return buildFunnel((data ?? []) as FunnelEvent[]);
}
