// ============================================================================
// load-state.ts — telling "nothing here" apart from "it broke".
// ----------------------------------------------------------------------------
// Every list screen in this app had the same shape: try, catch, console.warn,
// leave the state empty. So a thrown error and a genuinely empty result render
// identically, and the user is told "nobody has eaten yet" when the request
// failed.
//
// That is not hypothetical. The feed embedded a PostgREST relationship that
// does not exist, returned 400 on every call for the feature's entire life,
// and looked like an empty feed the whole time. It was found by curling the
// endpoint, not by using the app. Later, list_feed returned 35 rows while the
// app showed nothing, and there was still no way to tell from the screen which
// of the two was happening.
//
// One rule, in one place, so no screen gets to decide differently.
// ============================================================================

export type LoadView = "loading" | "error" | "empty" | "content";

export function loadView(s: {
  loading: boolean;
  error: unknown;
  count: number;
}): LoadView {
  // Content first: a refresh that fails should not blank a list that is
  // already on screen. Showing stale rows beats showing an error instead of
  // them.
  if (s.count > 0) return "content";
  if (s.error) return "error";
  if (s.loading) return "loading";
  return "empty";
}

/** A message worth showing a person. Never a raw exception. */
export function loadErrorMessage(error: unknown): string {
  const raw = String(
    (error as { message?: unknown } | null)?.message ?? error ?? "",
  ).toLowerCase();

  if (raw.includes("network") || raw.includes("fetch") || raw.includes("timeout")) {
    return "Couldn't reach Palate. Check your connection and try again.";
  }
  if (raw.includes("jwt") || raw.includes("auth") || raw.includes("401")) {
    return "Your session expired. Sign out and back in.";
  }
  return "Something went wrong loading this.";
}
