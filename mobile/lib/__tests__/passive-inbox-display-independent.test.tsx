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

test("retained Back after account invalidation before rerender is inert",async()=>{await mount();const back=buttons()[0].props.onPress;setUsernameGateAccount("B");await act(async()=>back());expect(mockBack).not.toHaveBeenCalled()});
test("retained Back after blur is inert",async()=>{await mount();const back=buttons()[0].props.onPress;await focus(false);await act(async()=>back());expect(mockBack).not.toHaveBeenCalled()});
test("current signed-out Back still works",async()=>{setUsernameGateAccount(null);await mount();await act(async()=>buttons()[0].props.onPress());expect(mockBack).toHaveBeenCalledTimes(1)});
test("successful empty retry replaces unavailable with verified empty",async()=>{read.mockResolvedValueOnce({status:"unavailable"});await mount();await act(async()=>retry().props.onPress());await flush();expect(text()).toContain("Nothing to confirm");expect(text()).not.toContain("Couldn’t load")});
test("stale failed request cannot admit overlapping retry while newer request pending",async()=>{const old=d(),fresh=d();read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);await mount();await focus(false);await focus(true);await act(async()=>old.reject(Error("stale")));await refresh();expect(read).toHaveBeenCalledTimes(2);await resolve(fresh,ready());expect(text()).toContain("Nothing to confirm")});
