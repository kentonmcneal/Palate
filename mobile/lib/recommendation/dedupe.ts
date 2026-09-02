// ============================================================================
// recommendation/dedupe.ts — collapse the same physical venue appearing twice.
// ----------------------------------------------------------------------------
// A tester reported duplicate restaurants in the Discover feed. The feed was
// already keyed by google_place_id, so these were not render-key bugs: Google
// Places genuinely returns one venue under two place ids, usually a clean
// listing plus a keyword-stuffed one —
//
//     "Hong Kong Restaurant"  +  "Hong Kong Restaurant | Chinese"
//     "Gordo's Mexican Bar and Grill"  +  "Gordo's Mexican Bar and Grill & Mariscos…"
//
// Deduping by id can never catch that. We match on identity instead: same
// normalized name (or one name being a prefix of the other) within a short
// distance. The richer record wins, so we keep the listing with real review
// volume rather than whichever arrived first.
// ============================================================================

export type DedupeInput = {
  google_place_id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  user_rating_count?: number | null;
};

/** Same-venue distance ceiling. Two listings for one restaurant sit within a
 *  building of each other; two genuinely different restaurants with the same
 *  name (a chain's two branches) are almost always farther apart. */
const SAME_VENUE_M = 150;

/** Lowercase, strip punctuation, collapse whitespace. Keeps every word — this
 *  is identity matching, not brand matching, so "chinese" must survive to be
 *  compared as a suffix. */
function normalizeName(raw: string): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function metersBetween(
  a: { latitude?: number | null; longitude?: number | null },
  b: { latitude?: number | null; longitude?: number | null },
): number | null {
  if (a.latitude == null || a.longitude == null) return null;
  if (b.latitude == null || b.longitude == null) return null;
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** One name is the other plus trailing words ("X" vs "X | Chinese"). Requires
 *  the shared prefix to be at least two words, so "Pho 1" and "Pho 1 Express"
 *  collapse but "Thai" and "Thai Basil Kitchen" do not. */
function isNameVariant(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!long.startsWith(short + " ")) return false;
  return short.split(" ").length >= 2;
}

/** Prefer the listing with more review volume, then rating, then the one we
 *  already had. Review count is the best available proxy for "this is the
 *  listing people actually use". */
function isBetter(candidate: DedupeInput, incumbent: DedupeInput): boolean {
  const c = candidate.user_rating_count ?? 0;
  const i = incumbent.user_rating_count ?? 0;
  if (c !== i) return c > i;
  return (candidate.rating ?? 0) > (incumbent.rating ?? 0);
}

/**
 * Collapse duplicate listings of one venue, preserving input order of the
 * kept records. Exact google_place_id repeats are collapsed too.
 */
export function dedupeVenues<T extends DedupeInput>(list: T[]): T[] {
  const kept: T[] = [];
  const byId = new Map<string, number>();

  for (const item of list) {
    const existingIdx = byId.get(item.google_place_id);
    if (existingIdx != null) {
      if (isBetter(item, kept[existingIdx])) kept[existingIdx] = item;
      continue;
    }

    const name = normalizeName(item.name);
    let matchIdx = -1;
    for (let i = 0; i < kept.length; i++) {
      if (!isNameVariant(name, normalizeName(kept[i].name))) continue;
      const d = metersBetween(item, kept[i]);
      // No coordinates on either side: fall back to requiring identical names,
      // which is the conservative read.
      if (d == null ? name === normalizeName(kept[i].name) : d <= SAME_VENUE_M) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx === -1) {
      byId.set(item.google_place_id, kept.length);
      kept.push(item);
    } else if (isBetter(item, kept[matchIdx])) {
      byId.delete(kept[matchIdx].google_place_id);
      byId.set(item.google_place_id, matchIdx);
      kept[matchIdx] = item;
    }
  }

  return kept;
}
