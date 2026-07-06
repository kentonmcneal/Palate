# Classifier Optimization — Discovery-Grade Restaurant Tagging

Goal: make Palate a true discovery engine (Beli-style) — surface unique, novel
food experiences and keep out the brands and captive-venue junk people don't
want to "discover." Committed on `fix/typecheck-cleanup` (commit `1bdac5a`).

All changes are **code-only**. Nothing here has been deployed or run against the
live database — see "How to ship" for the paid steps that still need your go.

## What changed

### 1. Eligibility — what's allowed in the feed (`_shared/classifier.ts`)
- **Chain catalog expanded from 18 → ~150 brands** spanning fast food, fast
  casual (Chipotle, Sweetgreen, Cava…), national coffee/bakery, casual-dining
  sit-down chains (Olive Garden, Cheesecake Factory…), pizza chains, and dessert/
  smoothie chains. Matching is now **normalized whole-phrase** (case/punctuation-
  insensitive, anywhere in the name) so "Downtown Chipotle" and "Chipotle Mexican
  Grill" both get caught — the old code only matched an exact prefix.
- **Captive / hard-to-reach venues excluded**: food courts, airport & stadium/
  arena/convention concessions, and non-restaurant venues (grocery, convenience,
  gas). Trendy **food halls are deliberately kept** — those are destinations.
- **Lounge false-positives fixed**: a bare "…Lounge" restaurant (e.g. "The Aviary
  Lounge") is no longer dropped. Only nightlife/gated lounges (hookah, cigar,
  bottle-service, members/airport clubs) are excluded.
- **Hotel rule fixed**: excludes the hotel itself, but **keeps named hotel
  restaurants** (e.g. "The NoMad Restaurant") — they're real destinations.
- **Regex brittleness fixed**: `pho` no longer matches "Photography"; the airport
  rule no longer fires on "Terminal Market"/ferry terminals.

### 2. Cuisine coverage (`_shared/classifier.ts`)
- Added Filipino, Indonesian, Afghan, Turkish, Lebanese, Brazilian, African,
  and dessert/bagel/bar-and-grill Google types.
- Added `SUBREGION_TO_CUISINE` so a name-only place ("Sichuan Impression") gets
  both a subregion **and** a consistent cuisine — cuisine and subregion can no
  longer disagree.

### 3. Occasion & vibe — telling same-cuisine places apart (biggest lever)
The core insight: three Mediterranean spots can be a party, a casual counter, and
a graduation-dinner destination. They must not be lumped together.
- **New occasion axes**: `party`, `celebration`, `business_dinner`,
  `family_gathering`, `quick_bite` — derived both deterministically from review
  text and by the LLM.
- **Qualitative enrichment decoupled from cuisine uncertainty**
  (`shouldEnrichQualitative`): well-reviewed independents now get vibe/occasion/
  crowd tags too, fixing the old bias where only cuisine-ambiguous places did.
- **Expanded vibe/crowd/menu vocabulary** (romantic, festive, energetic, serene,
  business_crowd, celebratory_groups, chef_driven…).
- **LLM hardening**: controlled-vocabulary validation on every field (no bad
  values can reach the DB at backfill scale), `temperature: 0` for reproducible
  tags, and a prompt that explicitly drives occasion differentiation.

### 4. Reddit enrichment (scaffold only — `_shared/reddit-enrichment.ts`)
Reddit is where people say *who* goes and *why* ("great for a bachelorette,"
"we did my mom's retirement dinner here"). The module gathers occasion/vibe
sentences from Reddit to feed the qualitative classifier. **Not wired into any
live path** — it's cost-bearing (network + LLM) and needs a registered Reddit
app; enable deliberately.

### 5. Tests (`scripts/test-classifier.ts`)
24 behavior tests covering chains, food courts, airports, the lounge edge cases,
hotel restaurants, cuisine fallback, and occasion differentiation. **All pass.**
Run offline: `cd supabase/scripts && npx tsx test-classifier.ts`.
Type-checks clean across all touched files.

## How to ship (paid steps — your explicit go, per CLAUDE.md)

1. **FREE — re-tag existing rows' eligibility & cuisine.** Run the classifier
   backfill *without* `--with-llm`. This applies the new chain/food-court/cuisine
   logic to every restaurant already in the DB. No Google, no LLM, no cost.
2. **PAID — deploy `places-proxy`.** `supabase functions deploy places-proxy`.
   Makes new lookups use the new code (and the qualitative enrichment on the
   details path). Starts Google Places charges on map use. Set a Google Cloud
   budget cap first.
3. **PAID — qualitative backfill (optional but recommended).** Run the backfill
   *with* `--with-llm` (needs `ANTHROPIC_API_KEY`) to populate vibe/occasion/
   crowd tags on existing rows. Cost scales with rows that have review text —
   estimate call volume and approve before running.
4. **LATER — Reddit enrichment.** Register a Reddit app, wire the scaffold into
   the qualitative path, approve the added cost.
