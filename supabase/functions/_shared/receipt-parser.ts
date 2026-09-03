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
  // Domains, not exact addresses. Verified against a live inbox: OpenTable
  // sends from OpenTable@em.opentable.com and OpenTable@mgs.opentable.com,
  // SevenRooms from <Venue>@email.sevenrooms.com, Square from
  // messenger@messaging.squareup.com. A `from:` on the exact no-reply@ address
  // this list used to hold matches none of them, so the Gmail query was
  // fetching nothing from those platforms at all.
  //
  // The cost of matching domains is that platform MARKETING is fetched too —
  // DoorDash alone sends near-daily promos. Every parser is therefore
  // whitelist-style: it requires explicit order or reservation phrasing and
  // ignores anything else.
  "opentable.com",
  "resy.com",
  "doordash.com",
  "order.uber.com",
  "grubhub.com",
  "trycaviar.com",
  "yelp.com",
  "exploretock.com",
  "sevenrooms.com",
  "squareup.com",
  "toasttab.com",
  "seamless.com",
  "postmates.com",
  "chownow.com",
  "slicelife.com",
  "olo.com",
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

/**
 * DoorDash. Written against real subjects, which never use the bare phrase
 * "order from" the previous pattern required:
 *   "Order Confirmation for Kenton from Addiction smash burger"
 *   "Details of your no-contact delivery from Krispy Kreme"
 *
 * DoorDash also sends daily marketing from the SAME address — "This week's
 * shopping deals are here", "Ends soon: 50% off back-to-school". Matching is
 * therefore whitelist-style: a subject must carry one of these order phrasings
 * or it is ignored. The old body fallback was removed for the same reason —
 * "Order from" appears in promotional bodies too.
 */
const parseDoorDash: Parser = (subject, _text, dt) => {
  const m = subject.match(/order confirmation for .+?\s+from\s+(.+)/i)
    || subject.match(/delivery from\s+(.+)/i)
    || subject.match(/order from\s+(.+)/i);
  // "D'bo's Daiquiris, Wings, & Seafood (D'bo's Wings)" — drop the alias.
  return m ? ok(m[1].split(" (")[0], dt, "delivery") : null;
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

/**
 * Square. Real subjects take two shapes — "Receipt from <Merchant> #ABCD" and
 * "Your order from <Merchant>" — and the trailing reference code has to go or
 * it travels into the Places lookup.
 *
 * Square also sends invoice mail from the same address ("You received a new
 * invoice", "You made a payment for an invoice!"). Those name a business the
 * user paid, not a place they ate, and the body fallback would happily read
 * one as a restaurant.
 */
const parseSquare: Parser = (subject, text, dt) => {
  if (/invoice/i.test(subject)) return null;
  const m = subject.match(/(?:receipt|your order)\s+from\s+(.+)/i)
    || text.match(/^([A-Z][^\n]{2,40})[\n\r]/m);
  if (!m) return null;
  // Strip Square's "#BUAB" reference suffix.
  return ok(m[1].replace(/\s+#\w+\s*$/, ""), dt, "pos");
};

/**
 * Toast. Written against real subject lines from a live inbox, because the
 * previous pattern looked for "receipt from X" and Toast never says "from" —
 * so every genuine receipt fell through to a body-first-line fallback that
 * would happily record "Order Confirmation" as a restaurant.
 *
 * The four shapes actually observed:
 *   "Almyra - Order Received"
 *   "Order & Pay Receipt for $29.52 at Kick Axe Throwing - Philly"
 *   "Email Receipt for $17.28 at Puttshack Philadelphia - Philadelphia"
 *   "Online Order Receipt for $42.48 at Pietro's Pizza (Philadelphia) - 1714 Walnut Street"
 */
const parseToast: Parser = (subject, _text, dt) => {
  // "How was your order from X?" arrives after a receipt we already parsed.
  // Reading it would log the same meal twice.
  if (/^how was your order/i.test(subject.trim())) return null;

  // "...Receipt for $X at <Name>[ - location]"
  const receipt = subject.match(/receipt\s+for\s+\$[\d.,]+\s+at\s+(.+)/i);
  if (receipt) return ok(trimVenueSuffix(receipt[1]), dt, "pos");

  // "<Name> - Order Received"
  const received = subject.match(/^(.+?)\s+-\s+order\s+received$/i);
  if (received) return ok(trimVenueSuffix(received[1]), dt, "pos");

  // "Your receipt from <Name>". Not seen in the sampled inbox, but recorded by
  // an earlier session and harmless to keep — it costs one branch and the
  // survey below is what actually needed excluding.
  const from = subject.match(/receipt\s+from\s+(.+)/i);
  if (from) return ok(trimVenueSuffix(from[1]), dt, "pos");

  return null;
};

/**
 * Toast appends a location to the venue name — " - Philly", " - 1714 Walnut
 * Street", " | 833 Wharton St". Keep the part before the first separator: a
 * restaurant name almost never contains " - ", and an address suffix makes the
 * Places lookup worse, not better.
 */
function trimVenueSuffix(raw: string): string {
  return raw.split(/\s+[-|]\s+/)[0].trim();
}

/**
 * Olo powers ordering for many brands, and its SUBJECT is unreliable: one real
 * message reads "Wolf River Hospitality Group - Order Received" while the
 * restaurant actually visited (PYRO'S – Cordova) appears only in the body. So
 * the subject is used to confirm this is an order at all, and the venue is read
 * from the body's first line.
 */
const parseOlo: Parser = (subject, text, dt) => {
  if (!/order\s+received|order$|your order/i.test(subject.trim())) return null;
  const first = text.split(/[\n\r]/).map((l) => l.trim()).find((l) => l.length > 2);
  if (!first) return null;
  // Body lines look like "PYRO'S – CORDOVA 2286 N. Germantown Parkway, ...".
  // Cut at the first comma or street number so the address does not travel.
  const name = first.split(",")[0].replace(/\s+\d{2,}.*$/, "").trim();
  return name ? ok(name, dt, "delivery") : null;
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
  { domain: "olo.com",         parse: parseOlo },
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
