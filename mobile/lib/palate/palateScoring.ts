// ============================================================================
// palateScoring.ts — single source of truth for the Palate identity system.
// ----------------------------------------------------------------------------
// Pipeline:
//   1. Build UserWeeklyData from the existing TasteVector (adapter)
//   2. Compute noveltyScore + premiumScore (formulas from spec)
//   3. Apply 70/30 smoothing vs. last week (from AsyncStorage)
//   4. Classify into Curator/Forager/Steward/Anchor (or Learning if <4 visits)
//   5. Tag with non-exclusive secondary signals (top 3-4)
//   6. Compose explanation + behavior signals
//
// Every UI surface that needs identity should call:
//   getUserPalateProfile(userWeeklyData)
// or for one-shot from a TasteVector:
//   getProfileFromVector(vector)
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TasteVector } from "../taste-vector";
import type {
  PrimaryIdentity, PalateProfile, UserWeeklyData, Confidence,
} from "./palateTypes";
import { deriveTags } from "./palateTags";
import { composeExplanation, composeBehaviorSignals, composeMovement } from "./palateCopy";

// ----------------------------------------------------------------------------
// SCORING CONSTANTS — match spec exactly.
// ----------------------------------------------------------------------------
const NOVELTY_WEIGHTS = {
  newPlaceRate: 0.35,
  cuisineDiversity: 0.25,
  neighborhoodDiversity: 0.20,
  oneMinusRepeat: 0.20,
};

const PREMIUM_WEIGHTS = {
  normalizedPriceLevel: 0.45,
  independentRestaurantRate: 0.20,
  reservationOrOccasionSignal: 0.20,
  elevatedCategorySignal: 0.15,
};

const THRESHOLD = 0.55;
// Within ±SOFT_BAND of the threshold → middle user, soft language
const SOFT_BAND = 0.10;
// Smoothing factor — current week weight (prior week gets 1 - this)
const SMOOTHING_CURRENT = 0.70;
// Min visits before we classify; below this → Learning state
const MIN_VISITS_FOR_CLASSIFY = 4;

// ----------------------------------------------------------------------------
// RAW SCORING — pure functions, easy to unit test.
// ----------------------------------------------------------------------------

export function computeNoveltyScore(d: UserWeeklyData): number {
  const raw =
    NOVELTY_WEIGHTS.newPlaceRate * d.newPlaceRate +
    NOVELTY_WEIGHTS.cuisineDiversity * d.cuisineDiversity +
    NOVELTY_WEIGHTS.neighborhoodDiversity * d.neighborhoodDiversity +
    NOVELTY_WEIGHTS.oneMinusRepeat * (1 - d.repeatRate);
  return clamp01(raw);
}

export function computePremiumScore(d: UserWeeklyData): number {
  const raw =
    PREMIUM_WEIGHTS.normalizedPriceLevel * d.normalizedPriceLevel +
    PREMIUM_WEIGHTS.independentRestaurantRate * d.independentRestaurantRate +
    PREMIUM_WEIGHTS.reservationOrOccasionSignal * d.reservationOrOccasionSignal +
    PREMIUM_WEIGHTS.elevatedCategorySignal * d.elevatedCategorySignal;
  return clamp01(raw);
}

export function classify(novelty: number, premium: number): PrimaryIdentity {
  if (novelty >= THRESHOLD && premium >= THRESHOLD) return "Curator";
  if (novelty >= THRESHOLD && premium < THRESHOLD) return "Forager";
  if (novelty < THRESHOLD && premium >= THRESHOLD) return "Steward";
  return "Anchor";
}

/** Returns the secondary identity ONLY if we're in the soft band on EITHER axis.
 *  Used to render "leaned X with Y tendencies" copy for middle users. */
export function classifySecondary(novelty: number, premium: number): PrimaryIdentity | undefined {
  const noveltyBand = Math.abs(novelty - THRESHOLD) < SOFT_BAND;
  const premiumBand = Math.abs(premium - THRESHOLD) < SOFT_BAND;
  if (!noveltyBand && !premiumBand) return undefined;

  // Pick the OPPOSITE quadrant on the borderline axis
  const altNovelty = noveltyBand ? (novelty >= THRESHOLD ? novelty - SOFT_BAND - 0.01 : novelty + SOFT_BAND + 0.01) : novelty;
  const altPremium = premiumBand ? (premium >= THRESHOLD ? premium - SOFT_BAND - 0.01 : premium + SOFT_BAND + 0.01) : premium;
  const alt = classify(altNovelty, altPremium);
  const primary = classify(novelty, premium);
  return alt === primary ? undefined : alt;
}

// ----------------------------------------------------------------------------
// CONFIDENCE — based on visit volume + how far the user is from the threshold.
// ----------------------------------------------------------------------------
export function computeConfidence(d: UserWeeklyData, novelty: number, premium: number): Confidence {
  if (d.totalVisits < MIN_VISITS_FOR_CLASSIFY) return "low";
  // How far from the threshold are we, on the closer axis?
  const closerToThreshold = Math.min(
    Math.abs(novelty - THRESHOLD),
    Math.abs(premium - THRESHOLD),
  );
  if (d.totalVisits >= 12 && closerToThreshold >= 0.15) return "high";
  if (d.totalVisits >= 6 && closerToThreshold >= 0.08) return "medium";
  return "low";
}

// ----------------------------------------------------------------------------
// SMOOTHING — read prior week from AsyncStorage, blend 70/30.
// ----------------------------------------------------------------------------
const PRIOR_WEEK_KEY = "palate.profile.priorWeek.v1";

type PriorWeek = {
  novelty: number;
  premium: number;
  isoWeekStart: string;   // YYYY-MM-DD
  identity: PrimaryIdentity;
};

async function readPriorWeek(): Promise<PriorWeek | null> {
  try {
    const raw = await AsyncStorage.getItem(PRIOR_WEEK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PriorWeek;
  } catch {
    return null;
  }
}

async function writePriorWeek(p: PriorWeek): Promise<void> {
  try {
    await AsyncStorage.setItem(PRIOR_WEEK_KEY, JSON.stringify(p));
  } catch {
    // ignore — smoothing is non-critical
  }
}

export function applySmoothing(
  current: { novelty: number; premium: number },
  prior: PriorWeek | null,
): { novelty: number; premium: number } {
  if (!prior) return current;
  return {
    novelty: clamp01(current.novelty * SMOOTHING_CURRENT + prior.novelty * (1 - SMOOTHING_CURRENT)),
    premium: clamp01(current.premium * SMOOTHING_CURRENT + prior.premium * (1 - SMOOTHING_CURRENT)),
  };
}

// ----------------------------------------------------------------------------
// PUBLIC ENTRY — call this from any UI surface that needs a Palate profile.
// ----------------------------------------------------------------------------

export type GetProfileOptions = {
  /** Set false in unit tests to bypass AsyncStorage. */
  useSmoothing?: boolean;
  /** Override prior week (for tests). */
  priorWeekOverride?: PriorWeek | null;
  /** ISO week start for the current week — used to gate smoothing writes. */
  thisWeekIso?: string;
};

export async function getUserPalateProfile(
  data: UserWeeklyData,
  opts: GetProfileOptions = {},
): Promise<PalateProfile> {
  // Low-data short-circuit — withhold classification per spec
  if (data.totalVisits < MIN_VISITS_FOR_CLASSIFY) {
    return {
      primaryIdentity: "Learning",
      confidence: "low",
      noveltyScore: 0.5,
      premiumScore: 0.5,
      tags: [],
      explanation: "We're still learning your Palate. Log a few more visits and we'll show you who you eat like.",
      behaviorSignals: data.totalVisits === 0
        ? ["No visits this week — log one to get started."]
        : [`${data.totalVisits} visit${data.totalVisits === 1 ? "" : "s"} so far this week.`],
      position: { x: 0.5, y: 0.5 },
    };
  }

  // Raw scoring
  const rawNovelty = computeNoveltyScore(data);
  const rawPremium = computePremiumScore(data);

  // Smoothing
  const useSmoothing = opts.useSmoothing !== false;
  const prior = opts.priorWeekOverride !== undefined
    ? opts.priorWeekOverride
    : useSmoothing ? await readPriorWeek() : null;
  const smoothed = applySmoothing({ novelty: rawNovelty, premium: rawPremium }, prior);

  // Classification
  const primaryIdentity = classify(smoothed.novelty, smoothed.premium);
  const secondaryIdentity = classifySecondary(smoothed.novelty, smoothed.premium);

  // Confidence
  const confidence = computeConfidence(data, smoothed.novelty, smoothed.premium);

  // Tags + explanation + behavior signals
  const tags = deriveTags(data);
  const explanation = composeExplanation(primaryIdentity, secondaryIdentity, smoothed, data);
  const behaviorSignals = composeBehaviorSignals(data);
  const movement = composeMovement(prior, smoothed, primaryIdentity);

  // Persist this week as the new "prior" for next time
  if (useSmoothing && opts.thisWeekIso) {
    void writePriorWeek({
      novelty: smoothed.novelty,
      premium: smoothed.premium,
      isoWeekStart: opts.thisWeekIso,
      identity: primaryIdentity,
    });
  }

  return {
    primaryIdentity,
    secondaryIdentity,
    confidence,
    noveltyScore: smoothed.novelty,
    premiumScore: smoothed.premium,
    tags,
    explanation,
    behaviorSignals,
    movement,
    position: { x: smoothed.novelty, y: smoothed.premium },
    priorPosition: prior ? { x: prior.novelty, y: prior.premium } : undefined,
  };
}

// ----------------------------------------------------------------------------
// ADAPTER — TasteVector → UserWeeklyData. Fills missing fields with neutral 0.5.
// ----------------------------------------------------------------------------

export function vectorToWeeklyData(v: TasteVector): UserWeeklyData {
  const cuisineCount = Object.keys(v.cuisineRegion).length;
  const subregionCount = Object.keys(v.cuisineSubregion).length;

  // Cuisine diversity: log-scaled — 1 cuisine = 0, 8+ cuisines = 1
  const cuisineDiversity = clamp01(Math.log10(1 + cuisineCount) / Math.log10(9));

  // Neighborhood diversity: similar log scale
  const neighborhoodCount = v.topNeighborhoods.length;
  const neighborhoodDiversity = clamp01(Math.log10(1 + neighborhoodCount) / Math.log10(6));

  // Premium signals — derived from existing aggregates
  const normalizedPriceLevel = v.averagePriceLevel > 0
    ? clamp01((v.averagePriceLevel - 1) / 3)  // tier 1 → 0, tier 4 → 1
    : 0.5;

  const totalChainObs = sumValues(v.chainType);
  const independentCount = v.chainType["independent"] ?? 0;
  const independentRestaurantRate = totalChainObs > 0
    ? independentCount / totalChainObs
    : 0.5;

  const totalOcc = sumValues(v.occasion);
  const reservationLike = (v.occasion["date_night"] ?? 0) + (v.occasion["group_dinner"] ?? 0);
  const reservationOrOccasionSignal = totalOcc > 0
    ? reservationLike / totalOcc
    : 0.5;

  const totalFmt = sumValues(v.formatClass);
  const elevated = (v.formatClass["fine_dining"] ?? 0) + (v.formatClass["wine_bar"] ?? 0);
  const elevatedCategorySignal = totalFmt > 0
    ? elevated / totalFmt
    : 0.5;

  // Time-of-day buckets (normalize hourly to fractions)
  const totalHour = v.hourly.reduce((s, n) => s + n, 0) || 1;
  const timeOfDayDistribution = {
    breakfast:  fracHours(v.hourly, 6, 10) / totalHour,
    brunch:     fracHours(v.hourly, 10, 13) / totalHour,
    lunch:      fracHours(v.hourly, 11, 15) / totalHour,
    dinner:     fracHours(v.hourly, 17, 22) / totalHour,
    lateNight:  fracHours(v.hourly, 22, 27) / totalHour, // 22-23 + 0-2
  };

  const socialDiningSignals = {
    groupDinner: totalOcc > 0 ? (v.occasion["group_dinner"] ?? 0) / totalOcc : 0,
    dateNight:   totalOcc > 0 ? (v.occasion["date_night"] ?? 0) / totalOcc : 0,
    casualSolo:  totalOcc > 0 ? (v.occasion["casual_solo"] ?? 0) / totalOcc : 0,
  };

  return {
    totalVisits: v.visitCount,
    newPlaceRate: clamp01(v.explorationRate),
    repeatRate: clamp01(v.repeatRate),
    cuisineDiversity,
    neighborhoodDiversity,
    normalizedPriceLevel,
    independentRestaurantRate,
    reservationOrOccasionSignal,
    elevatedCategorySignal,
    neighborhoodCount,
    timeOfDayDistribution,
    socialDiningSignals,
  };
}

/** One-shot helper for callers that have a TasteVector handy. */
export async function getProfileFromVector(
  v: TasteVector,
  opts?: GetProfileOptions,
): Promise<PalateProfile> {
  return await getUserPalateProfile(vectorToWeeklyData(v), opts);
}

// ----------------------------------------------------------------------------
// SESSION CACHE — avoid recomputing every render.
// ----------------------------------------------------------------------------
let sessionCache: { key: string; profile: PalateProfile } | null = null;

export function getCachedProfile(cacheKey: string): PalateProfile | null {
  if (sessionCache?.key === cacheKey) return sessionCache.profile;
  return null;
}

export function setCachedProfile(cacheKey: string, profile: PalateProfile): void {
  sessionCache = { key: cacheKey, profile };
}

export function clearProfileCache(): void {
  sessionCache = null;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function sumValues(map: Record<string, number>): number {
  return Object.values(map).reduce((s, n) => s + n, 0);
}

function fracHours(hourly: number[], start: number, end: number): number {
  // end can wrap past 24 (e.g. 22..27 meaning 22-23 + 0-2)
  let s = 0;
  for (let i = start; i < end; i++) s += hourly[i % 24] ?? 0;
  return s;
}
