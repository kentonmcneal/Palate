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
let mockSessionRead:any=null,mockAuthCallback:any=null;
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush}),useFocusEffect:(cb:any)=>require('react').useEffect(cb,[cb])}));
jest.mock('../analytics',()=>({track:jest.fn()}));
jest.mock('../flags',()=>({isFlagEnabled:jest.fn(async()=>false)}));
jest.mock('../haptics',()=>({triggerHapticSelection:jest.fn()}));
jest.mock('../a11y',()=>({FONT_CAP:{chrome:1},useFontScale:()=>({stack:false})}));
jest.mock('../supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'fixture'}}}),getSession:()=>mockSessionRead??Promise.resolve({data:{session:{user:{id:'fixture'}}}}),onAuthStateChange:(cb:any)=>{mockAuthCallback=cb;return{data:{subscription:{unsubscribe:jest.fn()}}}}}}}));
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
beforeEach(async()=>{mockSessionRead=null;mockAuthCallback=null;jest.restoreAllMocks();jest.clearAllMocks();(AsyncStorage.getItem as jest.Mock).mockReset().mockImplementation(originalGet!);await AsyncStorage.clear();await AsyncStorage.setItem('palate.passive.optIn','1');native.isVisitMonitorAvailable=true;native.PalateVisitMonitor.authorizationStatus.mockReturnValue('always');(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({granted:true,ios:{status:2}});(Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({status:'granted'});(Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({status:'granted'});jest.spyOn(AppState,'addEventListener').mockImplementation((_event,cb:any)=>{foreground=()=>cb('active');return{remove:jest.fn()}});jest.spyOn(Linking,'openSettings').mockResolvedValue();});
afterEach(async()=>{if(tree){await act(async()=>tree.unmount());tree=null}expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();expect(native.PalateVisitMonitor.startMonitoring).not.toHaveBeenCalled();expect(jest.requireMock('../flags').isFlagEnabled).not.toHaveBeenCalled();});

test('late initial session cannot redisplay strip after signout',async()=>{const d=deferred();mockSessionRead=d.promise;await AsyncStorage.setItem('palate.passive.optIn','0');await mount(<CaptureWarning/>);await act(async()=>{mockAuthCallback('SIGNED_OUT',null);await flush()});await act(async()=>{d.resolve({data:{session:{user:{id:'A'}}}});await flush()});expect(content()).toBe('')});
test('late initial signedout result cannot hide strip after signin',async()=>{const d=deferred();mockSessionRead=d.promise;await AsyncStorage.setItem('palate.passive.optIn','0');await mount(<CaptureWarning/>);await act(async()=>{mockAuthCallback('SIGNED_IN',{user:{id:'B'}});await flush()});await act(async()=>{d.resolve({data:{session:null}});await flush()});expect(content()).toContain('Passive capture is off')});
test('Home success gives short permission-only copy',async()=>{await mount(<TrackingLine on={false} lastCheck="old"/>);expect(content()).toBe('Location and notifications are allowed. Review suggested food or drink stops before adding them.');expect(mockPush).not.toHaveBeenCalled()});
test('Profile quiet status gives short permission-only copy',async()=>{(Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({granted:false,ios:{status:3}});await mount(<MyProfileScreen/>);expect(content()).toContain('Location is allowed. Notifications may arrive quietly. Review suggested food or drink stops before adding them.')});
