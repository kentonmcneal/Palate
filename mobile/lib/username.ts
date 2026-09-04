// ============================================================================
// username.ts — the handle rules, said once and shown to the person typing.
// ----------------------------------------------------------------------------
// setUsername() strips illegal characters silently and then checks the length,
// so "ken ton!" saved as "kenton" and the user found out afterwards. That is
// survivable for an optional field buried in settings. It is not survivable for
// a required one at signup, where the handle is how everybody else will refer
// to you — a field that quietly changes your answer teaches you not to trust it.
//
// Same rule as the database CHECK (migration 0056) and setUsername, in one
// place, returning a message a person can act on.
// ============================================================================

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Exactly what will be stored for a given input. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export type UsernameCheck =
  | { ok: true; value: string }
  | { ok: false; message: string };

export function validateUsername(raw: string): UsernameCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: "Pick a handle so friends can find you." };

  const value = normalizeUsername(trimmed);

  // Report the removal rather than performing it silently.
  if (value.length !== trimmed.replace(/\s/g, "").length || /[A-Z]/.test(trimmed)) {
    const stripped = trimmed.replace(/\s/g, "").toLowerCase();
    if (value !== stripped) {
      return { ok: false, message: "Letters, numbers and underscores only." };
    }
  }
  if (value.length < USERNAME_MIN) {
    return { ok: false, message: `At least ${USERNAME_MIN} characters.` };
  }
  if (value.length > USERNAME_MAX) {
    return { ok: false, message: `${USERNAME_MAX} characters at most.` };
  }
  return { ok: true, value };
}

/**
 * A handle worth offering, derived from what we already know. Offering one
 * beats an empty box: most people accept a reasonable suggestion, and the ones
 * who care about their handle were going to type it anyway.
 */
export function suggestUsername(
  email: string | null | undefined,
  displayName: string | null | undefined,
): string {
  const fromName = normalizeUsername(displayName ?? "");
  if (fromName.length >= USERNAME_MIN) return fromName.slice(0, USERNAME_MAX);

  const local = (email ?? "").split("@")[0] ?? "";
  const fromEmail = normalizeUsername(local);
  if (fromEmail.length >= USERNAME_MIN) return fromEmail.slice(0, USERNAME_MAX);

  return "";
}
