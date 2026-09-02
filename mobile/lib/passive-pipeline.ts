// ============================================================================
// passive-pipeline.ts — Phase 3: qualify a raw visit, then resolve it to a venue.
// ----------------------------------------------------------------------------
// A raw CLVisit is just coordinates + a dwell time. Before spending a Google
// Places call we filter hard (dwell window, accuracy, home/work suppression),
// then resolve the survivor to at most 3 candidate restaurants.
//
// PRIVACY: raw coordinates NEVER leave the device. Home/work clusters are held
// only in AsyncStorage and are never transmitted. Only a *confirmed* venue id +
// timestamp reaches the server, and that happens later in saveVisit() (Phase 4).
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RawVisit } from "./passive-capture";
import type { Restaurant } from "./places";
import { supabase } from "./supabase";
import { nearbyRestaurants } from "./places";
import { getCachedNearby, setCachedNearby } from "./nearby-cache";
import { confidenceScore, confidenceBand, type ConfidenceBand } from "./passive-confidence";
import { recordMiss } from "./passive-misses";

// Qualifying thresholds (spec Phase 3).
// Five minutes. A sit-down meal and a Shake Shack counter order are both real
// signals, and the confirmation step absorbs the false positives a short floor
// lets through — a dismissed prompt costs a tap, a missed meal costs the entire
// premise of the feature.
const MIN_DWELL_MIN = 5;
const MAX_DWELL_MIN = 240; // 4 hours
const MAX_ACCURACY_M = 100;
const RESOLVE_RADIUS_M = 75;

// Significant-change fixes are far coarser than a CLVisit centroid — a few
// hundred metres is normal. Judging them by the CLVisit thresholds would reject
// every one, so each source gets its own bounds. The wider search radius means
// more candidates, which is acceptable: resolution already returns a top-3 and
// the user confirms the venue, so a coarse fix costs an extra tap, not a wrong
// entry in their diary.
const SLC_MAX_ACCURACY_M = 500;
const SLC_RESOLVE_RADIUS_M = 300;

// Only the legacy significant-change source is coarse. "stop" records are
// emitted alongside a one-shot high-accuracy fix, so they earn the same tight
// bounds as CLVisit — which is what lets us name one restaurant instead of
// offering a neighbourhood.
function accuracyBound(raw: RawVisit): number {
  return raw.source === "slc" ? SLC_MAX_ACCURACY_M : MAX_ACCURACY_M;
}

export function resolveRadius(raw: RawVisit): number {
  return raw.source === "slc" ? SLC_RESOLVE_RADIUS_M : RESOLVE_RADIUS_M;
}

// Home/work suppression tuning.
const CLUSTER_HISTORY_KEY = "palate.passive.clusterHistory";
const CLUSTER_RADIUS_M = 60;
const CLUSTER_MIN_HITS = 3;
const CACHE_STATS_KEY = "palate.passive.cacheStats";

export type QualifyOutcome =
  | { ok: true; dwellMin: number }
  | {
      ok: false;
      reason: "open-visit" | "dwell-too-short" | "dwell-too-long" | "low-accuracy" | "home-work-suppressed";
    };

export type ResolvedVisit = {
  raw: RawVisit;
  candidates: Restaurant[];
  cacheHit: boolean;
  /** Confidence in the TOP candidate, 0-1. Drives pre-check and prompt gating.
   *  Optional because objects built before scoring existed still flow through
   *  the inbox. */
  confidence?: number;
  confidenceBand?: ConfidenceBand;
};

export function dwellMinutes(raw: RawVisit): number | null {
  if (raw.arrivalAt == null || raw.departureAt == null) return null;
  return (raw.departureAt - raw.arrivalAt) / 60000;
}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ----------------------------------------------------------------------------
// Home/work suppression — on-device clustering of recurring locations.
// A place is suppressed if we've seen >= CLUSTER_MIN_HITS prior visits within
// CLUSTER_RADIUS_M whose times skew overnight (home) or weekday-daytime (work).
// ----------------------------------------------------------------------------

type ClusterPoint = { lat: number; lng: number; hour: number; weekday: boolean };

async function loadClusterHistory(): Promise<ClusterPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(CLUSTER_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as ClusterPoint[]) : [];
  } catch {
    return [];
  }
}

/** Record a raw visit centroid into the on-device clustering history (capped). */
export async function recordForClustering(raw: RawVisit): Promise<void> {
  const when = new Date(raw.arrivalAt ?? raw.capturedAt);
  const point: ClusterPoint = {
    lat: raw.lat,
    lng: raw.lng,
    hour: when.getHours(),
    weekday: when.getDay() >= 1 && when.getDay() <= 5,
  };
  const history = await loadClusterHistory();
  history.push(point);
  // Keep the most recent 500 points — plenty to learn home/work, bounded storage.
  const trimmed = history.slice(-500);
  await AsyncStorage.setItem(CLUSTER_HISTORY_KEY, JSON.stringify(trimmed));
}

const LUNCH_START_HOUR = 11;
const LUNCH_END_HOUR = 15;

function isOvernight(hour: number): boolean {
  return hour >= 22 || hour < 6;
}
// Weekday desk hours MINUS the lunch window. The exclusion is the whole point:
// a 9-17 test swallows lunch, so eating at the same weekday spot three times
// used to classify it as the user's workplace and suppress it permanently.
// That silently killed exactly the restaurants someone visits most.
//
// A real workplace still accumulates evidence easily — arrivals, afternoons,
// anything outside 11:00-15:00 — while a lunch habit no longer counts against
// itself.
export function isWorkHours(hour: number, weekday: boolean): boolean {
  if (!weekday) return false;
  if (hour >= LUNCH_START_HOUR && hour < LUNCH_END_HOUR) return false;
  return hour >= 9 && hour < 17;
}

export async function isHomeOrWorkSuppressed(raw: RawVisit): Promise<boolean> {
  const history = await loadClusterHistory();
  const near = history.filter((p) => distanceMeters(raw.lat, raw.lng, p.lat, p.lng) <= CLUSTER_RADIUS_M);
  if (near.length < CLUSTER_MIN_HITS) return false;
  const overnight = near.filter((p) => isOvernight(p.hour)).length;
  const work = near.filter((p) => isWorkHours(p.hour, p.weekday)).length;
  // If the recurring cluster is dominated by sleep hours or the 9–5 weekday
  // block, treat it as home/work and suppress.
  return overnight >= CLUSTER_MIN_HITS || work >= CLUSTER_MIN_HITS;
}

// ----------------------------------------------------------------------------
// Qualification
// ----------------------------------------------------------------------------

export async function qualifyVisit(raw: RawVisit): Promise<QualifyOutcome> {
  const dwell = dwellMinutes(raw);
  if (dwell == null) return { ok: false, reason: "open-visit" };
  if (dwell < MIN_DWELL_MIN) return { ok: false, reason: "dwell-too-short" };
  if (dwell > MAX_DWELL_MIN) return { ok: false, reason: "dwell-too-long" };
  if (raw.horizontalAccuracy > accuracyBound(raw)) return { ok: false, reason: "low-accuracy" };
  if (await isHomeOrWorkSuppressed(raw)) return { ok: false, reason: "home-work-suppressed" };
  return { ok: true, dwellMin: dwell };
}

// ----------------------------------------------------------------------------
// Resolution — cache-first, food-filtered, top-3, meal-window weighted ranking.
// ----------------------------------------------------------------------------

async function bumpCacheStats(hit: boolean): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_STATS_KEY);
    const s = raw ? (JSON.parse(raw) as { hits: number; total: number }) : { hits: 0, total: 0 };
    s.total += 1;
    if (hit) s.hits += 1;
    await AsyncStorage.setItem(CACHE_STATS_KEY, JSON.stringify(s));
  } catch {
    // stats are best-effort
  }
}

export async function getCacheHitRate(): Promise<{ hits: number; total: number; rate: number }> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_STATS_KEY);
    const s = raw ? (JSON.parse(raw) as { hits: number; total: number }) : { hits: 0, total: 0 };
    return { ...s, rate: s.total ? s.hits / s.total : 0 };
  } catch {
    return { hits: 0, total: 0, rate: 0 };
  }
}

type MealWindow = "breakfast" | "lunch" | "dinner" | "off";

export function mealWindow(hour: number): MealWindow {
  if (hour >= 6 && hour < 10) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 17 && hour < 22) return "dinner";
  return "off";
}

// Types that suit a given meal. Breakfast at a bakery or cafe is far likelier
// than breakfast at a bar; dinner is the reverse.
const MEAL_TYPE_HINTS: Record<MealWindow, string[]> = {
  breakfast: ["bakery", "cafe", "coffee_shop", "breakfast_restaurant", "brunch_restaurant"],
  lunch: ["sandwich_shop", "fast_food_restaurant", "cafe", "deli", "restaurant"],
  dinner: ["restaurant", "bar", "steak_house", "fine_dining_restaurant", "pizza_restaurant"],
  off: [],
};

// Scores are in METRES, so every signal is expressed as "how much closer would
// this place have to be for distance alone to justify picking it". That keeps
// the weights arguable in concrete terms instead of as opaque constants.
export const RANK_WEIGHTS = {
  /** You return to places you like; a place you've been to before is a strong prior. */
  visited: 45,
  /** A busy venue is likelier than the quiet office suite sharing its wall. */
  popularityMax: 25,
  /** Type suits the time of day. */
  mealFit: 20,
};

function popularityBoost(count: number | null | undefined): number {
  if (!count || count <= 0) return 0;
  // Log-scaled and capped: the gap between 10 and 100 reviews should matter far
  // more than the gap between 5,000 and 50,000.
  return Math.min(RANK_WEIGHTS.popularityMax, Math.log10(count) * 8);
}

function mealFitBoost(place: Restaurant, window: MealWindow): number {
  if (window === "off") return 0;
  const hints = MEAL_TYPE_HINTS[window];
  const types = [place.primary_type, ...(place.types ?? [])].filter(Boolean) as string[];
  return types.some((t) => hints.includes(t)) ? RANK_WEIGHTS.mealFit : 0;
}

/**
 * Which of these places the user has already logged. Scoped to the candidate
 * ids so it stays a small query, and failure-tolerant: losing this signal
 * should degrade ranking, never drop a detected visit.
 */
async function visitedPlaceIdsAmong(placeIds: string[]): Promise<Set<string>> {
  if (!placeIds.length) return new Set();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Set();

    // Two bounded queries rather than one unbounded one. Selecting every visit
    // and filtering client-side would pull a heavy user's entire history over
    // the network on every detected stop — in the background, on cellular.
    // Both queries here are capped by the candidate count (at most a handful).
    const { data: rests } = await supabase
      .from("restaurants")
      .select("id, google_place_id")
      .in("google_place_id", placeIds);
    const rows = (rests ?? []) as Array<{ id: string; google_place_id: string }>;
    if (!rows.length) return new Set();

    const byId = new Map(rows.map((r) => [r.id, r.google_place_id]));
    const { data: visits } = await supabase
      .from("visits")
      .select("restaurant_id")
      .eq("user_id", user.id)
      .in("restaurant_id", rows.map((r) => r.id));

    const out = new Set<string>();
    for (const v of (visits ?? []) as Array<{ restaurant_id: string }>) {
      const placeId = byId.get(v.restaurant_id);
      if (placeId) out.add(placeId);
    }
    return out;
  } catch {
    return new Set();
  }
}

// ----------------------------------------------------------------------------
// Loggability
// ----------------------------------------------------------------------------
//
// recommendation_eligibility answers "should we RECOMMEND this place?".
// Passive capture asks a different question: "did you eat here?" — and the
// answers diverge. Chipotle and Shake Shack are deliberately eligibility 0 so
// the gems-first recommender never suggests them, but they are absolutely
// places people eat, and a food diary that silently refuses to log them is
// broken.
//
// So we do NOT reuse the eligibility flag as a logging filter. We drop only
// the venues where eating is not the plausible reason for the stop.
//
// Verified against classifier.ts rather than assumed: every eligibility-0
// branch there sets one of these reasons ("event_venue" and
// "non_food_primary_type" are assigned through a variable, so they do not
// appear in a naive grep for the literal).
const NOT_A_DINING_STOP = new Set([
  // Not food at all.
  "not_a_food_venue",
  "not_a_restaurant",
  "non_food_primary_type",
  "event_venue",
  // Captive venues: a stop here is transit or a stay, not a chosen meal, and
  // prompting about them is noise.
  "airport",
  "captive_venue",
  "lounge_gated",
  "hotel",
  "hotel_generic",
]);

/**
 * Whether a venue is worth asking "did you eat here?" about.
 *
 * Deliberately generous. A wrong candidate costs the user one tap on a prompt
 * they dismiss; a missing one costs the entire premise of passive capture. So
 * fast food, chains, food courts and bars all stay — they are excluded from
 * recommendations, not from reality.
 */
export function isLoggableVenue(p: Restaurant): boolean {
  if (p.recommendation_eligibility !== 0) return true;
  // Hard-rejected with no reason recorded: unknown provenance, leave it out.
  if (!p.ineligibility_reason) return false;
  return !NOT_A_DINING_STOP.has(p.ineligibility_reason);
}

export type RankContext = {
  hour: number;
  /** google_place_ids the user has already logged a visit to. */
  visitedPlaceIds?: Set<string>;
};

/**
 * Rank nearby candidates for a detected stop. Pure and exported so the tuning
 * decisions are testable with fixtures rather than only observable in the field.
 *
 * Lower score wins. Distance dominates — it is the only direct evidence — and
 * every other signal is a discount measured in metres.
 */
export function rankCandidates(
  raw: { lat: number; lng: number },
  places: Restaurant[],
  ctx: RankContext,
): Restaurant[] {
  const window = mealWindow(ctx.hour);
  return places
    .map((p) => {
      const dist =
        p.latitude != null && p.longitude != null
          ? distanceMeters(raw.lat, raw.lng, p.latitude, p.longitude)
          : RESOLVE_RADIUS_M;
      const visited = ctx.visitedPlaceIds?.has(p.google_place_id) ? RANK_WEIGHTS.visited : 0;
      const score = dist - visited - popularityBoost(p.user_rating_count) - mealFitBoost(p, window);
      return { p, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((x) => x.p);
}

/** Resolve a qualified raw visit to its top candidate restaurants (cache-first). */
export async function resolveVenue(raw: RawVisit): Promise<ResolvedVisit | null> {
  const radius = resolveRadius(raw);
  const cached = await getCachedNearby(raw.lat, raw.lng, radius);
  let places: Restaurant[];
  let cacheHit: boolean;
  if (cached) {
    places = cached;
    cacheHit = true;
  } else {
    places = await nearbyRestaurants(raw.lat, raw.lng, radius);
    cacheHit = false;
    void setCachedNearby(raw.lat, raw.lng, radius, places);
  }
  void bumpCacheStats(cacheHit);

  const hour = new Date(raw.departureAt ?? raw.capturedAt).getHours();
  const eligible = places.filter(isLoggableVenue);
  const ranked = rankCandidates(raw, eligible, {
    hour,
    visitedPlaceIds: await visitedPlaceIdsAmong(eligible.map((p) => p.google_place_id)),
  });

  if (!ranked.length) {
    // Record WHY, not just that. "It never fires here" was unfalsifiable
    // before this: the detection resolved to nothing and left no trace.
    const reason = places.length === 0
      ? "no_places_returned"
      : eligible.length === 0
        ? "all_filtered_out"
        : "ranked_empty";
    void recordMiss({
      at: Date.now(),
      reason,
      placesFound: places.length,
      loggableCount: eligible.length,
      radiusM: radius,
      accuracyM: raw.horizontalAccuracy ?? null,
      dwellMin: raw.departureAt && raw.capturedAt
        ? Math.round((raw.departureAt - raw.capturedAt) / 60_000)
        : null,
      source: raw.source ?? null,
      rejectedSample: places
        .filter((p) => !isLoggableVenue(p))
        .slice(0, 5)
        .map((p) => p.name),
    });
    return null;
  }
  // Score the top candidate. candidateCount is the ambiguity measure — how many
  // plausible venues were in range, not how many we chose to show.
  const visited = await visitedPlaceIdsAmong([ranked[0].google_place_id]);
  const confidence = confidenceScore({
    dwellMin: dwellMinutes(raw) ?? 0,
    accuracyM: raw.horizontalAccuracy,
    candidateCount: eligible.length,
    hour,
    place: ranked[0],
    visitedBefore: visited.has(ranked[0].google_place_id),
  });

  return { raw, candidates: ranked, cacheHit, confidence, confidenceBand: confidenceBand(confidence) };
}
