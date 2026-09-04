// ============================================================================
// username-gate.ts — one bit, shared between the guard and the screen.
// ----------------------------------------------------------------------------
// The gate shipped as a single useState in _layout, resolved once and keyed on
// [session]. Saving a handle does not change the session, so the flag stayed
// true forever: the screen saved, replaced to /(tabs), the guard re-ran, still
// read `needsUsername === true`, and bounced straight back. You could type a
// perfectly good handle all night and never get past it.
//
// Re-fetching on navigation would race the redirect — the guard reads the stale
// value before the new read lands. So the screen states the fact synchronously
// instead, and the guard reads the same bit.
//
// One-way on purpose: nothing sets this back to "needed" for a session. Losing
// a handle is not a thing that happens, and a gate that can re-arm itself is
// how you get the loop back.
// ============================================================================

let claimed = false;
const listeners = new Set<() => void>();

/** Call the moment a handle is durably saved, BEFORE navigating away. */
export function markUsernameClaimed(): void {
  if (claimed) return;
  claimed = true;
  for (const l of listeners) l();
}

export function isUsernameClaimed(): boolean {
  return claimed;
}

export function subscribeUsernameClaimed(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests only — module state outlives a single test otherwise. */
export function __resetUsernameGate(): void {
  claimed = false;
  listeners.clear();
}
