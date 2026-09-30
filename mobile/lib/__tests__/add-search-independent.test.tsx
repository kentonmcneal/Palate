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

test("location-only A operation abandoned before explicit A retry creates one fresh dispatch",async()=>{
 await mount();await enter("A");const old=deferred();location.mockReturnValueOnce(old.promise);await submit();await enter("B");await resolve(old,{lat:9,lng:9});expect(paid).not.toHaveBeenCalled();await enter("A");await submit();expect(location).toHaveBeenCalledTimes(2);expect(paid).toHaveBeenCalledTimes(1);expect(paid).toHaveBeenCalledWith("A",{lat:1,lng:2});
});
test("two different pre-location queries only latest dispatches",async()=>{
 await mount();const a=deferred(),b=deferred();location.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);await enter("A");await submit();await enter("B");await submit();await resolve(a,{lat:8,lng:8});expect(paid).not.toHaveBeenCalled();expect(button().props.loading).toBe(true);await resolve(b,{lat:2,lng:3});expect(paid).toHaveBeenCalledTimes(1);expect(paid).toHaveBeenCalledWith("B",{lat:2,lng:3});
});
test("joined failed A operation alerts once then permits explicit retry",async()=>{
 await mount();const pending=deferred();paid.mockReturnValueOnce(pending.promise);await enter("A");await submit();await enter("B");await enter(" A ");await submit();await act(async()=>pending.reject(Error("shared failure")));await flush();expect(Alert.alert).toHaveBeenCalledTimes(1);expect(button().props.loading).toBe(false);expect(paid).toHaveBeenCalledTimes(1);await submit();expect(paid).toHaveBeenCalledTimes(2);
});
test("same batch edit invalidates saved keyboard submit before rerender",async()=>{
 await mount();await enter("A");const change=field().props.onChangeText,old=field().props.onSubmitEditing;
 await act(async()=>{change("B");void old();});expect(location).not.toHaveBeenCalled();expect(paid).not.toHaveBeenCalled();await submit();expect(paid).toHaveBeenCalledWith("B",{lat:1,lng:2});
});
test("old mounted callback cannot submit after unmount and fresh same-account mount",async()=>{
 await mount();await enter("A");const old=button().props.onPress;await unmount();await mount();await enter("A");await act(async()=>{void old();});expect(paid).not.toHaveBeenCalled();await submit();expect(paid).toHaveBeenCalledTimes(1);
});
test("replaced-account paid failure cannot alert or clear new account spinner",async()=>{
 await mount();await enter("A");const a=deferred(),b=deferred();paid.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);await submit();setUsernameGateAccount("B");await act(async()=>tree.update(<AddTab/>));await enter("B");await submit();await act(async()=>a.reject(null));await flush();expect(Alert.alert).not.toHaveBeenCalled();expect(button().props.loading).toBe(true);await resolve(b,answer("B result"));expect(text()).toContain("B result address");
});
test("location synchronously throwing still permits one unbiased search",async()=>{
 await mount();await enter("A");location.mockImplementationOnce(()=>{throw Error("location unavailable")});await submit();expect(paid).toHaveBeenCalledTimes(1);expect(paid).toHaveBeenCalledWith("A",undefined);
});
test("paid synchronous exception releases admission and null save error stays readable",async()=>{
 await mount();await enter("A");paid.mockImplementationOnce(()=>{throw null});await submit();expect(Alert.alert).toHaveBeenCalledWith("Search failed","Try again");expect(button().props.loading).toBe(false);await submit();expect(paid).toHaveBeenCalledTimes(2);save.mockRejectedValueOnce(null);await act(async()=>{void tree.root.findByType("Pressable").props.onPress();});expect(Alert.alert).toHaveBeenCalledWith("Couldn't save","Try again");
});
test("StrictMode pending search after unmount never dispatches even if location rejects",async()=>{
 await mount(true);await enter("A");const d=deferred();location.mockReturnValueOnce(d.promise);await submit();await unmount();await act(async()=>d.reject(Error("offline")));expect(paid).not.toHaveBeenCalled();expect(Alert.alert).not.toHaveBeenCalled();
});
