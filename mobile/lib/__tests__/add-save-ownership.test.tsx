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

const pick=()=>tree.root.findByType("Pressable").props.onPress;
async function ready(strict=false){await mount(strict);local.mockResolvedValue([row("local")]);await enter("local");await act(async()=>jest.advanceTimersByTime(180));await flush();}
async function tap(){await act(async()=>{void pick()();});}
function change(target:string|null){setUsernameGateAccount(target==='ABA'?'B':target);if(target==='ABA')setUsernameGateAccount('A');}
for(const target of ['B','ABA',null])for(const outcome of ['first','repeat','error'])test(`pending save ${outcome} after account ${target} has no UI effect`,async()=>{
 await ready();const d=deferred();save.mockReturnValueOnce(d.promise);await tap();change(target);
 await act(async()=>outcome==='error'?d.reject(Error('stale')):d.resolve({isFirstVisit:outcome==='first',totalVisits:2}));await flush();
 expect(Alert.alert).not.toHaveBeenCalled();expect(tree.root.findByType('FirstCelebration').props.visible).toBe(false);expect(tree.root.findByType('Celebration').props.fire).toBe(0);await act(async()=>jest.advanceTimersByTime(2000));expect(mockReplace).not.toHaveBeenCalled();
});
for(const outcome of ['first','repeat','error'])test(`unmounted save ${outcome} cannot navigate or alert`,async()=>{
 await ready();const d=deferred();save.mockReturnValueOnce(d.promise);await tap();await unmount();await act(async()=>outcome==='error'?d.reject(null):d.resolve({isFirstVisit:outcome==='first',totalVisits:2}));await act(async()=>jest.advanceTimersByTime(2000));expect(Alert.alert).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();
});
for(const target of ['B','ABA','unmount'])test(`repeat timer loses navigation ownership at ${target}`,async()=>{
 await ready();save.mockResolvedValueOnce({isFirstVisit:false,totalVisits:2});await tap();if(target==='unmount')await unmount();else change(target);await act(async()=>jest.advanceTimersByTime(1100));expect(mockReplace).not.toHaveBeenCalled();
});
for(const target of ['B','ABA','unmount'])test(`saved first celebration dismissal is inert after ${target}`,async()=>{
 await ready();await tap();const dismiss=tree.root.findByType('FirstCelebration').props.onDismiss;if(target==='unmount')await unmount();else change(target);await act(async()=>dismiss());expect(mockReplace).not.toHaveBeenCalled();
});
test('old row callback cannot initiate save after account ABA or unmount',async()=>{await ready();const stale=pick();change('ABA');await act(async()=>{void stale();});expect(save).not.toHaveBeenCalled();await unmount();await act(async()=>{void stale();});expect(save).not.toHaveBeenCalled();});
test('legitimate first save deduplicates taps and dismissal navigates once',async()=>{await ready();const d=deferred();save.mockReturnValueOnce(d.promise);const p=pick();await act(async()=>{void p();void p();});expect(save).toHaveBeenCalledTimes(1);await resolve(d,{isFirstVisit:true,totalVisits:1});const dismiss=tree.root.findByType('FirstCelebration').props.onDismiss;expect(tree.root.findByType('FirstCelebration').props.restaurantName).toBe('local');await act(async()=>{dismiss();dismiss();});expect(mockReplace).toHaveBeenCalledTimes(1);expect(paid).not.toHaveBeenCalled();});
test('new save invalidates older repeat navigation even if callback is already queued',async()=>{
 await ready();const timer=jest.spyOn(globalThis,'setTimeout');save.mockResolvedValueOnce({isFirstVisit:false,totalVisits:2});await tap();const callback=timer.mock.calls.find(c=>c[1]===1100)![0] as ()=>void;
 const d=deferred();save.mockReturnValueOnce(d.promise);await tap();await act(async()=>callback());expect(mockReplace).not.toHaveBeenCalled();await resolve(d,{isFirstVisit:true,totalVisits:1});expect(tree.root.findByType('FirstCelebration').props.visible).toBe(true);timer.mockRestore();
});
test('new save invalidates old first celebration dismissal',async()=>{await ready();await tap();const old=tree.root.findByType('FirstCelebration').props.onDismiss;const d=deferred();save.mockReturnValueOnce(d.promise);await tap();await act(async()=>old());expect(mockReplace).not.toHaveBeenCalled();await resolve(d,{isFirstVisit:true,totalVisits:1});await act(async()=>tree.root.findByType('FirstCelebration').props.onDismiss());expect(mockReplace).toHaveBeenCalledTimes(1);});
test('ordinary failure releases save admission with readable fallback',async()=>{await ready();save.mockRejectedValueOnce(null);await tap();expect(Alert.alert).toHaveBeenCalledWith("Couldn't save",'Try again');await tap();expect(save).toHaveBeenCalledTimes(2);expect(tree.root.findByType('FirstCelebration').props.visible).toBe(true);});
test('query edits do not discard a legitimate in-flight manual save',async()=>{await ready();const d=deferred();save.mockReturnValueOnce(d.promise);await tap();await enter('different');await resolve(d,{isFirstVisit:true,totalVisits:1});expect(tree.root.findByType('FirstCelebration').props.restaurantName).toBe('local');});
test('same-account refresh preserves repeat navigation in StrictMode',async()=>{await ready(true);save.mockResolvedValueOnce({isFirstVisit:false,totalVisits:2});await tap();setUsernameGateAccount('A');await act(async()=>jest.advanceTimersByTime(1099));expect(mockReplace).not.toHaveBeenCalled();await act(async()=>jest.advanceTimersByTime(1));expect(mockReplace).toHaveBeenCalledTimes(1);});
test('old failure cannot release replacement account save guard',async()=>{
 await ready();const a=deferred(),b=deferred();save.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);await tap();change('B');await act(async()=>tree.update(<AddTab/>));await enter('local');await act(async()=>jest.advanceTimersByTime(180));await flush();await tap();await act(async()=>a.reject(Error('old')));await tap();expect(save).toHaveBeenCalledTimes(2);expect(tree.root.findByType('Pressable').props.disabled).toBe(true);await resolve(b,{isFirstVisit:true,totalVisits:1});expect(Alert.alert).not.toHaveBeenCalled();expect(tree.root.findByType('FirstCelebration').props.visible).toBe(true);
});
