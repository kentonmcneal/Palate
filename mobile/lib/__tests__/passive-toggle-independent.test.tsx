import React from "react";
const {create,act}=require("react-test-renderer");
import AsyncStorage from "@react-native-async-storage/async-storage";
import {Linking} from "react-native";
import {PassiveCaptureToggle} from "../../components/PassiveCaptureToggle";
import {setUsernameGateAccount,__resetUsernameGate} from "../username-gate";
import {readFlag,isFlagEnabled} from "../flags";
import * as Location from "expo-location";
const mockPush=jest.fn(),mockListeners=new Set<()=>void>(),mockActive=new Set<(state:string)=>void>();let mockFocus=true;
jest.mock("expo-router",()=>({useRouter:()=>({push:mockPush}),useFocusEffect:(cb:any)=>require("react").useEffect(()=>mockFocus?cb():undefined,[cb,mockFocus])}));
jest.mock("react-native",()=>({View:"View",Switch:"Switch",StyleSheet:{create:(x:any)=>x},Linking:{openSettings:jest.fn(async()=>{})},AppState:{addEventListener:(_event:string,cb:(s:string)=>void)=>{mockActive.add(cb);return{remove:()=>mockActive.delete(cb)}}}}));
jest.mock("../../components/Text",()=>({Text:"Text"}));
jest.mock("../../components/Button",()=>({Button:"Button",Spacer:()=>null}));
jest.mock("../../theme",()=>({colors:{},type:{body:{},small:{}}}));
jest.mock("../personal-signal",()=>({onPersonalSignalInvalidate:(cb:()=>void)=>{mockListeners.add(cb);return()=>mockListeners.delete(cb)}}));
jest.mock("../flags",()=>({readFlag:jest.fn(async()=>true),isFlagEnabled:jest.fn(async()=>true)}));
jest.mock("../analytics",()=>({track:jest.fn()}));
jest.mock("../../modules/palate-visit-monitor",()=>({isVisitMonitorAvailable:true,PalateVisitMonitor:{authorizationStatus:jest.fn(()=>"always"),startMonitoring:jest.fn(),stopMonitoring:jest.fn()}}));
jest.mock("expo-location",()=>({getForegroundPermissionsAsync:jest.fn(async()=>({status:"granted"})),getBackgroundPermissionsAsync:jest.fn(async()=>({status:"granted"})),requestForegroundPermissionsAsync:jest.fn(),requestBackgroundPermissionsAsync:jest.fn()}));
// Real passive-capture and passive-permissions; mocks only storage/OS/remote boundaries.
Object.defineProperty(globalThis,"fetch",{configurable:true,value:()=>{throw Error("Network forbidden")}});
const native=jest.requireMock("../../modules/palate-visit-monitor");
const KEY="palate.passive.optIn",STAMP="palate.passive.optInAt";
const originalGet=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!,originalSet=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
let tree:any;
const defer=()=>{let resolve!:(v:any)=>void,reject!:(v:any)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}};
const content=()=>JSON.stringify(tree.toJSON());
const toggle=()=>tree.root.findByType("Switch");
const button=(title:string)=>tree.root.findAllByType("Button").find((x:any)=>x.props.title===title);
async function flush(){await act(async()=>{for(let i=0;i<16;i++)await Promise.resolve()})}
async function mount(strict=false){await act(async()=>{tree=create(strict?<React.StrictMode><PassiveCaptureToggle/></React.StrictMode>:<PassiveCaptureToggle/>)});await flush()}
async function change(next:boolean){await act(async()=>toggle().props.onValueChange(next));await flush()}
async function focus(v:boolean){mockFocus=v;await act(async()=>tree.update(<PassiveCaptureToggle/>));await flush()}
async function active(){await act(async()=>{for(const cb of mockActive)cb("active")});await flush()}
async function press(title:string){await act(async()=>button(title).props.onPress());await flush()}
async function resolve(p:any,v:any){await act(async()=>p.resolve(v));await flush()}
beforeEach(async()=>{jest.restoreAllMocks();jest.clearAllMocks();(AsyncStorage.getItem as jest.Mock).mockReset().mockImplementation(originalGet);(AsyncStorage.setItem as jest.Mock).mockReset().mockImplementation(originalSet);await AsyncStorage.clear();__resetUsernameGate();setUsernameGateAccount("A");mockFocus=true;native.isVisitMonitorAvailable=true;native.PalateVisitMonitor.authorizationStatus.mockReset().mockReturnValue("always");native.PalateVisitMonitor.startMonitoring.mockReset();native.PalateVisitMonitor.stopMonitoring.mockReset();(readFlag as jest.Mock).mockReset().mockResolvedValue(true);(isFlagEnabled as jest.Mock).mockReset().mockResolvedValue(true);});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());tree=null;mockListeners.clear();mockActive.clear();expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled()});


test("old repair settlement cannot unlock newer pending repair",async()=>{await AsyncStorage.setItem(KEY,"1");native.PalateVisitMonitor.authorizationStatus.mockReturnValue("whenInUse");await mount();const first=defer(),second=defer();(Linking.openSettings as jest.Mock).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);await press("Review phone location settings");await focus(false);await focus(true);await press("Review phone location settings");await resolve(first,undefined);await press("Review phone location settings");expect(Linking.openSettings).toHaveBeenCalledTimes(2);await resolve(second,undefined)});
test("read-only Check again never retries failed stop",async()=>{await AsyncStorage.setItem(KEY,"1");await mount();native.PalateVisitMonitor.stopMonitoring.mockImplementationOnce(()=>{throw Error("stop")});await change(false);await press("Check again");expect(native.PalateVisitMonitor.stopMonitoring).toHaveBeenCalledTimes(1);expect(toggle().props.value).toBe(false)});
test("late repair rejection after account change does not show error",async()=>{await AsyncStorage.setItem(KEY,"1");native.PalateVisitMonitor.authorizationStatus.mockReturnValue("whenInUse");await mount();const p=defer();(Linking.openSettings as jest.Mock).mockReturnValueOnce(p.promise);await press("Review phone location settings");await act(async()=>{setUsernameGateAccount("B");for(const cb of mockListeners)cb()});await act(async()=>p.reject(Error("old")));await flush();expect(content()).not.toContain("Couldn’t open phone settings")});
test("stop retry callback from prior state cannot revoke newly saved consent",async()=>{await AsyncStorage.setItem(KEY,"1");await mount();native.PalateVisitMonitor.stopMonitoring.mockImplementationOnce(()=>{throw Error("stop")});await change(false);const retry=button("Try turning off again").props.onPress;await change(true);await act(async()=>retry());expect(await AsyncStorage.getItem(KEY)).toBe("1");expect(native.PalateVisitMonitor.stopMonitoring).toHaveBeenCalledTimes(1)});
