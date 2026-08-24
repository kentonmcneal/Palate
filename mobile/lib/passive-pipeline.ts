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
import { nearbyRestaurants } from "./places";
import { getCachedNearby, setCachedNearby } from "./nearby-cache";

// Qualifying thresholds (spec Phase 3).
const MIN_DWELL_MIN = 20;
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

function isOvernight(hour: number): boolean {
  return hour >= 22 || hour < 6;
}
function isWorkHours(hour: number, weekday: boolean): boolean {
  return weekday && hour >= 9 && hour < 17;
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

function mealWindowBoost(hour: number): number {
  // Small ranking signal, not a hard filter: nudge candidates during meal hours.
  if ((hour >= 6 && hour < 10) || (hour >= 11 && hour < 15) || (hour >= 17 && hour < 22)) return 1;
  return 0;
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
  const eligible = places.filter((p) => p.recommendation_eligibility !== 0);
  const ranked = eligible
    .map((p) => {
      const dist =
        p.latitude != null && p.longitude != null
          ? distanceMeters(raw.lat, raw.lng, p.latitude, p.longitude)
          : RESOLVE_RADIUS_M;
      // Lower score = better. Distance dominates; meal window is a light nudge.
      const score = dist - mealWindowBoost(hour) * 15;
      return { p, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((x) => x.p);

  if (!ranked.length) return null;
  return { raw, candidates: ranked, cacheHit };
}
