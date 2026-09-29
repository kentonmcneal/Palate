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
// One-way within one account session; changing accounts must start fresh.
// ============================================================================

export type UsernameSession = Readonly<{ accountId: string | null; generation: number }>;
let current: UsernameSession = { accountId: null, generation: 0 };
let claimed = false;
const listeners = new Set<() => void>();

/** Account transitions reset the bit, preserving active guard subscriptions. */
export function setUsernameGateAccount(accountId: string | null): void {
  if (current.accountId === accountId) return;
  current = { accountId, generation: current.generation + 1 };
  claimed = false;
}

/** Capture BEFORE a save; an old A completion must not affect B or a new A session. */
export function usernameGateSession(): UsernameSession { return current; }
export function isUsernameGateSession(token: UsernameSession): boolean {
  return token === current && current.accountId !== null;
}

/** Returns false for a stale/signed-out completion. Call before navigating. */
export function markUsernameClaimed(token: UsernameSession): boolean {
  if (!isUsernameGateSession(token)) return false;
  if (!claimed) {
    claimed = true;
    for (const l of listeners) l();
  }
  return true;
}

export function isUsernameClaimed(): boolean { return claimed; }
export function subscribeUsernameClaimed(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests only — resets subscribers too. */
export function __resetUsernameGate(): void {
  current = { accountId: null, generation: current.generation + 1 };
  claimed = false;
  listeners.clear();
}
