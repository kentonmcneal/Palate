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
jest.mock("../passive-confirm",()=>({...jest.requireActual("../passive-confirm"),getInboxReadResult:jest.fn()}));
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


test.each([false,true])("actual reexport creates usable confirmation parameters cluster=%s",async cluster=>{const e={...entry("real",cluster),place_id:"place-real",address:"address",alternates:[],confidenceBand:"medium",source:"stop"};read.mockResolvedValue(ready([e]));await mount();await act(async()=>row().props.onPress());expect(mockPush).toHaveBeenCalledWith({pathname:cluster?"/confirm-multi":"/confirm-visit",params:expect.objectContaining({inbox_id:"real",place_id:"place-real",alternates:"[]",confidence:"medium",cluster:cluster?"1":""})});expect(jest.requireActual("../passive-confirm").confirmParamsFor).toBe(jest.requireActual("../passive-digest").confirmParamsFor)});

jest.mock("expo-notifications",()=>({}));
jest.mock("../observability",()=>({captureError:jest.fn()}));
jest.mock("../visits",()=>({}));
jest.mock("../passive-inbox-sync",()=>({}));
jest.mock("../passive-pipeline",()=>({}));
jest.mock("../eating-pattern",()=>({}));
