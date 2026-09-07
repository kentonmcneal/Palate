// ============================================================================
// brand.ts — one restaurant should not take two of your three slots.
// ----------------------------------------------------------------------------
// Ranked by compatibility, the founder's top three nearby were Huey's Poplar,
// Huey's Southwind and Hueys Germantown. The same restaurant, three times, as
// the entire recommendation. Nothing prevented it: the shortlist caps by
// CUISINE, and three locations of one place are one cuisine, one brand, and
// three separate rows.
//
// The chain fields cannot help here, and should not. All six Huey's in the
// catalogue carry chain_name = NULL and is_chain_brand = false, which is
// correct — it is a Memphis institution, not a fast-food chain, and gems-first
// is right to recommend it. The problem is not that it is a chain. The problem
// is showing it three times.
//
// So this is a DIVERSITY rule for a three-slot list, not a claim about
// corporate structure. It groups names that begin the same way. That will
// occasionally group two unrelated places — "Forest Hill Grill" and "Forest
// Hill Cafe" collapse to one key whether or not they share an owner — and the
// cost of being wrong is bounded and small: a different third suggestion. It
// never hides a restaurant from search, from Discover, or from the pool, and
// the caller falls back to the undeduplicated list rather than return short.
// ============================================================================

/** Leading words that identify nothing, so a key built from them would group
 *  half the city. "The Second Line" must not become "the". */
const GENERIC = new Set([
  "the", "a", "an", "el", "la", "le", "los", "las", "new", "old", "big",
  "little", "cafe", "café", "bar", "grill", "kitchen", "restaurant", "house",
  "chez", "casa", "mr", "mrs", "st", "saint",
]);

/** Lowercase, drop punctuation and apostrophes, collapse whitespace. So
 *  "Huey's Poplar" and "Hueys Germantown" agree on their first word. */
export function normalizeName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The key two locations of one restaurant share. `chainName` wins when the
 * classifier set it; otherwise the name's leading word, or its first two words
 * when the leading word is generic or too short to identify anything.
 *
 * Returns null for a name with nothing in it, and a null key never groups:
 * an unnamed row is not "the same brand" as another unnamed row.
 */
export function brandKey(name: string | null | undefined, chainName?: string | null): string | null {
  const chain = normalizeName(chainName ?? "");
  if (chain) return chain;

  const tokens = normalizeName(name ?? "").split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  const first = tokens[0];
  if (first.length >= 4 && !GENERIC.has(first)) return first;
  // "The Second Line" → "the second". "Bog & Barley" → "bog barley".
  return tokens.slice(0, 2).join(" ");
}

/**
 * First occurrence of each brand, in the order given, so the highest-ranked
 * location of a restaurant is the one that survives.
 *
 * Rows whose key is null are all kept: "no name" is not a brand.
 */
export function uniqueByBrand<T>(
  items: readonly T[],
  nameOf: (t: T) => string | null | undefined,
  chainOf?: (t: T) => string | null | undefined,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = brandKey(nameOf(it), chainOf?.(it));
    if (k === null) { out.push(it); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
