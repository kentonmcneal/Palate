import { SavedNearbyCard } from "./SavedNearbyCard";
import { SkipNudgeCard } from "./SkipNudgeCard";
import { SwapNudgeCard } from "./SwapNudgeCard";

// ============================================================================
// NudgeStack — only one nudge renders at a time, in priority order. Each
// nudge component already self-hides when it has no data, so stacking them
// in `display: none` containers and letting the first non-empty one win
// would require coordination. Simpler: render all three; each is a no-op
// when empty. The visual "one at a time" effect comes from the underlying
// data being mutually exclusive most of the time + the cards being short.
//
// (Kept as a separate component so the Home screen reads cleanly.)
// ============================================================================
export function NudgeStack() {
  return (
    <>
      <SavedNearbyCard />
      <SkipNudgeCard />
      <SwapNudgeCard />
    </>
  );
}
