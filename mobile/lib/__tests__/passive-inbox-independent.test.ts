import { setUsernameGateAccount } from "../username-gate";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getInbox, notifyOrInbox, removeFromInbox, restoreInboxFromServer, seedDigestFixtures } from "../passive-confirm";
import { mirrorInbox, hydrateInboxIfEmpty } from "../passive-inbox-sync";
import { scheduleDigest } from "../passive-digest";
jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("../observability", () => ({ captureError: jest.fn() }));
jest.mock("../passive-inbox-sync", () => ({ mirrorInbox: jest.fn(), hydrateInboxIfEmpty: jest.fn() }));
jest.mock("../passive-digest", () => ({ scheduleDigest: jest.fn(), DIGEST_NOTIF_ID_STORAGE_KEY: "digest", allowsRealtimePrompt: () => false }));
jest.mock("../visits", () => ({ recentlyPrompted: jest.fn(async () => false), placeRefusals: jest.fn(async () => 0), shouldDemote: () => false }));
jest.mock("expo-notifications", () => ({}));
const KEY="palate.passive.inbox";
const entry=()=>({id:"existing",place_id:"cafe",name:"Synthetic cafe",address:"",alternates:[],detectedAt:Date.now(),dwellMin:10});
const resolved=()=>({raw:{id:"new",capturedAt:Date.now(),departureAt:Date.now(),horizontalAccuracy:10,source:"stop"},candidates:[{google_place_id:"new-place",name:"Synthetic diner"}],cacheHit:true,confidence:.6,confidenceBand:"medium"} as any);
const operations=[ ["capture",()=>notifyOrInbox(resolved(),10)], ["remove",()=>removeFromInbox("existing")], ["debug seed",()=>seedDigestFixtures()], ["restore",()=>restoreInboxFromServer()] ] as const;
beforeEach(async()=>{setUsernameGateAccount("test-owner");jest.restoreAllMocks();jest.clearAllMocks();await AsyncStorage.clear();(hydrateInboxIfEmpty as jest.Mock).mockResolvedValue([{...entry(),id:"remote"}]);});
afterEach(()=>jest.restoreAllMocks());

for(const [label,run] of operations)test(`${label}: expiry-write failure preserves stored snapshot and denies downstream work`,async()=>{
 const raw=JSON.stringify([{...entry(),detectedAt:Date.now()-49*3600000}, {...entry(),id:"live"}]);await AsyncStorage.setItem(KEY,raw);
 jest.spyOn(AsyncStorage,"setItem").mockRejectedValueOnce(Error("expiry write unavailable"));
 if(label==="restore")await expect(run()).resolves.toBe(0);else await expect(run()).rejects.toThrow("expiry write unavailable");
 expect(await AsyncStorage.getItem(KEY)).toBe(raw);expect(mirrorInbox).not.toHaveBeenCalled();expect(hydrateInboxIfEmpty).not.toHaveBeenCalled();expect(scheduleDigest).not.toHaveBeenCalled();
});
test("removal after read recovery preserves unrelated live entries",async()=>{
 await AsyncStorage.setItem(KEY,JSON.stringify([entry(),{...entry(),id:"other"}]));jest.spyOn(AsyncStorage,"getItem").mockRejectedValueOnce(Error("unavailable"));await expect(removeFromInbox("existing")).rejects.toThrow();await removeFromInbox("existing");expect((await getInbox()).map(e=>e.id)).toEqual(["other"]);
});
test("restore read recovery uses latest nonempty snapshot",async()=>{
 await AsyncStorage.setItem(KEY,JSON.stringify([entry()]));jest.spyOn(AsyncStorage,"getItem").mockRejectedValueOnce(Error("unavailable"));expect(await restoreInboxFromServer()).toBe(0);expect(hydrateInboxIfEmpty).not.toHaveBeenCalled();
 (hydrateInboxIfEmpty as jest.Mock).mockResolvedValue(null);await restoreInboxFromServer();expect(hydrateInboxIfEmpty).toHaveBeenCalledWith(1, expect.objectContaining({accountId:"test-owner"}));expect((await getInbox()).map(e=>e.id)).toEqual(["existing"]);
});
