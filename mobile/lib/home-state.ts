// ============================================================================
// home-state.ts — what Home is about, right now.
// ----------------------------------------------------------------------------
// Home was a stack: a "right now" hero, a recommendation rail, a stretch pick,
// a saves rail, a recent list. Five blocks of equal weight, so the screen never
// said which one mattered, and the answer changes completely depending on the
// hour and the state of the account. At 9pm with two unreviewed visits, nothing
// else on that screen is worth looking at.
//
// This picks ONE, and everything visible above the fold follows from it. It
// delegates to nextStep() for cold accounts rather than restating that ladder —
// activation is a solved, tested problem and this is not the place to fork it.
//
// Pure, because it decides what most people's entire impression of the app is.
// ============================================================================

import { nextStep, type ActivationState, type NextStep } from "./next-step";
import { digestMomentOn, digestHourOn, DIGEST_MINUTE } from "./passive-digest";

export type HomeState =
  /** Detected visits are waiting. Nothing else on Home competes with this. */
  | { kind: "review"; count: number; names: string[]; headline: string; body: string; cta: string; route: string }
  /** The account cannot do anything useful yet; say the one thing that fixes it. */
  | { kind: "activation"; step: NextStep; headline: string; body: string; cta: string; route: string }
  /** Tracking is on and today's digest has not fired. Reassurance, no action. */
  | { kind: "waiting"; headline: string; body: string }
  /** Nothing to confirm and nothing broken. Get out of the way. */
  | { kind: "steady"; headline: string; body: string };

export type HomeInputs = {
  /** Detected visits awaiting confirmation. */
  pending: Array<{ name: string }>;
  activation: ActivationState;
  /** Whether passive capture is actually running (opted in AND permitted). */
  trackingOn: boolean;
};

/** Tonight's digest time, in words. Reads the schedule so the copy on Home can
 *  never drift from when the notification actually fires. */
function digestTimeLabel(now: Date): string {
  const hour = digestHourOn(now);
  const minute: number = DIGEST_MINUTE;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour >= 12 ? "pm" : "am";
  return minute === 0
    ? `${h}${suffix}`
    : `${h}:${String(minute).padStart(2, "0")}${suffix}`;
}

/** "Thursday morning", "Thursday, late" — the eyebrow above the headline. */
export function whenLabel(now: Date): string {
  const day = now.toLocaleDateString(undefined, { weekday: "long" });
  const h = now.getHours();
  if (h < 11) return `${day} morning`;
  if (h < 15) return `${day} afternoon`;
  if (h < 22) return `${day} evening`;
  return `${day}, late`;
}

/** Join names the way a person would say them. */
function listNames(names: string[]): string {
  const shown = names.slice(0, 2);
  const rest = names.length - shown.length;
  if (shown.length === 0) return "";
  if (shown.length === 1) return rest > 0 ? `${shown[0]} and ${rest} more` : shown[0];
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : `${shown[0]} and ${shown[1]}`;
}

export function homeState(input: HomeInputs, now = new Date()): HomeState {
  const { pending, activation, trackingOn } = input;

  // 1. Confirmations first. Everything else on the app is downstream of a
  //    confirmed visit, and this is the only thing here the user can finish.
  if (pending.length > 0) {
    const names = pending.map((p) => p.name).filter(Boolean);
    return {
      kind: "review",
      count: pending.length,
      names,
      headline: pending.length === 1
        ? "One visit is ready\nto review."
        : `${pending.length} visits are\nready to review.`,
      body: names.length ? listNames(names) + "." : "Tap to confirm where you ate.",
      cta: pending.length === 1 ? "Review it" : "Review them",
      route: "/digest",
    };
  }

  // 2. A cold account. nextStep owns this ladder and is tested against the
  //    real activation funnel; do not second-guess its order here.
  const step = nextStep(activation);
  if (step && step.key !== "none") {
    return {
      kind: "activation",
      step,
      headline: step.title,
      body: step.body,
      cta: step.cta,
      route: step.route,
    };
  }

  // 3. Tracking is on and tonight's digest has not fired yet. Say so plainly
  //    and ask for nothing — a screen with no task should not invent one.
  const digestFired = now.getTime() >= digestMomentOn(now).getTime();

  if (trackingOn && !digestFired) {
    return {
      kind: "waiting",
      headline: "Nothing to confirm\nyet.",
      body: `Tonight's visits will be ready at ${digestTimeLabel(now)}.`,
    };
  }

  return {
    kind: "steady",
    headline: trackingOn ? "You're all caught up." : "Nothing to confirm.",
    body: trackingOn
      ? "Anywhere you eat from here gets picked up on its own."
      : "Turn tracking on and your visits collect themselves.",
  };
}
