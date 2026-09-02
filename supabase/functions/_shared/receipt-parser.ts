// ============================================================================
// receipt-parser.ts — turn a receipt email into a restaurant name and a date.
// ----------------------------------------------------------------------------
// Pure and dependency-free on purpose: no Deno globals, no Supabase client, no
// network. The edge function imports it, and so does a jest suite in mobile/,
// which is the only way adding a sender becomes a TEST rather than a
// deploy-and-hope.
//
// THE GOVERNING RULE: prefer null over a guess.
//
// A parser that returns the wrong name is strictly worse than one that returns
// nothing. Nothing costs us a missed visit. A wrong name spends a paid Google
// lookup, writes a false visit, and poisons the taste graph that every
// recommendation is computed from — silently, and in a way the user has no way
// to attribute. Every heuristic here is therefore bounded, and everything that
// smells like a sentence, a platform name, or an empty match is rejected.
// ============================================================================

export type ReceiptSource = "reservation" | "delivery" | "pos";

export type ParsedReceipt = {
  restaurantName: string;
  visitedAt: Date;
  source: ReceiptSource;
};

export type ParseInput = {
  from: string;
  subject: string;
  /** Decoded body text plus snippet. May be empty. */
  text: string;
  internalDate: Date;
};

/** Senders we know how to read. The Gmail query is built from this, so adding
 *  one here is the only place it needs to be declared. */
export const RECEIPT_SENDERS = [
  "no-reply@opentable.com",
  "noreply@opentable.com",
  "info@resy.com",
  "no-reply@resy.com",
  "no-reply@doordash.com",
  "no-reply@order.uber.com",
  "noreply@grubhub.com",
  "no-reply@trycaviar.com",
  "noreply@yelp.com",
  "no-reply@exploretock.com",
  "noreply@sevenrooms.com",
  "messenger@squareup.com",
  "no-reply@toasttab.com",
  "receipts@toasttab.com",
  "no-reply@seamless.com",
  "no-reply@postmates.com",
  "orders@chownow.com",
  "no-reply@slicelife.com",
];

// ----------------------------------------------------------------------------
// Rejection rules — the part that keeps a bad guess out of the taste graph
// ----------------------------------------------------------------------------

/** The platforms themselves. "Order from Uber Eats" names a company, not a
 *  restaurant, and resolving it would write a visit to a place nobody ate at. */
const PLATFORM_WORDS = new Set([
  "doordash", "uber", "uber eats", "ubereats", "grubhub", "seamless", "caviar",
  "postmates", "yelp", "opentable", "open table", "resy", "tock", "sevenrooms",
  "seven rooms", "square", "squareup", "toast", "toasttab", "chownow",
  "slice", "slice life", "your order", "your reservation", "us", "we",
]);

const MIN_NAME = 2;
const MAX_NAME = 60;

/**
 * Is this a plausible restaurant name, or did a loose regex swallow a sentence?
 * Exported because the rule is worth testing directly.
 */
export function isPlausibleName(raw: string): boolean {
  const name = raw.trim();
  if (name.length < MIN_NAME || name.length > MAX_NAME) return false;

  const lower = name.toLowerCase().replace(/[.!?,]+$/, "");
  if (PLATFORM_WORDS.has(lower)) return false;

  // Must contain a letter — "12" or "- -" is not a restaurant.
  if (!/\p{L}/u.test(name)) return false;

  // Sentences, not names. A real name rarely runs past six words, and never
  // contains terminal punctuation mid-string.
  if (name.split(/\s+/).length > 8) return false;
  if (/[.!?]\s+\p{Lu}/u.test(name)) return false;

  // Leftover template scaffolding.
  if (/\b(?:is confirmed|has been|thank you|thanks for|click here|view receipt|order #|your table)\b/i.test(lower)) {
    return false;
  }
  return true;
}

/** Trim trailing noise a subject line commonly carries after the name. */
function clean(raw: string): string {
  return raw
    .replace(/\s*[|–—-]\s*(?:receipt|order|confirmation|reservation).*$/i, "")
    .replace(/\s*\((?:\d+|[^)]*order[^)]*)\)\s*$/i, "")
    .replace(/[\s,.:;-]+$/, "")
    .trim();
}

function ok(name: string, dt: Date, source: ReceiptSource): ParsedReceipt | null {
  const cleaned = clean(name);
  if (!isPlausibleName(cleaned)) return null;
  return { restaurantName: cleaned, visitedAt: dt, source };
}

// ----------------------------------------------------------------------------
// Per-sender parsers
// ----------------------------------------------------------------------------
// Each anchors on an explicit phrase. The earlier versions used patterns like
// /(?:at|reservation:)\s+(.+)/ which match the word "at" ANYWHERE in a subject
// — "Your table is ready at 7pm" parsed as a restaurant called "7pm".

type Parser = (subject: string, text: string, dt: Date) => ParsedReceipt | null;

const parseOpenTable: Parser = (subject, _t, dt) => {
  const m = subject.match(/(?:reservation at|reminder:\s*|you're going to)\s+(.+?)(?:\s+is\s+confirmed|\s+is\s+coming|$)/i);
  return m ? ok(m[1], dt, "reservation") : null;
};

const parseResy: Parser = (subject, _t, dt) => {
  const m = subject.match(/(?:reservation|booking)\b[^@]*?\bat\s+(.+)/i);
  return m ? ok(m[1], dt, "reservation") : null;
};

const parseDoorDash: Parser = (subject, text, dt) => {
  const m = subject.match(/order from\s+(.+?)(?:\s+\(|$)/i)
    || text.match(/Order from\s+(.+?)[\n\r]/i);
  return m ? ok(m[1], dt, "delivery") : null;
};

const parseUberEats: Parser = (subject, _t, dt) => {
  // "Your Tuesday lunch with Joe's Pizza", "Receipt from Joe's Pizza"
  const m = subject.match(/(?:lunch|dinner|breakfast|order|receipt)\s+(?:with|from)\s+(.+?)(?:\s*[|]|$)/i)
    || subject.match(/^(?:receipt|your order)\s+from\s+(.+)$/i);
  return m ? ok(m[1], dt, "delivery") : null;
};

const parseGrubhub: Parser = (subject, text, dt) => {
  const m = subject.match(/(?:order from|receipt from)\s+(.+)/i)
    || text.match(/Order from\s+(.+?)[\n\r]/i);
  return m ? ok(m[1], dt, "delivery") : null;
};

const parseCaviar: Parser = (subject, _t, dt) => {
  const m = subject.match(/(?:order|receipt)\s+from\s+(.+)/i);
  return m ? ok(m[1], dt, "delivery") : null;
};

const parseYelp: Parser = (subject, _t, dt) => {
  const m = subject.match(/(?:reservation|booking)\b[^@]*?\bat\s+(.+)/i);
  return m ? ok(m[1], dt, "reservation") : null;
};

const parseTock: Parser = (subject, _t, dt) => {
  const m = subject.match(/(?:reservation|booking)\s+at\s+(.+)/i);
  return m ? ok(m[1], dt, "reservation") : null;
};

const parseSevenRooms: Parser = (subject, _t, dt) => {
  // Was /(?:at|reservation:)\s+(.+)/ — matched any "at" in the line.
  const m = subject.match(/reservation(?::|\s+at)\s+(.+)/i);
  return m ? ok(m[1], dt, "reservation") : null;
};

const parseSquare: Parser = (subject, text, dt) => {
  const m = subject.match(/receipt from\s+(.+)/i)
    || text.match(/^([A-Z][^\n]{2,40})[\n\r]/m);
  return m ? ok(m[1], dt, "pos") : null;
};

const parseToast: Parser = (subject, text, dt) => {
  const m = subject.match(/(?:receipt|order)\s+from\s+(.+)/i)
    || text.match(/^([A-Z][^\n]{2,40})[\n\r]/m);
  return m ? ok(m[1], dt, "pos") : null;
};

const parseGeneric: Parser = (subject, _t, dt) => {
  const m = subject.match(/(?:order|receipt)\s+from\s+(.+)/i);
  return m ? ok(m[1], dt, "delivery") : null;
};

const BY_DOMAIN: { domain: string; parse: Parser }[] = [
  { domain: "opentable.com",   parse: parseOpenTable },
  { domain: "resy.com",        parse: parseResy },
  { domain: "doordash.com",    parse: parseDoorDash },
  { domain: "uber.com",        parse: parseUberEats },
  { domain: "grubhub.com",     parse: parseGrubhub },
  { domain: "trycaviar.com",   parse: parseCaviar },
  { domain: "yelp.com",        parse: parseYelp },
  { domain: "exploretock.com", parse: parseTock },
  { domain: "sevenrooms.com",  parse: parseSevenRooms },
  { domain: "squareup.com",    parse: parseSquare },
  { domain: "toasttab.com",    parse: parseToast },
  { domain: "seamless.com",    parse: parseGeneric },
  { domain: "postmates.com",   parse: parseGeneric },
  { domain: "chownow.com",     parse: parseGeneric },
  { domain: "slicelife.com",   parse: parseGeneric },
];

/** Parse one message. Returns null for anything we cannot read confidently. */
export function parseReceipt(input: ParseInput): ParsedReceipt | null {
  const from = (input.from ?? "").toLowerCase();
  for (const { domain, parse } of BY_DOMAIN) {
    if (from.includes(domain)) {
      return parse(input.subject ?? "", input.text ?? "", input.internalDate);
    }
  }
  return null;
}

/** Normalized key for deduping the same restaurant across senders. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
