import React from 'react';
const {create,act}=require('react-test-renderer');
import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppState,Linking} from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {captureStatus} from '../capture-status';
import {readPassiveOptInForStatus,isPassiveOptedIn} from '../passive-capture';
import {readPermissionStateForStatus,currentPermissionState} from '../passive-permissions';
import {readNotificationPermissionForStatus,notificationsGranted} from '../notifications';
import {CaptureWarning,useCaptureStatus} from '../../components/CaptureWarning';
import {TrackingLine} from '../../components/HomeHero';
import MyProfileScreen from '../../app/(tabs)/me';
const mockPush=jest.fn();
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush}),useFocusEffect:(cb:any)=>require('react').useEffect(cb,[cb])}));
jest.mock('../analytics',()=>({track:jest.fn()}));
jest.mock('../flags',()=>({isFlagEnabled:jest.fn(async()=>false)}));
jest.mock('../haptics',()=>({triggerHapticSelection:jest.fn()}));
jest.mock('../a11y',()=>({FONT_CAP:{chrome:1},useFontScale:()=>({stack:false})}));
jest.mock('../supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'fixture'}}}),getSession:async()=>({data:{session:{user:{id:'fixture'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe:jest.fn()}}})}}}));
jest.mock('../../modules/palate-visit-monitor',()=>({isVisitMonitorAvailable:true,PalateVisitMonitor:{authorizationStatus:jest.fn(()=> 'always'),startMonitoring:jest.fn(),stopMonitoring:jest.fn()}}));
jest.mock('expo-location',()=>({getForegroundPermissionsAsync:jest.fn(),getBackgroundPermissionsAsync:jest.fn(),requestForegroundPermissionsAsync:jest.fn(),requestBackgroundPermissionsAsync:jest.fn()}));
jest.mock('expo-notifications',()=>({getPermissionsAsync:jest.fn(),requestPermissionsAsync:jest.fn(),IosAuthorizationStatus:{NOT_DETERMINED:0,DENIED:1,AUTHORIZED:2,PROVISIONAL:3,EPHEMERAL:4}}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0}),SafeAreaView:({children}:any)=>children}));
jest.mock('../../components/ProfileBody',()=>({ProfileBody:()=>null}));
jest.mock('../../components/OwnProfileConnections',()=>({OwnProfileConnections:()=>null}));
// Execute the actual notification source through TypeScript's CommonJS import
// lowering so Jest can supply the lazy Expo module. This is a test loader only;
// it does not verify Metro/ESM bundling or alter production loading behavior.
jest.mock('../notifications',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
  const file=require.resolve('../notifications');const exports={};
  const providers:Record<string,unknown>={
    '@react-native-async-storage/async-storage':{default:jest.requireMock('@react-native-async-storage/async-storage')},
    './notification-dedupe':jest.requireActual('../notification-dedupe'),
    'react-native':{Platform:jest.requireActual('react-native').Platform},
    'expo-notifications':jest.requireMock('expo-notifications'),
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:(id:string)=>{if(!(id in providers))throw Error('Unexpected import '+id);return providers[id]},console,Date});
  return exports;
});
const originalGet=(AsyncStorage.getItem as jest.Mock).getMockImplementation();
const native=jest.requireMock('../../modules/palate-visit-monitor'),base={always:true,whenInUse:true,notifications:true,optedIn:true};
let tree:any=null,foreground:()=>void;
const text=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):(n?.children||[]).map(text).join('');
const content=()=>text(tree.toJSON());
const deferred=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{resolve,promise}};
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve()};
async function mount(el:any){await act(async()=>{tree=create(<React.StrictMode>{el}</React.StrictMode>);await flush()})}
async function active(){await act(async()=>{foreground();await flush()})}
beforeEach(async()=>{jest.restoreAllMocks();jest.clearAllMocks();(AsyncStorage.getItem as jest.Mock).mockReset().mockImplementation(originalGet!);await AsyncStorage.clear();await AsyncStorage.setItem('palate.passive.optIn','1');native.isVisitMonitorAvailable=true;native.PalateVisitMonitor.authorizationStatus.mockReturnValue('always');(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({granted:true,ios:{status:2}});(Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({status:'granted'});(Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({status:'granted'});jest.spyOn(AppState,'addEventListener').mockImplementation((_event,cb:any)=>{foreground=()=>cb('active');return{remove:jest.fn()}});jest.spyOn(Linking,'openSettings').mockResolvedValue();});
afterEach(async()=>{if(tree){await act(async()=>tree.unmount());tree=null}expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();expect(native.PalateVisitMonitor.startMonitoring).not.toHaveBeenCalled();expect(jest.requireMock('../flags').isFlagEnabled).not.toHaveBeenCalled();});
test('all16 boolean combinations respect opt-in before grants',()=>{for(const optedIn of [false,true])for(const always of [false,true])for(const whenInUse of [false,true])for(const notifications of [false,true]){const s=captureStatus({optedIn,always,whenInUse,notifications});expect(s.kind).toBe(!optedIn?'opt-in':!always?'location':!notifications?'notifications':'ok');expect(s.body).not.toMatch(/meals log themselves|no way to check|^On\./);expect(s.body).toMatch(/food or drink/);}});
test('unknown reads stay unknown; confirmed off wins over unknown grants',()=>{for(const field of ['optedIn','always','notifications'])expect(captureStatus({...base,[field]:null}).kind).toBe('unknown');expect(captureStatus({...base,optedIn:false,always:null,notifications:null}).kind).toBe('opt-in')});
test('quiet permission reports provisional allowance',()=>{const s=captureStatus({...base,quietNotifications:true});expect(s.kind).toBe('ok');expect(s.body).toBe('Location is allowed. Notifications may arrive quietly. Review suggested food or drink stops before adding them.')});
test.each([null,'0','1'])('actual opt-in reader %s',async raw=>{if(raw===null)await AsyncStorage.removeItem('palate.passive.optIn');else await AsyncStorage.setItem('palate.passive.optIn',raw);expect(await readPassiveOptInForStatus()).toBe(raw==='1')});
test('opt-in errors and corruption reject; legacy helper unchanged',async()=>{await AsyncStorage.setItem('palate.passive.optIn','maybe');await expect(readPassiveOptInForStatus()).rejects.toThrow();expect(await isPassiveOptedIn()).toBe(false);jest.spyOn(AsyncStorage,'getItem').mockRejectedValue(Error('read'));await expect(readPassiveOptInForStatus()).rejects.toThrow();expect(await isPassiveOptedIn()).toBe(false)});
test.each(['always','whenInUse','denied','restricted','notDetermined'])('actual native permission %s',async state=>{native.PalateVisitMonitor.authorizationStatus.mockReturnValue(state);expect(await readPermissionStateForStatus()).toEqual({always:state==='always',whenInUse:['always','whenInUse'].includes(state)});expect(Location.getBackgroundPermissionsAsync).not.toHaveBeenCalled()});
test('native unknown and throw reject',async()=>{native.PalateVisitMonitor.authorizationStatus.mockReturnValue('unknown');await expect(readPermissionStateForStatus()).rejects.toThrow();native.PalateVisitMonitor.authorizationStatus.mockImplementation(()=>{throw Error('native')});await expect(readPermissionStateForStatus()).rejects.toThrow()});
test('no-native Expo fallback reads grants and propagates failures',async()=>{native.isVisitMonitorAvailable=false;expect(await readPermissionStateForStatus()).toEqual({whenInUse:true,always:true});(Location.getBackgroundPermissionsAsync as jest.Mock).mockRejectedValue(Error('read'));await expect(readPermissionStateForStatus()).rejects.toThrow();expect((await currentPermissionState()).always).toBe(false)});
test('actual provisional notification false-granted still permits quiet delivery',async()=>{(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({granted:false,ios:{status:3}});expect(await readNotificationPermissionForStatus()).toEqual({granted:true,quiet:true});expect(await notificationsGranted()).toBe(false)});
test('notification error rejects, legacy helper still returns false',async()=>{(Notifications.getPermissionsAsync as jest.Mock).mockRejectedValue(Error('read'));await expect(readNotificationPermissionForStatus()).rejects.toThrow();expect(await notificationsGranted()).toBe(false)});
function Probe(){const status=useCaptureStatus();return <>{status?.kind??'loading'}</>}
test('mounted unknown recovers on foreground',async()=>{jest.spyOn(AsyncStorage,'getItem').mockRejectedValue(Error('read'));await mount(<Probe/>);expect(content()).toBe('unknown');jest.mocked(AsyncStorage.getItem).mockResolvedValue('1');await active();expect(content()).toBe('ok')});
test('mounted older completion cannot replace newer opt-out',async()=>{await mount(<Probe/>);expect(content()).toBe('ok');const d=deferred();jest.spyOn(AsyncStorage,'getItem').mockImplementationOnce(()=>d.promise);await active();expect(content()).toBe('loading');jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('0');await active();expect(content()).toBe('opt-in');await act(async()=>{d.resolve('1');await flush()});expect(content()).toBe('opt-in')});
test('unmounted pending completion cannot update new mount',async()=>{await mount(<Probe/>);const d=deferred();jest.spyOn(AsyncStorage,'getItem').mockImplementationOnce(()=>d.promise);await active();await act(async()=>tree.unmount());tree=null;jest.mocked(AsyncStorage.getItem).mockResolvedValue('0');await mount(<Probe/>);expect(content()).toBe('opt-in');await act(async()=>{d.resolve('1');await flush()});expect(content()).toBe('opt-in')});
test('Home ignores stale on and lastCheck props',async()=>{await AsyncStorage.setItem('palate.passive.optIn','0');await mount(<TrackingLine on={true} lastCheck="12:34"/>);expect(content()).toMatch(/not opted in/);expect(content()).not.toMatch(/Tracking is on|12:34/)});
test('Profile shows settings, not claimed On',async()=>{await mount(<MyProfileScreen/>);expect(content()).toContain('Location and notifications are allowed. Review suggested food or drink stops before adding them.');expect(content()).not.toMatch(/On\. Location/)});
test('strip opt-out routes setup despite granted permissions',async()=>{await AsyncStorage.setItem('palate.passive.optIn','0');await mount(<CaptureWarning/>);expect(content()).toMatch(/Passive capture is off/);const b=tree.root.findAll((n:any)=>n.props.accessibilityRole==='button'&&typeof n.props.onPress==='function');await act(async()=>b[0].props.onPress());expect(mockPush).toHaveBeenCalledWith('/passive-capture-intro')});
test('unknown strip offers no misleading permission repair',async()=>{jest.spyOn(AsyncStorage,'getItem').mockRejectedValue(Error('read'));await mount(<CaptureWarning/>);expect(content()).toMatch(/could not be checked/);expect(tree.root.findAll((n:any)=>n.props.accessibilityRole==='button'&&typeof n.props.onPress==='function')).toHaveLength(0);expect(Linking.openSettings).not.toHaveBeenCalled()});

test('opted-out with both OS grants never says ok',()=>{expect(captureStatus({...base,optedIn:false}).kind).toBe('opt-in')});
