import * as misses from "../passive-misses";
import { listMisses, describeMiss } from "../passive-misses";
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

let recording: jest.SpyInstance;
beforeEach(async () => {
  recording = jest.spyOn(misses, "recordMiss");
  jest.clearAllMocks();
  await AsyncStorage.clear();

  jest.mocked(restaurantsNear).mockImplementation(async () => { throw new Error("Unexpected catalogue read"); });
  jest.mocked(refusalsNearStop).mockResolvedValue(new Map());
});
afterEach(() => {
  jest.restoreAllMocks();
  expect(nearbyRestaurantsDetailed).not.toHaveBeenCalled();
  expect(supabase.from).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
});


it("neighboring precise stop does not inherit a 120m cached venue",async()=>{
 // Both query centers round to the same real cache bucket.
 const raw=visit({lat:40.7499,lng:-73.9905});
 const original={lat:40.7511,lng:raw.lng};
 const p=venue("neighbor",0,{latitude:original.lat,longitude:original.lng});
 await setCachedNearby(original.lat,original.lng,75,[p]);
 expect(await getCachedNearby(raw.lat,raw.lng,75)).toHaveLength(1);
 expect(await resolveVenue(raw)).toBeNull();
 await recording.mock.results[0].value;
 const [miss] = await listMisses();
 expect(miss.reason).toBe("outside_search_radius");
 expect(describeMiss(miss)).toContain("75m search radius");
 expect(describeMiss(miss)).not.toContain("non-dining");
});
it("keeps an in-radius coffee candidate while removing a distant cached row",async()=>{
 await setCachedNearby(HERE.lat,HERE.lng,75,[venue("distant",120),venue("coffee",0,{primary_type:"coffee_shop",types:["coffee_shop"],recommendation_eligibility:0,ineligibility_reason:"national_chain"})]);
 const r=await resolveVenue(visit({arrivalAt:END-8*60000}));
 expect(r!.candidates.map(x=>x.google_place_id)).toEqual(["coffee"]);
});
it("retains a 65m uncertain suggestion",async()=>{
 await setCachedNearby(HERE.lat,HERE.lng,75,[venue("near",65)]);
 expectUnchecked(await resolveToDigest());
});
it("SLC retains its existing wider radius",async()=>{
 await setCachedNearby(HERE.lat,HERE.lng,300,[venue("coarse",120)]);
 const r=await resolveVenue(visit({source:"slc"}));expect(r!.candidates[0].google_place_id).toBe("coarse");expect(r!.confidenceBand).not.toBe("high");
});
it("unknown coordinates remain recoverable and unchecked",async()=>{
 await setCachedNearby(HERE.lat,HERE.lng,75,[venue("unknown",0,{latitude:null,longitude:null})]);
 expectUnchecked(await resolveToDigest());
});

it("non-food rejection keeps its separate diagnostic", async () => {
 await setCachedNearby(HERE.lat,HERE.lng,75,[venue("non-food",0,{recommendation_eligibility:0,ineligibility_reason:"not_a_food_venue"})]);
 expect(await resolveVenue(visit())).toBeNull();
 await recording.mock.results[0].value;
 const [miss]=await listMisses();expect(miss.reason).toBe("all_filtered_out");
});
