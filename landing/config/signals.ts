// ============================================================================
// signals.ts — the 12 behavioral signals our taxonomy speaks in.
// ----------------------------------------------------------------------------
// Each signal is a vector that quiz answers and persona definitions both
// reference. Keeping them in one place means renaming "no_friction" doesn't
// require a hunt through three files.
// ============================================================================

export type Signal =
  | "routine"
  | "novelty"
  | "convenience"
  | "indulgence"
  | "healthy_ish"
  | "premium"
  | "value"
  | "social"
  | "late_night"
  | "flavor_driven"
  | "no_friction"
  | "intentional"
  | "comfort_food";

export type SignalDefinition = {
  key: Signal;
  label: string;          // human label for chips
  /** Single-line description used internally / for tooltips. */
  short: string;
};

export const SIGNALS: Record<Signal, SignalDefinition> = {
  routine:        { key: "routine",        label: "Routine eater",        short: "Same places, on a rhythm." },
  novelty:        { key: "novelty",        label: "Novelty seeker",       short: "New spots, low repeats." },
  convenience:    { key: "convenience",    label: "Convenience matters",  short: "Speed and proximity win." },
  indulgence:     { key: "indulgence",     label: "Indulgent",            short: "Comfort, richness, no apology." },
  healthy_ish:    { key: "healthy_ish",    label: "Healthy-ish",          short: "Bowls, fresh, on the lighter side." },
  premium:        { key: "premium",        label: "Premium-leaning",      short: "Quality over price." },
  value:          { key: "value",          label: "Value-driven",         short: "Budget-friendly choices." },
  social:         { key: "social",         label: "Social",               short: "Food is the table, not the point." },
  late_night:     { key: "late_night",     label: "Late-night",           short: "After-hours and bar bites." },
  flavor_driven:  { key: "flavor_driven",  label: "Flavor-driven",        short: "Specific cravings, not just calories." },
  no_friction:    { key: "no_friction",    label: "Low decision effort",  short: "Don't make me think." },
  intentional:    { key: "intentional",    label: "Intentional",          short: "Picks on purpose, not by drift." },
  comfort_food:   { key: "comfort_food",   label: "Comfort-leaning",      short: "Familiar food, familiar feeling." },
};
