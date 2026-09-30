import React from "react";
const { create, act } = require("react-test-renderer");
import AddTab from "../../app/(tabs)/add";
import { getCurrentLocation } from "../location";
import { searchRestaurantsDetailed, searchRestaurantsLocal } from "../places";
import { saveVisit } from "../visits";
import { setUsernameGateAccount, __resetUsernameGate } from "../username-gate";
import { Alert } from "react-native";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("react-native", () => ({
  View: "View", Pressable: "Pressable", Alert: { alert: jest.fn() },
  StyleSheet: { create: (s: unknown) => s },
  FlatList: ({ data, renderItem }: any) => require("react").createElement("List", null,
    data.map((item: any) => require("react").createElement(require("react").Fragment, { key: item.google_place_id }, renderItem({item})))),
}));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
jest.mock("../../components/Text", () => ({ Text: "Text" }));
jest.mock("../../components/TextInput", () => ({ TextInput: "SearchInput" }));
jest.mock("../../components/Button", () => ({ Button: "SearchButton", Spacer: () => null }));
jest.mock("../../components/FirstVisitCelebration", () => ({ FirstVisitCelebration: "FirstCelebration" }));
jest.mock("../../components/VisitCelebration", () => ({ VisitCelebration: "Celebration" }));
jest.mock("../../theme", () => ({ colors: {}, spacing: {}, type: {} }));
jest.mock("../supabase", () => ({ supabase: {} }));
jest.mock("../location", () => ({ getCurrentLocation: jest.fn() }));
jest.mock("../places", () => ({ searchRestaurantsDetailed: jest.fn(), searchRestaurantsLocal: jest.fn() }));
jest.mock("../visits", () => ({ saveVisit: jest.fn(), rewardCopy: jest.fn() }));
// useSuggestions and account-generation checks are real; all paid/native boundaries mocked.
const paid=searchRestaurantsDetailed as jest.Mock, local=searchRestaurantsLocal as jest.Mock;
const location=getCurrentLocation as jest.Mock, save=saveVisit as jest.Mock;

// Keep Expo's lazy fetch getter out of teardown; every service is mocked.
Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: () => { throw new Error("Network forbidden in Add mounted tests"); } });
let tree: any;
function deferred<T=any>() { let resolve!: (v:T)=>void, reject!: (e:unknown)=>void; const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject}; }
const row=(name:string)=>({google_place_id:name,name,address:`${name} address`});
const answer=(name:string)=>({places:[row(name)],degraded:false});
const field=()=>tree.root.findByType("SearchInput");
const button=()=>tree.root.findByType("SearchButton");
const text=()=>JSON.stringify(tree.toJSON());
async function flush() { await act(async()=>{ for(let i=0;i<12;i++)await Promise.resolve(); }); }
async function mount(strict=false) { await act(async()=>{tree=create(strict?<React.StrictMode><AddTab/></React.StrictMode>:<AddTab/>);});await flush();location.mockClear(); }
async function enter(q:string) { await act(async()=>field().props.onChangeText(q)); }
async function submit() { await act(async()=>{void button().props.onPress();}); }
async function resolve(d:any,value:any) { await act(async()=>d.resolve(value));await flush(); }
async function unmount() { await act(async()=>tree.unmount());tree=null; }
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();__resetUsernameGate();setUsernameGateAccount("A");location.mockResolvedValue({lat:1,lng:2});paid.mockResolvedValue(answer("paid"));local.mockResolvedValue([]);save.mockResolvedValue({isFirstVisit:true,totalVisits:1});});
afterEach(async()=>{if(tree)await unmount();jest.clearAllTimers();jest.useRealTimers();});

test("button + keyboard repeated in one batch admit one location and one paid attempt",async()=>{
 await mount();await enter(" coffee ");const d=deferred();location.mockReturnValueOnce(d.promise);
 const press=button().props.onPress,key=field().props.onSubmitEditing;
 await act(async()=>{void press();void key();void press();});expect(location).toHaveBeenCalledTimes(1);expect(paid).toHaveBeenCalledTimes(0);
 await resolve(d,{lat:3,lng:4});expect(paid).toHaveBeenCalledTimes(1);expect(paid).toHaveBeenCalledWith("coffee",{lat:3,lng:4});expect(text()).toContain("paid address");
});
test("duplicate submit while paid work pending does not spend twice",async()=>{
 await mount();await enter("coffee");const d=deferred();paid.mockReturnValueOnce(d.promise);await submit();await submit();expect(paid).toHaveBeenCalledTimes(1);await resolve(d,answer("current"));
});
test("query change during location drops old request before paid boundary",async()=>{
 await mount();await enter("old");const d=deferred();location.mockReturnValueOnce(d.promise);await submit();await enter("new");await resolve(d,{lat:1,lng:2});expect(paid).toHaveBeenCalledTimes(0);expect(button().props.loading).toBe(false);
 await submit();expect(paid).toHaveBeenCalledTimes(1);expect(paid.mock.calls[0][0]).toBe("new");
});
test("location rejection still checks staleness before unbiased paid search",async()=>{
 await mount();await enter("old");const d=deferred();location.mockReturnValueOnce(d.promise);await submit();await enter("new");await act(async()=>d.reject(Error("denied")));expect(paid).toHaveBeenCalledTimes(0);
});
test("latest query owns results despite reverse response order",async()=>{
 await mount();await enter("old");const old=deferred(),latest=deferred();paid.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);await submit();await enter("new");await submit();expect(paid).toHaveBeenCalledTimes(2);
 await resolve(latest,answer("new-result"));await resolve(old,answer("old-result"));expect(text()).toContain("new-result address");expect(text()).not.toContain("old-result");
});
test("old completion cannot clear newer spinner",async()=>{
 await mount();await enter("old");const old=deferred(),latest=deferred();paid.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);await submit();await enter("new");await submit();await resolve(old,answer("old-result"));expect(button().props.loading).toBe(true);await resolve(latest,answer("new-result"));expect(button().props.loading).toBe(false);
});
test("stale rejection does not alert or clear newer spinner",async()=>{
 await mount();await enter("old");const old=deferred(),latest=deferred();paid.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);await submit();await enter("new");await submit();await act(async()=>old.reject(Error("old failure")));expect(Alert.alert).not.toHaveBeenCalled();expect(button().props.loading).toBe(true);await resolve(latest,answer("new-result"));
});
test("current paid failure alerts and explicit retry is admitted",async()=>{
 await mount();await enter("coffee");paid.mockRejectedValueOnce(Error("offline"));await submit();expect(Alert.alert).toHaveBeenCalledWith("Search failed","offline");expect(button().props.loading).toBe(false);await submit();expect(paid).toHaveBeenCalledTimes(2);
});
test("query A-B-A typing alone never adopts old A paid answer",async()=>{
 await mount();await enter("coffee");const d=deferred();paid.mockReturnValueOnce(d.promise);await submit();await enter("tea");await enter("coffee");await resolve(d,answer("old coffee"));expect(text()).not.toContain("old coffee");expect(paid).toHaveBeenCalledTimes(1);
});
test.each(["location","paid"])("explicit query A-B-A rejoin shares pending %s without duplicate spend",async stage=>{
 await mount();await enter("coffee");const d=deferred();(stage==="location"?location:paid).mockReturnValueOnce(d.promise);await submit();await enter("tea");await enter(" coffee ");await submit();
 expect(location).toHaveBeenCalledTimes(1);
 await resolve(d,stage==="location"?{lat:1,lng:2}:answer("shared coffee"));expect(paid).toHaveBeenCalledTimes(1);expect(button().props.loading).toBe(false);expect(text()).toContain(stage==="location"?"paid address":"shared coffee address");
});
test("saved submit callback cannot submit for an edited query, even A-B-A",async()=>{
 await mount();await enter("coffee");const stale=button().props.onPress;await enter("tea");await enter("coffee");await act(async()=>{void stale();});expect(location).toHaveBeenCalledTimes(0);expect(paid).toHaveBeenCalledTimes(0);await submit();expect(paid).toHaveBeenCalledTimes(1);
});
for(const target of ["B","A-B-A",null])for(const stage of ["location","paid"]){
 test(`account ${target} during ${stage} stops old search`,async()=>{
  await mount();await enter("coffee");const d=deferred();(stage==="location"?location:paid).mockReturnValueOnce(d.promise);await submit();setUsernameGateAccount(target==="A-B-A"?"B":target);if(target==="A-B-A")setUsernameGateAccount("A");
  await resolve(d,stage==="location"?{lat:1,lng:2}:answer("stale-account"));expect(paid).toHaveBeenCalledTimes(stage==="paid"?1:0);expect(text()).not.toContain("stale-account");expect(Alert.alert).not.toHaveBeenCalled();
 });
}
test("account rerender resets old query/results and admits new owner's explicit search",async()=>{
 await mount();await enter("A query");await submit();setUsernameGateAccount("B");await act(async()=>tree.update(<AddTab/>));expect(field().props.value).toBe("");expect(text()).not.toContain("paid address");await enter("B query");await submit();expect(paid).toHaveBeenCalledTimes(2);expect(paid.mock.calls[1][0]).toBe("B query");
});
test.each(["location","paid"])("unmount during %s suppresses continuation and alerts",async stage=>{
 await mount();await enter("coffee");const d=deferred();(stage==="location"?location:paid).mockReturnValueOnce(d.promise);await submit();const stale=button().props.onPress;await unmount();await resolve(d,stage==="location"?{lat:1,lng:2}:answer("stale"));await act(async()=>{void stale();});expect(paid).toHaveBeenCalledTimes(stage==="paid"?1:0);expect(Alert.alert).not.toHaveBeenCalled();
});
test("denied location permits one unbiased explicit wider search",async()=>{
 await mount();await enter("coffee");location.mockRejectedValueOnce(Error("denied"));await submit();expect(paid).toHaveBeenCalledWith("coffee",undefined);expect(paid).toHaveBeenCalledTimes(1);
});
test("typing uses real debounced free suggestions and wider search remains explicit",async()=>{
 await mount();local.mockResolvedValue([row("local cafe")]);await enter("cafe");await act(async()=>jest.advanceTimersByTime(180));await flush();expect(local).toHaveBeenCalledWith("cafe",{lat:1,lng:2},8);expect(paid).not.toHaveBeenCalled();expect(text()).toContain("local cafe address");expect(button().props.title).toBe("Search everywhere");await submit();expect(paid).toHaveBeenCalledTimes(1);
});
test("query edit clears degraded explanation",async()=>{
 await mount();await enter("coffee");paid.mockResolvedValueOnce({places:[],degraded:true});await submit();await act(async()=>jest.advanceTimersByTime(180));await flush();expect(text()).toContain("Wider search is resting");await enter("tea");await act(async()=>jest.advanceTimersByTime(180));await flush();expect(text()).not.toContain("Wider search is resting");
});
test("blank submit never requests location or paid search",async()=>{await mount();await enter("   ");await submit();expect(location).not.toHaveBeenCalled();expect(paid).not.toHaveBeenCalled();});
test("StrictMode does not auto-submit and repeated explicit submit costs one attempt",async()=>{await mount(true);await enter("coffee");const d=deferred();location.mockReturnValueOnce(d.promise);await act(async()=>{void button().props.onPress();void field().props.onSubmitEditing();});await resolve(d,{lat:1,lng:2});expect(paid).toHaveBeenCalledTimes(1);});
test("local suggestion manual save and first celebration stay intact",async()=>{
 await mount();local.mockResolvedValue([row("local cafe")]);await enter("cafe");await act(async()=>jest.advanceTimersByTime(180));await flush();const p=tree.root.findByType("Pressable").props.onPress;const d=deferred();save.mockReturnValueOnce(d.promise);await act(async()=>{void p();void p();});expect(save).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledWith({googlePlaceId:"local cafe",source:"manual"});expect(paid).not.toHaveBeenCalled();await resolve(d,{isFirstVisit:true,totalVisits:1});expect(tree.root.findByType("FirstCelebration").props.restaurantName).toBe("local cafe");await act(async()=>tree.root.findByType("FirstCelebration").props.onDismiss());expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
});
test("ordinary repeat visit keeps delayed celebration navigation",async()=>{
 await mount();await enter("coffee");await submit();save.mockResolvedValueOnce({isFirstVisit:false,totalVisits:3});await act(async()=>{void tree.root.findByType("Pressable").props.onPress();});expect(tree.root.findByType("Celebration").props.fire).toBe(1);await act(async()=>jest.advanceTimersByTime(1100));expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
});

test.each(["", "   ", undefined])("search error %p has nonblank fallback",async message=>{
 await mount();await enter("coffee");paid.mockRejectedValueOnce({message});await submit();expect(Alert.alert).toHaveBeenCalledWith("Search failed","Try again");
});
test.each(["", "   ", undefined, "Visit count is unavailable. Please try again."])("save error %p preserves meaningful message or falls back",async message=>{
 await mount();await enter("coffee");await submit();save.mockRejectedValueOnce({message});await act(async()=>{void tree.root.findByType("Pressable").props.onPress();});expect(Alert.alert).toHaveBeenCalledWith("Couldn't save",message?.trim()?message:"Try again");
});

test("a current successful search can be explicitly repeated after it finishes",async()=>{
 await mount();await enter("coffee");await submit();await submit();expect(paid).toHaveBeenCalledTimes(2);expect(location).toHaveBeenCalledTimes(2);
});
test("old warm-up location cannot bias suggestions after account remount",async()=>{
 const warm=deferred();location.mockReturnValueOnce(warm.promise);await mount();setUsernameGateAccount("B");location.mockResolvedValue({lat:5,lng:6});await act(async()=>tree.update(<AddTab/>));await resolve(warm,{lat:99,lng:99});await enter("cafe");await act(async()=>jest.advanceTimersByTime(180));await flush();expect(local).toHaveBeenLastCalledWith("cafe",{lat:5,lng:6},8);expect(paid).not.toHaveBeenCalled();
});
test("null thrown search error uses fallback",async()=>{
 await mount();await enter("coffee");paid.mockRejectedValueOnce(null);await submit();expect(Alert.alert).toHaveBeenCalledWith("Search failed","Try again");
});
test("save failure releases existing synchronous save guard for retry",async()=>{
 await mount();await enter("coffee");await submit();save.mockRejectedValueOnce({message:""});await act(async()=>{void tree.root.findByType("Pressable").props.onPress();});expect(Alert.alert).toHaveBeenCalledWith("Couldn't save","Try again");await act(async()=>{void tree.root.findByType("Pressable").props.onPress();});expect(save).toHaveBeenCalledTimes(2);
});
