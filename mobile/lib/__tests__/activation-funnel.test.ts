import { buildFunnel, type FunnelEvent } from "../activation-funnel";

const ev = (event: string, props: Record<string, unknown> | null = null): FunnelEvent => ({
  event,
  props,
  created_at: "2026-09-02T18:00:00Z",
});

const many = (event: string, n: number, props: Record<string, unknown> | null = null) =>
  Array.from({ length: n }, () => ev(event, props));

describe("buildFunnel", () => {
  it("reads the five stages in order", () => {
    const f = buildFunnel([
      ...many("visit_detected", 10),
      ...many("visit_qualified", 6),
      ...many("visit_resolved", 5),
      ...many("confirm_notif_sent", 2),
      ...many("confirm_yes", 1),
    ]);
    expect(f.stages.map((s) => [s.key, s.count])).toEqual([
      ["detected", 10], ["qualified", 6], ["resolved", 5], ["notified", 2], ["confirmed", 1],
    ]);
    expect(f.stages[1].keptPct).toBe(60);
    expect(f.stages[3].keptPct).toBe(40);
  });

  it("counts the batched confirm path as the same step as the single one", () => {
    // confirm-multi and the inbox are alternate routes to the same outcome.
    // Counting only confirm_yes would under-report every confirmation that
    // came through the multi-place prompt.
    const f = buildFunnel([
      ...many("confirm_notif_sent", 4),
      ev("confirm_yes"), ev("confirm_multi_saved"), ev("inbox_confirmed"),
    ]);
    expect(f.stages.find((s) => s.key === "confirmed")?.count).toBe(3);
  });

  it("breaks suppressions down by reason, worst first", () => {
    // This is the number that would have caught the confirm-multi bug: four
    // dismissals recorded from one prompt, silently eating later detections.
    const f = buildFunnel([
      ...many("confirm_notif_suppressed", 4, { reason: "recently_dismissed" }),
      ...many("confirm_notif_suppressed", 2, { reason: "min_gap" }),
      ev("confirm_notif_suppressed", { reason: "rate_limit" }),
    ]);
    expect(f.suppressions).toEqual([
      { reason: "recently_dismissed", label: "Recently dismissed", count: 4 },
      { reason: "min_gap", label: "Too soon after the last", count: 2 },
      { reason: "rate_limit", label: "Daily cap reached", count: 1 },
    ]);
  });

  it("does not drop a suppression whose reason it has no label for", () => {
    // A new reason added to the pipeline must still show up here, or the
    // funnel silently under-reports exactly when the pipeline changed.
    const f = buildFunnel([ev("confirm_notif_suppressed", { reason: "some_new_gate" })]);
    expect(f.suppressions).toEqual([
      { reason: "some_new_gate", label: "some new gate", count: 1 },
    ]);
  });

  it("files a suppression with no reason rather than discarding it", () => {
    const f = buildFunnel([ev("confirm_notif_suppressed", {}), ev("visit_suppressed", null)]);
    expect(f.suppressions).toEqual([{ reason: "unknown", label: "unknown", count: 2 }]);
  });

  it("names the worst drop", () => {
    const f = buildFunnel([
      ...many("visit_detected", 10),
      ...many("visit_qualified", 9),
      ...many("visit_resolved", 2),
      ...many("confirm_notif_sent", 2),
      ...many("confirm_yes", 2),
    ]);
    expect(f.worstDrop).toEqual({ from: "Qualified", to: "Resolved", lostPct: 78 });
  });

  it("caps a stage that exceeds the one before it instead of printing 140%", () => {
    // Events expire out of the window at different points, and an inbox
    // confirm can land days after its detection. That is a real state, not a
    // bug, and it should not look like one.
    const f = buildFunnel([
      ...many("confirm_notif_sent", 2),
      ...many("confirm_yes", 5),
    ]);
    expect(f.stages.find((s) => s.key === "confirmed")?.keptPct).toBe(100);
  });

  it("survives an account with no events at all", () => {
    const f = buildFunnel([]);
    expect(f.stages.every((s) => s.count === 0)).toBe(true);
    expect(f.stages[0].keptPct).toBeNull();
    expect(f.stages[1].keptPct).toBeNull();
    expect(f.suppressions).toEqual([]);
    expect(f.worstDrop).toBeNull();
  });

  it("ignores events that are not part of the pipeline", () => {
    const f = buildFunnel([...many("next_step_tapped", 20), ev("visit_detected")]);
    expect(f.stages[0].count).toBe(1);
  });
});
