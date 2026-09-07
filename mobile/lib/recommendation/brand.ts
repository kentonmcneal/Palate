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

/**
 * A possessive leading word is a name: Huey's, Gus's, Taziki's, Sam's. A bare
 * one is usually a category: Southern, Taco, Sweet, Shawarma, Tokyo.
 *
 * That distinction is the whole rule, and it was measured rather than guessed.
 * Three versions were run over the real catalogue:
 *
 *   • first word alone — 16 groups in the 200-place pool, about six wrong,
 *     including "Southern Social" (the founder's actual second recommendation)
 *     folded into an unrelated "Southern Hands Homestyle Cooking".
 *   • first word if it merely ENDS in s — recovers "Hueys Germantown", whose
 *     name is missing its apostrophe, but over all 1,719 rows it also merges
 *     seven unrelated "Memphis ..." places and five unrelated "Tacos ..."
 *     ones. Rejected.
 *   • possessive only, two words otherwise — what this is.
 *
 * What it gets right across the full catalogue: seven Huey's, three Maciel's,
 * three Taziki's, two Crumpy's, two Pyro's, two Vinny's.
 *
 * What it gets wrong, knowingly: a common first name shared by unrelated
 * restaurants. "Tony's Pizza Napoletana" and "Tony's Takos" collapse, as do
 * three separate Angelo's. The cost is bounded and one-directional — the
 * shortlist offers one of them instead of both, drawn from a pool of about
 * two hundred, and nothing is hidden from search, Discover or the pool. A
 * repeated restaurant in a three-item list is visible and looks broken; a
 * substituted alternative is not.
 *
 * What it misses, knowingly: "Hueys Germantown" without its apostrophe reads
 * as a different brand from "Huey's Poplar". Fixing that one row of data is
 * cheaper and safer than the rule that would catch it.
 */
function isPossessive(rawFirstWord: string): boolean {
  return /['’]s$|s['’]$/.test(rawFirstWord);
}

/** Leading words that identify nothing on their own. Kept small: the
 *  possessive test above does most of the work, and a long banned-word list is
 *  a list somebody has to maintain against a city's worth of restaurant
 *  names. */
const GENERIC = new Set([
  "the", "a", "an", "el", "la", "le", "los", "las", "chez", "casa",
  "mr", "mrs", "st", "saint", "new", "old",
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
export function brandKey(
  name: string | null | undefined,
  chainName?: string | null,
  /** Possessive keys known to be present among the candidates. Lets a name
   *  whose apostrophe is missing from the data adopt one. */
  knownBrands?: ReadonlySet<string>,
): string | null {
  const chain = normalizeName(chainName ?? "");
  if (chain) return chain;

  const raw = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const tokens = normalizeName(name ?? "").split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  const first = tokens[0];
  // "Huey's Poplar" and "Huey's Southwind" are one restaurant at two
  // addresses, and the possessive is what says so.
  if (raw[0] && isPossessive(raw[0]) && first.length >= 3) return first;

  // "Hueys Germantown" has lost its apostrophe in the data. It adopts the key
  // ONLY because some other candidate spells the same word possessively, so
  // this can never invent a brand: no row is named "Memphi's" or "Taco's", and
  // that is exactly why those stayed apart when the rule was merely "ends in
  // an s".
  if (knownBrands?.has(first) && /s$/i.test(raw[0] ?? "") && first.length >= 3) return first;

  // Everything else needs two words to agree, which keeps "Taqueria Express"
  // apart from "Taqueria Chelita" and "Tokyo Grill" from "Tokyo Japanese
  // Express" while still folding "Memphis Pizza Cafe" into its duplicate.
  if (tokens.length === 1) {
    return GENERIC.has(first) ? null : first;
  }
  return tokens.slice(0, 2).join(" ");
}

/** The key a name contributes to `knownBrands`: a chain the classifier named,
 *  or a genuine possessive. Nothing else, or the adoption rule above would
 *  bootstrap itself from the very names it is meant to keep apart. */
function certainBrandKey(name: string | null | undefined, chainName?: string | null): string | null {
  const chain = normalizeName(chainName ?? "");
  if (chain) return chain;
  const raw = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const tokens = normalizeName(name ?? "").split(" ").filter(Boolean);
  if (!raw[0] || tokens.length === 0) return null;
  if (!isPossessive(raw[0]) || tokens[0].length < 3) return null;
  return tokens[0];
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
  // Pass one: which brands are spelled unambiguously somewhere in this list.
  const known = new Set<string>();
  for (const it of items) {
    const k = certainBrandKey(nameOf(it), chainOf?.(it));
    if (k) known.add(k);
  }

  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = brandKey(nameOf(it), chainOf?.(it), known);
    if (k === null) { out.push(it); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
