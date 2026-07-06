// Palate — Reddit qualitative enrichment (SCAFFOLD, not wired into any live path).
//
// WHY THIS EXISTS
//   Google reviews tell you a place is "good." Reddit tells you WHO goes and
//   WHY — "great for a bachelorette, gets loud after 9," "we did my mom's
//   retirement dinner here, very buttoned-up," "solo lunch spot, order at the
//   counter." That occasion/vibe signal is exactly what separates three
//   Mediterranean restaurants that Google treats as identical. Feeding Reddit
//   discussion into the qualitative LLM classifier makes vibe/occasion/crowd
//   tags dramatically richer than review snippets alone.
//
// COST / SAFETY — READ BEFORE ENABLING
//   * This module makes NETWORK calls to Reddit and is intended to feed the
//     paid LLM classifier. It is therefore a COST-BEARING path and, per the
//     project spending policy, must NOT be run without explicit approval.
//   * Nothing in the production edge functions imports this yet. It is inert
//     until deliberately wired in.
//   * Reddit's API requires a registered app + OAuth for anything beyond light
//     use, sets rate limits, and its Data API terms restrict storage/redistribution
//     of content. For production, register a script app, send a descriptive
//     User-Agent, authenticate, cache aggressively, and store only DERIVED tags
//     (not raw comment text). Treat the unauthenticated JSON endpoints below as
//     a prototype-only convenience.
//
// DESIGN
//   Runtime-agnostic like the LLM module: the caller injects `fetchImpl` (Deno
//   or Node fetch) so this file has zero runtime imports and can be unit-tested
//   with a stub. Pure text-gathering; it does not call the LLM itself — it just
//   produces snippets you fold into LLMInput.reviewSnippets.

export interface RedditContextOptions {
  // City / metro to disambiguate the restaurant ("Cafe Mogador Brooklyn").
  city?: string | null;
  // Subreddits to prefer (e.g. ["FoodNYC", "AskNYC", "nyc"]). If omitted we
  // do a site-wide search plus a best-effort city guess.
  subreddits?: string[];
  // Max Reddit posts to pull comments from.
  maxThreads?: number;
  // Max snippets returned overall (keeps the LLM prompt small + cheap).
  maxSnippets?: number;
  // Descriptive User-Agent — REQUIRED by Reddit. e.g. "palate/1.0 (contact ...)"
  userAgent: string;
  // Optional OAuth bearer token. When present we hit oauth.reddit.com (the
  // supported path); otherwise we fall back to the public www.reddit.com JSON.
  bearerToken?: string | null;
}

export interface RedditContextResult {
  snippets: string[];
  sourceCount: number;
  queriesRun: string[];
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const DEFAULTS = { maxThreads: 3, maxSnippets: 8 };

function base(opts: RedditContextOptions): string {
  return opts.bearerToken ? "https://oauth.reddit.com" : "https://www.reddit.com";
}

function headers(opts: RedditContextOptions): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": opts.userAgent };
  if (opts.bearerToken) h["Authorization"] = `Bearer ${opts.bearerToken}`;
  return h;
}

// Keep only sentences that actually talk about atmosphere/occasion/crowd —
// the signal we want — and drop generic praise. Cheap pre-filter so we don't
// pay the LLM to read "food was great, 5 stars."
const SIGNAL_RE =
  /\b(vibe|atmosphere|ambiance|ambience|crowd|scene|loud|quiet|intimate|romantic|date|anniversary|birthday|graduation|celebrat|business|client|work dinner|impress|party|packed|energy|dress code|reservation|walk[- ]?in|counter|solo|group|family|kids|cozy|upscale|casual|dive|hipster|touristy|local)\b/i;

function extractSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 300 && SIGNAL_RE.test(s));
}

function buildQueries(name: string, opts: RedditContextOptions): string[] {
  const q = opts.city ? `${name} ${opts.city}` : name;
  const queries = [`https://REDDIT/search.json?q=${encodeURIComponent(q)}&sort=relevance&limit=5&type=link`];
  for (const sub of opts.subreddits ?? []) {
    queries.push(
      `https://REDDIT/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(name)}&restrict_sr=1&sort=relevance&limit=5`,
    );
  }
  return queries;
}

// Best-effort permalink → comments JSON. Returns comment bodies (top level).
async function fetchThreadComments(
  permalink: string,
  fetchImpl: FetchLike,
  opts: RedditContextOptions,
): Promise<string[]> {
  const url = `${base(opts)}${permalink.replace(/\/$/, "")}.json?limit=30&depth=1`;
  const resp = await fetchImpl(url, { headers: headers(opts) });
  if (!resp.ok) return [];
  const data = (await resp.json()) as unknown;
  const out: string[] = [];
  // Reddit thread JSON is [postListing, commentsListing].
  const listings = Array.isArray(data) ? data : [];
  const comments = (listings[1] as { data?: { children?: unknown[] } })?.data?.children ?? [];
  for (const c of comments) {
    const body = (c as { data?: { body?: string } })?.data?.body;
    if (typeof body === "string") out.push(...extractSentences(body));
  }
  return out;
}

// Gather Reddit-derived qualitative snippets for a restaurant. Pure gathering —
// no LLM, no DB. Returns [] on any failure (Reddit down, rate-limited, no hits)
// so callers can treat it as best-effort enrichment.
export async function fetchRedditContext(
  name: string,
  fetchImpl: FetchLike,
  opts: RedditContextOptions,
): Promise<RedditContextResult> {
  const maxThreads = opts.maxThreads ?? DEFAULTS.maxThreads;
  const maxSnippets = opts.maxSnippets ?? DEFAULTS.maxSnippets;
  const queriesRun: string[] = [];
  const snippets: string[] = [];
  let sourceCount = 0;

  try {
    for (const template of buildQueries(name, opts)) {
      const url = template.replace("REDDIT", base(opts).replace(/^https:\/\//, ""));
      queriesRun.push(url);
      const resp = await fetchImpl(url, { headers: headers(opts) });
      if (!resp.ok) continue;
      const data = (await resp.json()) as { data?: { children?: unknown[] } };
      const posts = data?.data?.children ?? [];
      const permalinks: string[] = [];
      for (const p of posts) {
        const pd = (p as { data?: { permalink?: string; selftext?: string; title?: string } }).data;
        if (!pd) continue;
        if (pd.title) snippets.push(...extractSentences(pd.title));
        if (pd.selftext) snippets.push(...extractSentences(pd.selftext));
        if (pd.permalink) permalinks.push(pd.permalink);
      }
      for (const link of permalinks.slice(0, maxThreads)) {
        const comments = await fetchThreadComments(link, fetchImpl, opts);
        if (comments.length) sourceCount += 1;
        snippets.push(...comments);
        if (snippets.length >= maxSnippets * 2) break;
      }
      if (snippets.length >= maxSnippets * 2) break;
    }
  } catch {
    // Best-effort: swallow network/parse errors, return whatever we gathered.
  }

  // De-dupe, cap, and return.
  const unique = Array.from(new Set(snippets)).slice(0, maxSnippets);
  return { snippets: unique, sourceCount, queriesRun };
}

// Fold Reddit snippets into an LLMInput's reviewSnippets so the existing
// qualitative classifier treats them as additional grounding text. Labeled so
// the model knows the provenance.
export function mergeRedditIntoReviewSnippets(
  reviewSnippets: string[],
  reddit: RedditContextResult,
): string[] {
  const labeled = reddit.snippets.map((s) => `[reddit] ${s}`);
  return [...reviewSnippets, ...labeled];
}
