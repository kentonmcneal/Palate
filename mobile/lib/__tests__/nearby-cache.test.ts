import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrFetchNearby } from "../nearby-cache";
import { nearbyRestaurants, nearbyRestaurantsDetailed, searchRestaurantsDetailed } from "../places";
import { supabase } from "../supabase";
import { denseCity } from "../recommendation/__fixtures__/dense-city";

// Count actual client proxy invocations, NOT Google billing: a server request
// can be free (catalogue) or fan out. Server spend controls need separate tests.
let invoke: jest.SpyInstance;
const lat = 40.74, lng = -74, radius = 2500;
const nearby = (x = lat, y = lng, r = radius) => getOrFetchNearby(x, y, r, nearbyRestaurants);
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  invoke = jest.spyOn(supabase.functions, "invoke").mockResolvedValue({ data: { places: denseCity, degraded: false }, error: null });
});
afterEach(() => jest.restoreAllMocks());

test("dense-city journey has 11 nearby + 3 submitted-search proxy calls", async () => {
  expect(denseCity).toHaveLength(2000);
  await Promise.all([nearby(), nearby(), nearby()]); // simultaneous home/discover/profile
  expect(invoke).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 10; i++) await nearby(lat + i * 0.00001); // same bucket
  for (let i = 0; i < 5; i++) await nearby(); // refresh/reopen
  expect(invoke).toHaveBeenCalledTimes(1);
  for (let i = 1; i <= 10; i++) await nearby(lat + i * 0.003);
  for (const query of ["pasta", "noodles", "tacos"]) await searchRestaurantsDetailed(query, { lat, lng });
  expect(invoke).toHaveBeenCalledTimes(14);
  expect(invoke.mock.calls.every(([name]) => name === "places-proxy")).toBe(true);
});

test("TTL expires exactly at five minutes, and radius is part of the key", async () => {
  await nearby();
  (Date.now as jest.Mock).mockReturnValue(1_800_000_000_000 + 299999);
  await nearby();
  expect(invoke).toHaveBeenCalledTimes(1);
  (Date.now as jest.Mock).mockReturnValue(1_800_000_000_000 + 300000);
  await nearby();
  await nearby(lat, lng, 600);
  expect(invoke).toHaveBeenCalledTimes(3);
});

test("failed requests release their pending entry and can be retried", async () => {
  invoke.mockRejectedValueOnce(new Error("offline"));
  await expect(nearby()).rejects.toThrow("offline");
  await expect(nearby()).resolves.toHaveLength(2000);
  expect(invoke).toHaveBeenCalledTimes(2);
});

test("empty catalogue results are cached and detailed responses retain degraded status", async () => {
  invoke.mockResolvedValue({ data: { places: [], degraded: true }, error: null });
  await nearby();
  await nearby();
  expect(invoke).toHaveBeenCalledTimes(1);
  await expect(nearbyRestaurantsDetailed(lat, lng)).resolves.toEqual({ places: [], degraded: true });
});

test("failed persistence is nonfatal and simultaneous fetches still coalesce", async () => {
  jest.spyOn(AsyncStorage, "setItem").mockRejectedValue(new Error("storage full"));
  const result = await Promise.all([nearby(), nearby()]);
  expect(result[0]).toHaveLength(2000);
  expect(invoke).toHaveBeenCalledTimes(1);
});
