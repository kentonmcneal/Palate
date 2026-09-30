// ============================================================================
// profile-route.ts — validating the id a profile route arrives with.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS.
//
// Three of the four notification deep-links in app/_layout.tsx push
// `/profile/${String(data.user_id ?? "")}`. A payload without user_id therefore
// navigates with an EMPTY id — and only the fourth handler guards with
// `data.user_id &&` first. app/profile/[id].tsx then passed that straight
// through as `id as string`, a cast that asserts a shape nobody had checked.
//
// The damage is not a blank screen. ProfileBody's snapshot load has no empty-id
// guard, so `get_friend_profile_snapshot("")` is called, Postgres rejects the
// invalid uuid, and captureError fires against that RPC — the one this project's
// own notes describe as having "failed silently for sixty-five migrations" and
// which is now watched for exactly that reason. A malformed push payload
// manufactures a false alarm on the single signal most likely to be believed.
//
// So the route boundary validates, and an unusable id never reaches the RPC.
// ============================================================================

/** profiles.id is a uuid; the snapshot RPC takes one. Anything else is a 22P02
 *  at the database, not a profile that happens to be missing. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalise what expo-router actually hands over.
 *
 * useLocalSearchParams types a param as `string | string[]`: a repeated segment
 * arrives as an array. The old code cast to `string`, so an array would have
 * been interpolated into the RPC as "a,b".
 */
export function normalizeRouteId(raw: string | string[] | undefined | null): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return null;
  const trimmed = first.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True when this id is worth spending a database round trip on. */
export function isUsableProfileId(raw: string | string[] | undefined | null): boolean {
  const id = normalizeRouteId(raw);
  return id !== null && UUID.test(id);
}

/**
 * The id to render, or null to show the unavailable state.
 *
 * Deliberately NOT "render anyway and let the server decide": the server
 * deciding is what fires the false alarm.
 */
export function profileIdFromRoute(raw: string | string[] | undefined | null): string | null {
  return isUsableProfileId(raw) ? normalizeRouteId(raw) : null;
}
