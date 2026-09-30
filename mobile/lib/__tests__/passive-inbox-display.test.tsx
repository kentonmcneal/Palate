import React from "react";
const {create,act}=require("react-test-renderer");
import Screen from "../../app/passive-inbox";
import {getInboxReadResult} from "../passive-confirm";
import {setUsernameGateAccount,__resetUsernameGate} from "../username-gate";
let mockFocus=true;
const mockPush=jest.fn(),mockBack=jest.fn(),mockListeners=new Set<()=>void>();
jest.mock("expo-router",()=>({useRouter:()=>({push:mockPush,back:mockBack}),useFocusEffect:(cb:any)=>require("react").useEffect(()=>mockFocus?cb():undefined,[cb,mockFocus])}));
jest.mock("react-native",()=>({View:"View",Pressable:"Pressable",StyleSheet:{create:(x:any)=>x},FlatList:(p:any)=>require("react").createElement("List",{onRefresh:p.onRefresh,refreshing:p.refreshing},p.ListHeaderComponent,p.data.length?p.data.map((item:any)=>require("react").createElement(require("react").Fragment,{key:item.id},p.renderItem({item}))):p.ListEmptyComponent)}));
jest.mock("react-native-safe-area-context",()=>({SafeAreaView:"SafeAreaView"}));
jest.mock("../../components/Text",()=>({Text:"Text"}));
jest.mock("../../theme",()=>({colors:{},spacing:{},type:{}}));
jest.mock("../analytics",()=>({track:jest.fn(async()=>{})}));
jest.mock("../personal-signal",()=>({onPersonalSignalInvalidate:(cb:()=>void)=>{mockListeners.add(cb);return()=>mockListeners.delete(cb)}}));
jest.mock("../passive-confirm",()=>({getInboxReadResult:jest.fn(),getInbox:jest.fn(async()=>[]),confirmParamsFor:(e:any)=>({inboxId:e.id})}));
Object.defineProperty(globalThis,"fetch",{configurable:true,value:()=>{throw Error("Network forbidden")}});
const read=getInboxReadResult as jest.Mock;
let tree:any;
const d=()=>{let resolve!:(x:any)=>void,reject!:(x:any)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}};
const entry=(id="cafe",cluster=false)=>({id,name:id,cluster,detectedAt:Date.now(),dwellMin:10});
const ready=(entries:any[]=[])=>({status:"ready",entries});
const text=()=>JSON.stringify(tree.toJSON());
const list=()=>tree.root.findByType("List");
const buttons=()=>tree.root.findAllByType("Pressable");
const retry=()=>buttons().find((x:any)=>x.findAllByType("Text").some((t:any)=>t.props.children==="Try again"));
const row=()=>buttons().find((x:any)=>x.props.disabled!==undefined);
async function flush(){await act(async()=>{for(let i=0;i<8;i++)await Promise.resolve()})}
async function mount(strict=false){await act(async()=>{tree=create(strict?<React.StrictMode><Screen/></React.StrictMode>:<Screen/>)});await flush()}
async function refresh(){await act(async()=>{void list().props.onRefresh()});await flush()}
async function focus(value:boolean){mockFocus=value;await act(async()=>tree.update(<Screen/>));await flush()}
async function resolve(p:any,value:any){await act(async()=>p.resolve(value));await flush()}
beforeEach(()=>{jest.clearAllMocks();__resetUsernameGate();setUsernameGateAccount("A");mockFocus=true;read.mockReset();read.mockResolvedValue(ready());});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());tree=null;mockListeners.clear()});
test("initial pending is loading, not verified empty",async()=>{read.mockReturnValue(d().promise);await mount();expect(text()).toContain("Loading recent visits");expect(text()).not.toContain("Nothing to confirm")});
test("verified empty alone displays empty state",async()=>{await mount();expect(text()).toContain("Nothing to confirm");expect(text()).not.toContain("Couldn’t load")});
test("unavailable read has retry, not empty",async()=>{read.mockResolvedValue({status:"unavailable"});await mount();expect(text()).toContain("Couldn’t load");expect(text()).toContain("Try again");expect(text()).not.toContain("Nothing to confirm")});
test("unexpected rejection is contained",async()=>{read.mockRejectedValue(Error("storage"));await mount();expect(text()).toContain("Couldn’t load")});
test("repeated retry admits one pending read and recovers",async()=>{read.mockResolvedValueOnce({status:"unavailable"});await mount();const p=d();read.mockReturnValueOnce(p.promise);const press=retry().props.onPress;await act(async()=>{void press();void press()});expect(read).toHaveBeenCalledTimes(2);await resolve(p,ready([entry()]));expect(text()).toContain("cafe");expect(text()).not.toContain("Couldn’t load")});
test("failed refresh retains rows but disables cached confirmation",async()=>{read.mockResolvedValueOnce(ready([entry()]));await mount();const stale=row().props.onPress;read.mockResolvedValueOnce({status:"unavailable"});await refresh();expect(text()).toContain("cafe");expect(text()).toContain("Previously loaded");expect(row().props.disabled).toBe(true);await act(async()=>stale());expect(mockPush).not.toHaveBeenCalled();read.mockResolvedValueOnce(ready());await refresh();expect(text()).not.toContain('"cafe"');expect(text()).toContain("Nothing to confirm")});
test("pending refresh preserves rows and blocks retained row press",async()=>{read.mockResolvedValueOnce(ready([entry()]));await mount();const stale=row().props.onPress;read.mockReturnValueOnce(d().promise);await refresh();expect(text()).toContain("cafe");expect(text()).toContain("Checking recent");await act(async()=>stale());expect(mockPush).not.toHaveBeenCalled()});
test.each([false,true])("single/cluster navigation retains correct route %s",async cluster=>{read.mockResolvedValue(ready([entry("stop",cluster)]));await mount();const press=row().props.onPress;await act(async()=>{press();press()});expect(mockPush).toHaveBeenCalledTimes(1);expect(mockPush).toHaveBeenCalledWith({pathname:cluster?"/confirm-multi":"/confirm-visit",params:{inboxId:"stop"}})});
test.each(["success","failure"])("blur/refocus newer read wins over old %s",async outcome=>{const old=d(),fresh=d();read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);await mount();await focus(false);await focus(true);await resolve(fresh,ready([entry("new")]));await resolve(old,outcome==="success"?ready([entry("old")]):{status:"unavailable"});expect(text()).toContain('"new"');expect(text()).not.toContain('"old"');expect(text()).not.toContain("Couldn’t load")});
test("old completion cannot clear current loading",async()=>{const old=d(),fresh=d();read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);await mount();await focus(false);await focus(true);await resolve(old,ready());expect(list().props.refreshing).toBe(true);await resolve(fresh,ready());expect(list().props.refreshing).toBe(false)});
test("blur rejects retained refresh/choice",async()=>{read.mockResolvedValue(ready([entry()]));await mount();const press=row().props.onPress,refresh=list().props.onRefresh;await focus(false);await act(async()=>{press();void refresh()});expect(mockPush).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(1)});
test.each(["B","ABA",null])("account %s clears visible rows and ignores stale outcome",async target=>{read.mockResolvedValueOnce(ready([entry("A-row")]));await mount();const press=row().props.onPress;const old=d();read.mockReturnValueOnce(old.promise);await refresh();await act(async()=>{setUsernameGateAccount(target==="ABA"?"B":target);if(target==="ABA")setUsernameGateAccount("A");for(const cb of mockListeners)cb()});await flush();expect(text()).not.toContain("A-row");await act(async()=>press());expect(mockPush).not.toHaveBeenCalled();await resolve(old,ready([entry("old-result")]));expect(text()).not.toContain("old-result")});
test("account invalidation before render blocks old callback",async()=>{read.mockResolvedValue(ready([entry()]));await mount();const press=row().props.onPress;setUsernameGateAccount("B");await act(async()=>press());expect(mockPush).not.toHaveBeenCalled()});
test("same account signal does not reset or reload",async()=>{read.mockResolvedValue(ready([entry()]));await mount();await act(async()=>{setUsernameGateAccount("A");for(const cb of mockListeners)cb()});expect(read).toHaveBeenCalledTimes(1);expect(text()).toContain("cafe")});
test("signed out does not read or claim verified empty",async()=>{setUsernameGateAccount(null);await mount();expect(read).not.toHaveBeenCalled();expect(text()).toContain("account is ready");expect(text()).not.toContain("Nothing to confirm")});
test("back invalidates requests and repeated back",async()=>{const p=d();read.mockReturnValue(p.promise);await mount();const back=buttons()[0].props.onPress;await act(async()=>{back();back()});expect(mockBack).toHaveBeenCalledTimes(1);await resolve(p,ready([entry("late")]));expect(text()).not.toContain("late")});
test("unmount rejects retained callbacks and late failure",async()=>{const p=d();read.mockReturnValue(p.promise);await mount();const refresh=list().props.onRefresh;await act(async()=>tree.unmount());tree=null;await act(async()=>{void refresh();p.reject(Error("late"))});expect(read).toHaveBeenCalledTimes(1);expect(mockPush).not.toHaveBeenCalled()});
test("StrictMode replay ignores abandoned load",async()=>{const first=d();read.mockReturnValueOnce(first.promise).mockResolvedValue(ready([entry("current")]));await mount(true);await resolve(first,ready([entry("abandoned")]));expect(text()).toContain("current");expect(text()).not.toContain("abandoned")});
