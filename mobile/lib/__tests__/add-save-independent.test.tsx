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

test('independent: actual mobile React and renderer versions are 19.2.3',()=>{
 expect(React.version).toBe('19.2.3');expect(require('react-test-renderer/package.json').version).toBe('19.2.3');
});
test('independent: captured repeat timer is single-use even when invoked twice',async()=>{
 await ready();const spy=jest.spyOn(globalThis,'setTimeout');try{
 save.mockResolvedValueOnce({isFirstVisit:false,totalVisits:2});await tap();const cb=spy.mock.calls.find(c=>c[1]===1100)![0] as ()=>void;
 await act(async()=>{cb();cb();});expect(mockReplace).toHaveBeenCalledTimes(1);
 }finally{spy.mockRestore()}
});
test('independent: failed newer save still retires older repeat timer',async()=>{
 await ready();const spy=jest.spyOn(globalThis,'setTimeout');try{
 save.mockResolvedValueOnce({isFirstVisit:false,totalVisits:2});await tap();const old=spy.mock.calls.find(c=>c[1]===1100)![0] as ()=>void;
 save.mockRejectedValueOnce(Error('new failure'));await tap();await act(async()=>{old();jest.advanceTimersByTime(2200)});
 expect(mockReplace).not.toHaveBeenCalled();expect(Alert.alert).toHaveBeenCalledWith("Couldn't save",'new failure');
 save.mockResolvedValueOnce({isFirstVisit:false,totalVisits:3});await tap();await act(async()=>jest.advanceTimersByTime(1100));expect(mockReplace).toHaveBeenCalledTimes(1);
 }finally{spy.mockRestore()}
});
test('independent: failed newer save hides prior first celebration and invalidates its callback',async()=>{
 await ready();await tap();const old=tree.root.findByType('FirstCelebration').props.onDismiss;
 save.mockRejectedValueOnce(Error('failure'));await tap();await act(async()=>old());expect(mockReplace).not.toHaveBeenCalled();expect(tree.root.findByType('FirstCelebration').props.visible).toBe(false);
 await tap();await act(async()=>tree.root.findByType('FirstCelebration').props.onDismiss());expect(mockReplace).toHaveBeenCalledTimes(1);
});
for(const first of [true,false])test(`independent: old account success first=${first} cannot touch replacement's pending save`,async()=>{
 await ready();const a=deferred(),b=deferred();save.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);await tap();change('B');await act(async()=>tree.update(<AddTab/>));
 local.mockResolvedValue([row('B choice')]);await enter('B choice');await act(async()=>jest.advanceTimersByTime(180));await flush();await tap();
 await resolve(a,{isFirstVisit:first,totalVisits:3});expect(tree.root.findByType('Pressable').props.disabled).toBe(true);expect(tree.root.findByType('Celebration').props.fire).toBe(0);expect(tree.root.findByType('FirstCelebration').props.visible).toBe(false);
 await tap();expect(save).toHaveBeenCalledTimes(2);await resolve(b,{isFirstVisit:true,totalVisits:1});expect(tree.root.findByType('FirstCelebration').props.restaurantName).toBe('B choice');
 await act(async()=>jest.advanceTimersByTime(2000));expect(mockReplace).not.toHaveBeenCalled();
});
test('independent: old lifetime timer cannot navigate over a remounted same-account pending save',async()=>{
 await ready();const spy=jest.spyOn(globalThis,'setTimeout');try{
 save.mockResolvedValueOnce({isFirstVisit:false,totalVisits:2});await tap();const old=spy.mock.calls.find(c=>c[1]===1100)![0] as ()=>void;
 await unmount();await ready();const d=deferred();save.mockReturnValueOnce(d.promise);await tap();await act(async()=>old());expect(mockReplace).not.toHaveBeenCalled();expect(tree.root.findByType('Pressable').props.disabled).toBe(true);
 await resolve(d,{isFirstVisit:true,totalVisits:1});expect(tree.root.findByType('FirstCelebration').props.visible).toBe(true);
 }finally{spy.mockRestore()}
});
test('independent: timer cancellation occurs on unmount, not solely callback denial',async()=>{
 await ready();const spy=jest.spyOn(globalThis,'setTimeout'),clear=jest.spyOn(globalThis,'clearTimeout');try{
 save.mockResolvedValueOnce({isFirstVisit:false,totalVisits:2});await tap();const i=spy.mock.calls.findIndex(c=>c[1]===1100),handle=spy.mock.results[i].value;await unmount();expect(clear).toHaveBeenCalledWith(handle);
 }finally{spy.mockRestore();clear.mockRestore()}
});
test('independent: never-resolving save rejects rapid taps after search query edits',async()=>{
 await ready();save.mockReturnValueOnce(deferred().promise);await tap();const p=pick();await enter('edited');await act(async()=>{void p();void p()});expect(save).toHaveBeenCalledTimes(1);expect(mockReplace).not.toHaveBeenCalled();
});
test('independent: same-account rerender preserves live first celebration dismissal',async()=>{
 await ready();await tap();await act(async()=>tree.update(<AddTab/>));await act(async()=>tree.root.findByType('FirstCelebration').props.onDismiss());expect(mockReplace).toHaveBeenCalledTimes(1);
});
test('independent: malformed current save reply gives error and permits retry',async()=>{
 await ready();save.mockResolvedValueOnce(undefined);await tap();expect(Alert.alert).toHaveBeenCalledTimes(1);await tap();expect(save).toHaveBeenCalledTimes(2);expect(tree.root.findByType('FirstCelebration').props.visible).toBe(true);
});
test('independent: synchronous writer throw does not retain admission',async()=>{
 await ready();save.mockImplementationOnce(()=>{throw Error('sync')});await tap();expect(Alert.alert).toHaveBeenCalledWith("Couldn't save",'sync');await tap();expect(save).toHaveBeenCalledTimes(2);
});
