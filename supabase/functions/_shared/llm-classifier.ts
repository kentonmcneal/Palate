// Palate classifier — LLM fallback (Claude Haiku 4.5).
//
// Fires when the deterministic rule engine returns null or low-confidence
// values for cuisine. The LLM gets the Google-place data plus any cached
// review snippets / editorial summary, and returns suggestions in the same
// controlled vocabulary the rules use.
//
// This module has zero runtime imports — the caller supplies an Anthropic-
// like `messages.create` callable. That lets the same code run under Deno
// (places-proxy edge function, via `npm:@anthropic-ai/sdk`) and Node (eval
// harness, via `@anthropic-ai/sdk` installed locally).

import {
  type ConfidenceMap,
  type DerivedClassification,
  SUBREGION_TO_CUISINE,
} from "./classifier.ts";

// ----- Public types -----------------------------------------------------

export interface LLMInput {
  name: string;
  types: string[];
  primaryType: string | null;
  priceLevel: number | null;
  userRatingCount: number | null;
  neighborhood?: string | null;
  editorialSummary?: string | null;
  reviewSnippets?: string[];
}

export interface LLMSuggestion {
  cuisine_type: string | null;
  cuisine_subregion: string | null;
  cuisine_region: string | null;
  format_class: string | null;
  cultural_context: string | null;
  flavor_tags: string[];
  occasion_tags: string[];
  // Qualitative "feel" tags — the attributes Google can't express. These are
  // LLM-only (the rule engine has no source for them).
  vibe: string | null;
  crowd_energy: string[];
  menu_style: string | null;
  price_feel: string | null;
  ambiance_notes: string | null;
  confidence: ConfidenceMap;
  reasoning: string;
}

// Structural type of the Anthropic SDK `messages.create` method. Avoids
// importing the SDK so this module stays runtime-agnostic.
export interface AnthropicMessageCreate {
  (params: {
    model: string;
    max_tokens: number;
    temperature?: number;
    system: Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral" };
    }>;
    messages: Array<{ role: "user"; content: string }>;
  }): Promise<{
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  }>;
}

// ----- When to invoke the LLM -------------------------------------------

// Caller policy: fire the LLM when the rules left cuisine null or below
// `threshold` confidence, OR subregion below the same threshold. Keep the
// threshold modest (~0.7) so we only pay for ambiguous cases.
export function shouldUseLLM(
  c: DerivedClassification,
  threshold = 0.7,
): boolean {
  if (c.cuisine_type === null) return true;
  if ((c.confidence.cuisine_type ?? 0) < threshold) return true;
  if ((c.confidence.cuisine_subregion ?? 0) < threshold) return true;
  return false;
}

// Should we call the LLM to fill the qualitative "feel" tags (vibe, occasion,
// crowd, price_feel, ambiance)? These live in the reviews, so the gate is
// simply "is there enough text to read a room from," INDEPENDENT of whether
// cuisine was certain. This fixes the old selection bias where only
// cuisine-ambiguous places ever got feel tags — meaning the best, clearly-
// classified independents shipped with null vibe. Callers should fire the LLM
// when shouldUseLLM(derived) OR shouldEnrichQualitative(input) is true.
export function shouldEnrichQualitative(input: {
  editorialSummary?: string | null;
  reviewSnippets?: string[];
}): boolean {
  const reviewChars = (input.reviewSnippets ?? []).join(" ").length;
  const hasEditorial = !!input.editorialSummary && input.editorialSummary.length > 30;
  // Need real prose to ground vibe/occasion: an editorial blurb, or at least
  // two review snippets worth of text.
  return hasEditorial || (input.reviewSnippets ?? []).length >= 2 || reviewChars >= 200;
}

// ----- Merging LLM suggestions back into the deterministic result -------

// Take rule-output and LLM-output; for each scalar field, keep whichever has
// higher confidence. Tags from the LLM merge additively (de-duped). The
// final confidence map records the winning score per field.
export function mergeLLMIntoDerivation(
  base: DerivedClassification,
  llm: LLMSuggestion,
): DerivedClassification {
  const pick = <K extends keyof DerivedClassification & keyof LLMSuggestion>(
    field: K,
  ): { value: DerivedClassification[K]; confidence: number } => {
    const baseConf = (base.confidence[field as keyof ConfidenceMap] ?? 0);
    const llmConf = (llm.confidence[field as keyof ConfidenceMap] ?? 0);
    const llmVal = llm[field];
    const baseVal = base[field];
    if (llmVal != null && llmConf > baseConf) {
      return { value: llmVal as DerivedClassification[K], confidence: llmConf };
    }
    return { value: baseVal, confidence: baseConf };
  };

  const cuisine = pick("cuisine_type");
  const subregion = pick("cuisine_subregion");
  const region = pick("cuisine_region");
  const format = pick("format_class");
  const cultural = pick("cultural_context");

  const flavor = Array.from(new Set([...base.flavor_tags, ...llm.flavor_tags]));
  const occasion = Array.from(new Set([...base.occasion_tags, ...llm.occasion_tags]));
  const crowd = Array.from(new Set([...base.crowd_energy, ...llm.crowd_energy]));

  return {
    cuisine_type: cuisine.value,
    cuisine_subregion: subregion.value,
    cuisine_region: region.value,
    format_class: format.value as string,
    chain_name: base.chain_name,
    chain_type: base.chain_type,
    cultural_context: cultural.value as string,
    flavor_tags: flavor,
    occasion_tags: occasion,
    // Qualitative tags are LLM-only — the deterministic base always carries
    // nulls/empties here, so the LLM value wins (falling back to base if the
    // LLM declined to tag the field).
    vibe: llm.vibe ?? base.vibe,
    crowd_energy: crowd,
    menu_style: llm.menu_style ?? base.menu_style,
    price_feel: llm.price_feel ?? base.price_feel,
    ambiance_notes: llm.ambiance_notes ?? base.ambiance_notes,
    tags: base.tags,
    // Eligibility is computed from chain_type/format_class/etc., which the
    // LLM doesn't override. Carry base values through.
    recommendation_eligibility: base.recommendation_eligibility,
    ineligibility_reason: base.ineligibility_reason,
    confidence: {
      cuisine_type: cuisine.confidence,
      cuisine_subregion: subregion.confidence,
      cuisine_region: region.confidence,
      format_class: format.confidence,
      chain_type: base.confidence.chain_type,
      cultural_context: cultural.confidence,
    },
  };
}

// ----- The LLM call -----------------------------------------------------

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Static system prompt, marked cache_control ephemeral so a backfill (many
// calls inside the 5-min TTL) can reuse the prefix.
// NOTE: Haiku 4.5's minimum cacheable prefix is ~4096 tokens. This prompt is
// currently below that, so the cache_control is effectively a no-op today — it
// activates automatically only if the prompt grows past that threshold.
// Confirm with count_tokens before relying on the discount; the classifier is
// cheap per-call regardless (~$0.0015 input on Haiku), so this is a minor point.
const SYSTEM_PROMPT = `You classify restaurants from Google Places metadata into a Palate-defined vocabulary.

OUTPUT FORMAT (return ONLY a single JSON object, no prose):
{
  "cuisine_type": one of [american, italian, chinese, japanese, korean, thai, vietnamese, indian, filipino, indonesian, mexican, latin-american, caribbean, african, mediterranean, middle-eastern, french, spanish, steakhouse, seafood, bbq, brunch, healthy, dessert, bakery, café, bar] or null,
  "cuisine_subregion": one of [memphis_bbq, kc_bbq, texas_bbq, nashville_hot, cajun, soul_food, korean_bbq, korean, japanese_ramen, japanese_sushi, japanese_izakaya, japanese, chinese_szechuan, chinese_cantonese, chinese_xian, taiwanese, chinese, vietnamese_pho, vietnamese_banh_mi, vietnamese, thai, indian_south, pakistani, bangladeshi, indian_north, halal_cart, persian, lebanese, israeli, turkish, middle_eastern, greek, moroccan, mediterranean_general, italian_neapolitan, italian_trattoria, italian_pizzeria, italian_general, mexican_taqueria, mexican_regional, mexican, peruvian, brazilian, argentine, cuban, dominican, puerto_rican, jamaican, trinidadian, haitian, ethiopian, nigerian, senegalese, american_diner, deli_jewish, pizza_nyc, pizza_chicago, breakfast_diner, burger, bodega_food, wine_bar_food, steakhouse, seafood_house, bbq_general, brunch_modern, café] or null,
  "cuisine_region": one of [american, southern_us, east_asian, south_asian, middle_eastern, mediterranean, italian, latin_american, caribbean, african, european, café_culture] or null,
  "format_class": one of [bar, wine_bar, café, fine_dining, casual_dining, fast_casual, quick_service, ghost_kitchen] or null,
  "cultural_context": one of [comfort, modernist, heritage, hidden, trending, fusion] or null,
  "flavor_tags": array (any of [smoky, spicy, savory, umami, sweet, fresh, rich, light, char]),
  "occasion_tags": array (any of [date_night, group_dinner, casual_solo, brunch, late_night, breakfast, working_lunch, weekend_anchor, celebration, business_dinner, party, family_gathering, quick_bite]),
  "vibe": one of [chill, upscale_casual, upscale_formal, lively, intimate, dive, trendy, romantic, energetic, serene, festive] or null,
  "crowd_energy": array of 0-3 (any of [young_professionals, college, neighborhood_regulars, tourist_heavy, diverse, family_friendly, industry_crowd, date_crowd, celebratory_groups, business_crowd]),
  "menu_style": one of [small_plates, comfort_food, tasting_menu, street_food_inspired, classic_american, globally_inspired, bar_food, chef_driven, shareable] or null,
  "price_feel": one of [great_value, fair, splurge_worthy] or null,
  "ambiance_notes": a single sentence (max 15 words) capturing anything distinctive, or null,
  "confidence": object with float 0..1 keys cuisine_type, cuisine_subregion, cuisine_region, format_class, cultural_context. Use 0 when you have no signal, 0.95 when the data is unambiguous,
  "reasoning": one short sentence on what tipped the call
}

RULES:
- Use only the vocabulary above. Do not invent values.
- Return null + confidence 0 when you genuinely don't know — guessing hurts users.
- Subregion must be consistent with cuisine_type. E.g., chinese_szechuan only when cuisine_type is "chinese".
- The restaurant name alone is sometimes diagnostic ("Sichuan Impression", "Joe's Pizza"). Use it.
- If review snippets or editorial summary are provided, weigh them heavily — they reflect what the place actually serves.
- Confidence above 0.85 should be reserved for cases where the name, types, or reviews are unmistakable.

QUALITATIVE TAGS (vibe, crowd_energy, menu_style, price_feel, ambiance_notes, occasion_tags):
- These capture what Google can't: atmosphere, who's in the room, how the menu eats, and perceived value. They are the heart of Palate.
- Ground them in the review snippets and editorial summary first — that is where vibe and crowd actually live.
- For a widely-known restaurant you genuinely recognize, or one with a very high review count, you MAY also draw on its well-established reputation to fill vibe/occasion when the snippets are thin — but only for what is genuinely well-known, and never invent specific details you can't support.
- Neighborhood is soft context: a dense nightlife/downtown district leans lively/party, a quiet residential strip leans chill/neighborhood — use it to nudge, never as the sole basis for a tag.
- Stay honest: return null (and [] for arrays) for any qualitative field you can't support from either the text or genuine knowledge of the place. A wrong vibe is worse than a missing one — but a vibe you confidently know, left blank, is a missed signal.
- price_feel is about value, not absolute price: a $$$ place reviewers call "worth every penny" is splurge_worthy; a $$ place that "punches above its price" is great_value.
- ambiance_notes must be grounded in the provided text — one concrete, specific sentence, never generic filler. If nothing distinctive is stated, return null.

OCCASION IS THE MOST IMPORTANT DIFFERENTIATOR. Two restaurants of the SAME cuisine can be completely different experiences, and Palate lives or dies on telling them apart. A Mediterranean spot that reviewers describe as loud, packed, hookah-and-cocktails is a "party" place (vibe: festive/energetic). One with white tablecloths where people book graduation and anniversary dinners is "celebration"/"business_dinner" (vibe: upscale_formal/serene). A neighborhood counter spot is "casual_solo"/"quick_bite" (vibe: chill). Read the reviews for WHO goes and WHY:
- occasion_tags: pick every occasion the reviews genuinely support (a place can be both date_night and celebration). Use "party" for loud/nightlife/see-and-be-seen energy; "business_dinner" for client/work/impress-the-table dining; "celebration" for special-occasion/milestone dining; "date_night" for romantic/intimate; "family_gathering" for kid-friendly group meals; "quick_bite" for grab-and-go.
- Let vibe and occasion agree: festive/energetic pairs with party; upscale_formal/serene pairs with business_dinner/celebration; romantic/intimate pairs with date_night; chill pairs with casual_solo.
- If the reviews describe a clear scene/energy, DO commit to the occasion and vibe — this is exactly the signal users want. Only abstain when the text is genuinely silent on atmosphere.`;

function buildUserMessage(input: LLMInput): string {
  const lines: string[] = [];
  lines.push(`Name: ${input.name}`);
  lines.push(`Google types: ${input.types.join(", ") || "(none)"}`);
  lines.push(`Primary type: ${input.primaryType ?? "(none)"}`);
  lines.push(`Price level: ${input.priceLevel ?? "unknown"} (0=free .. 4=very expensive)`);
  lines.push(`Review count: ${input.userRatingCount ?? "unknown"}`);
  lines.push(`Neighborhood: ${input.neighborhood ?? "unknown"}`);
  if (input.editorialSummary) {
    lines.push(`Editorial summary: ${input.editorialSummary}`);
  }
  if (input.reviewSnippets && input.reviewSnippets.length > 0) {
    lines.push(`Review snippets:`);
    for (const s of input.reviewSnippets.slice(0, 5)) {
      lines.push(`  - "${s.slice(0, 240)}"`);
    }
  }
  lines.push(`\nReturn the JSON.`);
  return lines.join("\n");
}

// Controlled vocabulary — the ONLY values allowed to reach the database. Any
// scalar the LLM returns outside its set is dropped to null; any array member
// outside its set is filtered out. This is what prevents vocabulary drift when
// the backfill writes LLM output across the whole table. Keep in sync with the
// SYSTEM_PROMPT enums above.
export const VOCAB = {
  cuisine_type: new Set([
    "american", "italian", "chinese", "japanese", "korean", "thai",
    "vietnamese", "indian", "filipino", "indonesian", "mexican",
    "latin-american", "caribbean", "african", "mediterranean",
    "middle-eastern", "french", "spanish", "steakhouse", "seafood", "bbq",
    "brunch", "healthy", "dessert", "bakery", "café", "bar",
  ]),
  cuisine_region: new Set([
    "american", "southern_us", "east_asian", "south_asian", "middle_eastern",
    "mediterranean", "italian", "latin_american", "caribbean", "african",
    "european", "café_culture",
  ]),
  format_class: new Set([
    "bar", "wine_bar", "café", "fine_dining", "casual_dining", "fast_casual",
    "quick_service", "ghost_kitchen",
  ]),
  cultural_context: new Set([
    "comfort", "modernist", "heritage", "hidden", "trending", "fusion",
  ]),
  flavor_tags: new Set([
    "smoky", "spicy", "savory", "umami", "sweet", "fresh", "rich", "light", "char",
  ]),
  occasion_tags: new Set([
    "date_night", "group_dinner", "casual_solo", "brunch", "late_night",
    "breakfast", "working_lunch", "weekend_anchor", "celebration",
    "business_dinner", "party", "family_gathering", "quick_bite",
  ]),
  vibe: new Set([
    "chill", "upscale_casual", "upscale_formal", "lively", "intimate", "dive",
    "trendy", "romantic", "energetic", "serene", "festive",
  ]),
  crowd_energy: new Set([
    "young_professionals", "college", "neighborhood_regulars", "tourist_heavy",
    "diverse", "family_friendly", "industry_crowd", "date_crowd",
    "celebratory_groups", "business_crowd",
  ]),
  menu_style: new Set([
    "small_plates", "comfort_food", "tasting_menu", "street_food_inspired",
    "classic_american", "globally_inspired", "bar_food", "chef_driven", "shareable",
  ]),
  price_feel: new Set(["great_value", "fair", "splurge_worthy"]),
} as const;

// cuisine_subregion is validated against the SUBREGION_TO_CUISINE keys (plus a
// couple of subregions not in that map), imported lazily to avoid a cycle.
const clampScalar = (v: unknown, set: ReadonlySet<string>): string | null =>
  typeof v === "string" && set.has(v) ? v : null;

const clampArray = (v: unknown, set: ReadonlySet<string>): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && set.has(x)) : [];

// Defensive parse — the LLM should return clean JSON, but allow for a
// leading fence ```json or trailing whitespace, and clamp every field to the
// controlled vocabulary before it can be persisted.
function parseResponse(text: string): LLMSuggestion {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const obj = JSON.parse(cleaned);
  const cuisine = clampScalar(obj.cuisine_type, VOCAB.cuisine_type);
  const subregion = typeof obj.cuisine_subregion === "string" ? obj.cuisine_subregion : null;
  return {
    cuisine_type: cuisine,
    // subregion must be a known subregion AND consistent with cuisine_type
    // (if both present). Inconsistent pairs drop the subregion.
    cuisine_subregion: subregion && SUBREGION_TO_CUISINE[subregion]
      && (cuisine === null || SUBREGION_TO_CUISINE[subregion] === cuisine)
      ? subregion : null,
    cuisine_region: clampScalar(obj.cuisine_region, VOCAB.cuisine_region),
    format_class: clampScalar(obj.format_class, VOCAB.format_class),
    cultural_context: clampScalar(obj.cultural_context, VOCAB.cultural_context),
    flavor_tags: clampArray(obj.flavor_tags, VOCAB.flavor_tags),
    occasion_tags: clampArray(obj.occasion_tags, VOCAB.occasion_tags),
    vibe: clampScalar(obj.vibe, VOCAB.vibe),
    crowd_energy: clampArray(obj.crowd_energy, VOCAB.crowd_energy).slice(0, 3),
    menu_style: clampScalar(obj.menu_style, VOCAB.menu_style),
    price_feel: clampScalar(obj.price_feel, VOCAB.price_feel),
    ambiance_notes: typeof obj.ambiance_notes === "string" && obj.ambiance_notes.trim()
      ? obj.ambiance_notes.trim().split(/\s+/).slice(0, 20).join(" ")
      : null,
    confidence: typeof obj.confidence === "object" && obj.confidence ? obj.confidence : {},
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
  };
}

export async function classifyWithLLM(
  input: LLMInput,
  create: AnthropicMessageCreate,
): Promise<LLMSuggestion> {
  const resp = await create({
    model: HAIKU_MODEL,
    // Headroom so a fuller tag set + reasoning can't get truncated mid-JSON —
    // parseResponse throws on invalid JSON, which would drop the enrichment.
    max_tokens: 768,
    // Deterministic tags: the same restaurant should classify the same way on
    // every run, so a backfill doesn't scatter inconsistent vibe/ambiance.
    temperature: 0,
    system: [{
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    }],
    messages: [{ role: "user", content: buildUserMessage(input) }],
  });
  const textBlock = resp.content.find((c) => c.type === "text");
  if (!textBlock?.text) {
    throw new Error("LLM returned no text block");
  }
  return parseResponse(textBlock.text);
}
