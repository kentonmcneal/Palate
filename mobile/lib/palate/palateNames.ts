// ============================================================================
// palateNames.ts — what the identities are actually called.
// ----------------------------------------------------------------------------
// The model has four quadrants on two axes (novelty × premium) and they were
// named Curator / Forager / Steward / Anchor. Those are accurate and nobody
// knows what they mean. The founder's note was blunt about it: the label on
// the profile "is doing nothing", and the fix is names people already use —
// the register of "foodie", not of a museum job title.
//
//   Tastemaker   new places, the good ones. The one who tells everyone where.
//   Explorer     new places, anywhere. Three stools and a counter is fine.
//   Connoisseur  a short list of the right places, kept sharp.
//   Regular      the same few spots, and they know your order.
//   Warming Up   not enough visits to say yet.
//
// The KEYS do not change. Curator/Forager/Steward/Anchor stay as the internal
// identifiers, in the type union, in the stored data and in every test — this
// module is the only place the words live, so renaming again is one edit and
// no migration.
// ============================================================================

import type { PrimaryIdentity } from "./palateTypes";

export const IDENTITY_NAME: Record<PrimaryIdentity, string> = {
  Curator: "Tastemaker",
  Forager: "Explorer",
  Steward: "Connoisseur",
  Anchor: "Regular",
  Learning: "Warming Up",
};

/** Bare noun, for prose: "your palate leaned Explorer this week". */
export function identityName(id: PrimaryIdentity | null | undefined): string {
  return id ? (IDENTITY_NAME[id] ?? id) : "Warming Up";
}

/** With its article, for a badge: "You are an Explorer". */
export function identityWithArticle(id: PrimaryIdentity | null | undefined): string {
  const n = identityName(id);
  if (id === "Learning") return n; // "You are Warming Up" — no article
  return `${/^[AEIOU]/i.test(n) ? "an" : "a"} ${n}`;
}

/** The badge form used on cards and shares: "The Explorer". */
export function identityTitle(id: PrimaryIdentity | null | undefined): string {
  const n = identityName(id);
  return id === "Learning" ? n : `The ${n}`;
}

// The server used to mint its own five names ('The Fast Casual Regular' and
// friends) with no relationship to this model. Rows written before 0118 still
// carry them, so anything reading `personality_label` maps them home rather
// than showing a person a name the app no longer uses.
const LEGACY_TO_KEY: Record<string, PrimaryIdentity> = {
  "the loyalist": "Steward",
  "the explorer": "Forager",
  "the fast casual regular": "Anchor",
  "the café dweller": "Anchor",
  "the cafe dweller": "Anchor",
  "the comfort food connoisseur": "Anchor",
};

/** Normalise anything stored in `weekly_wrapped.personality_label`. */
export function displayStoredPersona(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const key = LEGACY_TO_KEY[stored.trim().toLowerCase()];
  if (key) return identityTitle(key);
  // Already one of ours, stored bare ("Explorer") or titled ("The Explorer").
  const bare = stored.replace(/^the\s+/i, "").trim();
  const match = (Object.entries(IDENTITY_NAME) as [PrimaryIdentity, string][])
    .find(([, name]) => name.toLowerCase() === bare.toLowerCase());
  return match ? identityTitle(match[0]) : stored;
}
