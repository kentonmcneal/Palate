import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { resolveVenue, dwellMinutes } from "../passive-pipeline";
import { buildDigest } from "../passive-digest";
import { getCachedNearby, setCachedNearby } from "../nearby-cache";
import { restaurantsNear } from "../cuisine-catalogue";
import { nearbyRestaurantsDetailed } from "../places";
import { refusalsNearStop, DROP_AFTER_LOCAL_REFUSALS } from "../visits";
import { supabase } from "../supabase";
import type { Restaurant } from "../places";
import type { RawVisit } from "../passive-capture";
import type { InboxEntry } from "../passive-confirm";

// Data/IO boundaries only. Resolver, ranking/filtering, scoring, opening-hours,
// eating-pattern logic and digest construction are the production modules.
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

  jest.mocked(restaurantsNear).mockImplementation(async () => { throw new Error("Unexpected catalogue read"); });
  jest.mocked(refusalsNearStop).mockResolvedValue(new Map());
});

afterEach(()=>{expect(supabase.from).not.toHaveBeenCalled();expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()});
it("cache removal may elevate surviving centroid to prechecked",async()=>{await setCachedNearby(HERE.lat,HERE.lng,75,[venue("far",120),venue("here")]);const r=await resolveToDigest();expect(r.resolved.candidates).toHaveLength(1);expect(r.entry.preChecked).toBe(true);expect(nearbyRestaurantsDetailed).not.toHaveBeenCalled()});
it("catalogue all far is terminal without paid fallback",async()=>{jest.mocked(restaurantsNear).mockResolvedValue([venue("far",120)]);expect(await resolveVenue(visit())).toBeNull();expect(nearbyRestaurantsDetailed).not.toHaveBeenCalled()});
it("provider all far ordinary response is terminal",async()=>{jest.mocked(restaurantsNear).mockResolvedValue([]);jest.mocked(nearbyRestaurantsDetailed).mockResolvedValue({places:[venue("far",120)],degraded:false});expect(await resolveVenue(visit())).toBeNull();expect(nearbyRestaurantsDetailed).toHaveBeenCalledTimes(1)});
it("degraded provider all far retains retry rather than terminal miss",async()=>{jest.mocked(restaurantsNear).mockResolvedValue([]);jest.mocked(nearbyRestaurantsDetailed).mockResolvedValue({places:[venue("far",120)],degraded:true});await expect(resolveVenue(visit())).rejects.toMatchObject({retryLater:true});expect(nearbyRestaurantsDetailed).toHaveBeenCalledTimes(1)});
it.each([null,NaN,Infinity,91])("invalid latitude %s cannot precheck",async latitude=>{await setCachedNearby(HERE.lat,HERE.lng,75,[venue("unknown",0,{latitude})]);expectUnchecked(await resolveToDigest());expect(nearbyRestaurantsDetailed).not.toHaveBeenCalled()});
it("unknown row preserves ambiguity beside matched centroid",async()=>{await setCachedNearby(HERE.lat,HERE.lng,75,[venue("here"),venue("unknown",0,{latitude:null,longitude:null})]);expectUnchecked(await resolveToDigest())});
it("catalogue and provider exclude far rows consistently",async()=>{jest.mocked(restaurantsNear).mockResolvedValue([venue("far",120),venue("here")]);expect((await resolveVenue(visit()))!.candidates.map(p=>p.google_place_id)).toEqual(["here"]);expect(nearbyRestaurantsDetailed).not.toHaveBeenCalled();jest.mocked(restaurantsNear).mockResolvedValue([]);jest.mocked(nearbyRestaurantsDetailed).mockResolvedValue({places:[venue("far",120),venue("here")],degraded:false});expect((await resolveVenue(visit()))!.candidates.map(p=>p.google_place_id)).toEqual(["here"]);expect(nearbyRestaurantsDetailed).toHaveBeenCalledTimes(1)});
