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
for(const [label,run] of operations){
 test.each(["reject","invalid-json","wrong-shape","invalid-date","empty-string"])(`${label}: %s cannot overwrite unavailable inbox`,async(failure)=>{
  const raw=failure==="reject"?JSON.stringify([entry()]):failure==="invalid-json"?"{":failure==="wrong-shape"?"{}":failure==="empty-string"?"":JSON.stringify([{...entry(),detectedAt:"bad"}]);
  await AsyncStorage.setItem(KEY,raw);
  if(failure==="reject")jest.spyOn(AsyncStorage,"getItem").mockRejectedValueOnce(Error("unavailable"));
  // The official storage mock collapses empty strings to null; inject the real API return.
  if(failure==="empty-string")jest.spyOn(AsyncStorage,"getItem").mockResolvedValueOnce("");
  const write=jest.spyOn(AsyncStorage,"setItem").mockClear();
  if(label==="restore")await expect(run()).resolves.toBe(0);else await expect(run()).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();expect(mirrorInbox).not.toHaveBeenCalled();expect(hydrateInboxIfEmpty).not.toHaveBeenCalled();expect(scheduleDigest).not.toHaveBeenCalled();if(failure!=="empty-string")expect(await AsyncStorage.getItem(KEY)).toBe(raw);
 });
}
test("capture succeeds after read recovery preserving prior entry",async()=>{
 await AsyncStorage.setItem(KEY,JSON.stringify([entry()]));jest.spyOn(AsyncStorage,"getItem").mockRejectedValueOnce(Error("unavailable"));await expect(notifyOrInbox(resolved(),10)).rejects.toThrow();await expect(notifyOrInbox(resolved(),10)).resolves.toBe("inboxed-digest");expect((await getInbox()).map(e=>e.id).sort()).toEqual(["existing","new"]);
});
test("verified empty can restore and missing inbox accepts capture",async()=>{
 await expect(restoreInboxFromServer()).resolves.toBe(1);expect(hydrateInboxIfEmpty).toHaveBeenCalledWith(0, expect.objectContaining({accountId:"test-owner"}));await AsyncStorage.removeItem(KEY);await notifyOrInbox(resolved(),10);expect((await getInbox()).map(e=>e.id)).toEqual(["new"]);
});
test("display fallback does not write",async()=>{await AsyncStorage.setItem(KEY,"{");await expect(getInbox()).resolves.toEqual([]);expect(await AsyncStorage.getItem(KEY)).toBe("{");});
