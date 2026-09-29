import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { resolveVenue, dwellMinutes } from "../passive-pipeline";
import { buildDigest } from "../passive-digest";
import { getCachedNearby } from "../nearby-cache";
import { restaurantsNear } from "../cuisine-catalogue";
import { nearbyRestaurantsDetailed } from "../places";
import { refusalsNearStop, DROP_AFTER_LOCAL_REFUSALS } from "../visits";
import { supabase } from "../supabase";
import type { Restaurant } from "../places";
import type { RawVisit } from "../passive-capture";
import type { InboxEntry } from "../passive-confirm";

// Data/IO boundaries only. Resolver, ranking/filtering, scoring, opening-hours,
// eating-pattern logic and digest construction are the production modules.
jest.mock("../nearby-cache", () => ({
  getCachedNearby: jest.fn(),
  setCachedNearby: jest.fn(() => { throw new Error("Unexpected cache write"); }),
}));
jest.mock("../cuisine-catalogue", () => ({ restaurantsNear: jest.fn() }));
jest.mock("../places", () => ({
  nearbyRestaurantsDetailed: jest.fn(() => { throw new Error("Google calls forbidden"); }),
  nearbyRestaurants: jest.fn(() => { throw new Error("Google calls forbidden"); }),
}));
jest.mock("../visits", () => ({
  ...jest.requireActual("../visits"),
  refusalsNearStop: jest.fn(),
}));
jest.mock("../supabase", () => ({ supabase: {
  auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
  from: jest.fn(() => { throw new Error("Database calls forbidden"); }),
} }));
jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("../observability", () => ({ breadcrumb: jest.fn(), captureError: jest.fn() }));
jest.mock("../../modules/palate-visit-monitor", () => ({
  isVisitMonitorAvailable: () => false,
  logDetectorNote: jest.fn(),
}));
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(() => { throw new Error("Notification delivery forbidden"); }),
  cancelScheduledNotificationAsync: jest.fn(() => { throw new Error("Notification cancellation forbidden"); }),
}));

const HERE = { lat: 40.75, lng: -73.99 }; // synthetic; not a user's trace
const END = new Date(2026, 8, 21, 13).getTime(); // device-local lunch, timezone-independent
function venue(id: string, metresNorth = 0, overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    google_place_id: id, name: id, primary_type: "restaurant", types: ["restaurant"],
    latitude: HERE.lat + metresNorth / 6_371_000 * 180 / Math.PI,
    longitude: HERE.lng,
    ...overrides,
  } as Restaurant;
}
function visit(overrides: Partial<RawVisit> = {}): RawVisit {
  return {
    id: "synthetic-stop", ...HERE, horizontalAccuracy: 10,
    arrivalAt: END - 45 * 60_000, departureAt: END, capturedAt: END,
    source: "stop", simulated: true, ...overrides,
  };
}

async function resolveToDigest(raw = visit()) {
  const resolved = await resolveVenue(raw);
  expect(resolved).not.toBeNull();
  const [top, ...alternates] = resolved!.candidates;
  // This suite covers resolution→scoring→digest. Forward the production
  // notifyOrInbox fields without invoking inbox persistence or notifications.
  const entry: InboxEntry = {
    id: raw.id, place_id: top.google_place_id, name: top.name,
    address: top.address ?? "", alternates,
    detectedAt: raw.departureAt ?? raw.capturedAt,
    dwellMin: dwellMinutes(raw)!, accuracyM: raw.horizontalAccuracy,
    source: raw.source ?? "visit", candidateCount: resolved!.candidates.length,
    confidence: resolved!.confidence, confidenceBand: resolved!.confidenceBand,
  };
  const digest = buildDigest([entry], new Date(END), { windowed: false });
  const entries = [...digest.high, ...digest.medium, ...digest.low];
  expect(entries).toHaveLength(1); // a conservative demotion must not erase the suggestion
  expect(entries[0].place_id).toBe(top.google_place_id);
  return { resolved: resolved!, entry: entries[0] };
}
function expectUnchecked(result: Awaited<ReturnType<typeof resolveToDigest>>) {
  expect(result.resolved.confidenceBand).toBe("medium");
  expect(result.entry.band).toBe("medium");
  expect(result.entry.preChecked).toBe(false);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.mocked(getCachedNearby).mockResolvedValue([venue("centroid")]);
  jest.mocked(restaurantsNear).mockImplementation(async () => { throw new Error("Unexpected catalogue read"); });
  jest.mocked(refusalsNearStop).mockResolvedValue(new Map());
});
afterEach(() => {
  expect(nearbyRestaurantsDetailed).not.toHaveBeenCalled();
  expect(supabase.from).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
});

describe("actual resolver → confidence → digest attribution", () => {
  it.each(["stop", "visit"] as const)("keeps a sole venue 65m from a precise %s fix unchecked", async (source) => {
    jest.mocked(getCachedNearby).mockResolvedValue([venue("nearby", 65)]);
    const result = await resolveToDigest(visit({ source }));
    expect(result.resolved.candidates.map(p => p.google_place_id)).toEqual(["nearby"]);
    expectUnchecked(result);
  });

  it.each(["stop", "visit", undefined] as const)("preserves a real centroid match for %s (undefined is legacy CLVisit)", async (source) => {
    const result = await resolveToDigest(visit({ source }));
    expect(result.resolved.confidenceBand).toBe("high");
    expect(result.entry.preChecked).toBe(true);
  });

  it("scores the actual winner after a nearer non-food first row is excluded", async () => {
    jest.mocked(getCachedNearby).mockResolvedValue([
      venue("excluded-centroid", 0, { recommendation_eligibility: 0, ineligibility_reason: "not_a_food_venue" }),
      venue("actual-winner", 65),
    ]);
    const result = await resolveToDigest();
    expect(result.resolved.candidates.map(p => p.google_place_id)).toEqual(["actual-winner"]);
    expectUnchecked(result); // using places[0]'s distance would incorrectly precheck
  });

  it("scores the remaining winner after local refusal removes a nearer food row", async () => {
    jest.mocked(getCachedNearby).mockResolvedValue([venue("refused-centroid"), venue("actual-winner", 65)]);
    jest.mocked(refusalsNearStop).mockResolvedValue(new Map([["refused-centroid", DROP_AFTER_LOCAL_REFUSALS]]));
    const result = await resolveToDigest();
    expect(result.resolved.candidates.map(p => p.google_place_id)).toEqual(["actual-winner"]);
    expectUnchecked(result);
  });

  it("leaves two plausible venues ambiguous and unchecked", async () => {
    jest.mocked(getCachedNearby).mockResolvedValue([venue("door-one"), venue("door-two", 5)]);
    const result = await resolveToDigest();
    expect(result.resolved.candidates.map(p => p.google_place_id)).toEqual(["door-one", "door-two"]);
    expect(result.entry.ambiguous).toBe(true);
    expectUnchecked(result);
  });

  it.each([
    { name: "missing", coordinates: { latitude: null, longitude: null } },
    { name: "NaN latitude", coordinates: { latitude: NaN } },
    { name: "infinite longitude", coordinates: { longitude: Infinity } },
    { name: "latitude outside range", coordinates: { latitude: 91 } },
    { name: "longitude outside range", coordinates: { longitude: -181 } },
  ])("cannot precheck unusable venue coordinates: $name", async ({ coordinates }) => {
    jest.mocked(getCachedNearby).mockResolvedValue([venue("unknown-position", 0, coordinates)]);
    expectUnchecked(await resolveToDigest());
  });

  it("does not treat a precise-reported SLC centroid as precise-source evidence", async () => {
    expectUnchecked(await resolveToDigest(visit({ source: "slc" })));
  });

  it("keeps a 51m-accuracy centroid fix unchecked", async () => {
    expectUnchecked(await resolveToDigest(visit({ horizontalAccuracy: 51 })));
  });

  it("captures five-minute chain coffee as an unchecked suggestion", async () => {
    jest.mocked(getCachedNearby).mockResolvedValue([venue("synthetic-coffee", 0, {
      primary_type: "coffee_shop", types: ["coffee_shop"],
      recommendation_eligibility: 0, ineligibility_reason: "national_chain",
    })]);
    const result = await resolveToDigest(visit({ arrivalAt: END - 5 * 60_000 }));
    expect(result.resolved.candidates[0].google_place_id).toBe("synthetic-coffee");
    expectUnchecked(result);
  });

  it("applies the same attribution rule to catalogue rows without paid fallback", async () => {
    jest.mocked(getCachedNearby).mockResolvedValue(null);
    jest.mocked(restaurantsNear).mockResolvedValue([venue("catalogue-neighbor", 65)]);
    expectUnchecked(await resolveToDigest());
    expect(restaurantsNear).toHaveBeenCalledWith(HERE, { radiusM: 75, limit: 20, recommendableOnly: false });
  });
});
