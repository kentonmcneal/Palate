// ============================================================================
// save-copy.ts — variation pool for save confirmation toasts.
// ----------------------------------------------------------------------------
// Same action shouldn't say the same thing every time. Pulls from a small
// curated pool so the app feels alive without wandering off-brand.
// ============================================================================

const SAVE_LINES = [
  { title: "Saved to your Next Moves", body: "We'll surface it when you're nearby." },
  { title: "You'll thank yourself later", body: "Added to Next Moves — we'll resurface when it fits." },
  { title: "Banked", body: "It's on your Next Moves list now." },
  { title: "Locked in", body: "Saved. We'll nudge you when you're close." },
  { title: "On your radar", body: "Saved to Next Moves." },
  { title: "Smart move", body: "Added — we'll bring it back at the right moment." },
];

export function pickSaveCopy(): { title: string; body: string } {
  return SAVE_LINES[Math.floor(Math.random() * SAVE_LINES.length)];
}
