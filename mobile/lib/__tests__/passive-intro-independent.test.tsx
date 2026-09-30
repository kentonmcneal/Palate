import React from 'react';
const {create, act} = require('react-test-renderer');
import Intro from '../../app/passive-capture-intro';
import WhyLocation from '../../app/onboarding/why-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {isFlagEnabled} from '../flags';
import {setPassiveOptIn} from '../passive-capture';
import {setUsernameGateAccount} from '../username-gate';
import {Linking} from 'react-native';
import {ensureNotificationPermission} from '../notifications';
const mockBack=jest.fn(), mockReplace=jest.fn(); let mockFocus=true;
jest.mock('expo-router',()=>({useRouter:()=>({back:mockBack,replace:mockReplace,push:jest.fn()}),useLocalSearchParams:()=>({next:'/onboarding/done'}),useFocusEffect:(cb:any)=>require('react').useEffect(()=>mockFocus?cb():undefined,[cb,mockFocus])}));
jest.mock('react-native',()=>({View:'View',ScrollView:'ScrollView',Pressable:'Pressable',StyleSheet:{create:(v:any)=>v},Alert:{alert:jest.fn()},Linking:{openSettings:jest.fn(async()=>{})}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
jest.mock('../../components/Text',()=>({Text:'Text'}));
jest.mock('../../components/Button',()=>({Button:'Button',Spacer:()=>null}));
jest.mock('../../theme',()=>({colors:{},spacing:{},type:{}}));
jest.mock('../analytics',()=>({track:jest.fn()}));
jest.mock('../flags',()=>({isFlagEnabled:jest.fn(async()=>true)}));
jest.mock('../notifications',()=>({ensureNotificationPermission:jest.fn(async()=>false)}));
jest.mock('../../modules/palate-visit-monitor',()=>({isVisitMonitorAvailable:true,PalateVisitMonitor:{authorizationStatus:jest.fn(()=> 'always'),startMonitoring:jest.fn(),stopMonitoring:jest.fn()}}));
jest.mock('expo-location',()=>({getForegroundPermissionsAsync:jest.fn(async()=>({status:'granted'})),getBackgroundPermissionsAsync:jest.fn(async()=>({status:'granted'})),requestForegroundPermissionsAsync:jest.fn(async()=>({status:'denied'})),requestBackgroundPermissionsAsync:jest.fn(async()=>({status:'denied',canAskAgain:false}))}));
Object.defineProperty(globalThis,'fetch',{configurable:true,value:()=>{throw Error('Network forbidden')}});
const native=jest.requireMock('../../modules/palate-visit-monitor');
const originalGet=(AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
const originalSet=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
let tree:any;
const deferred=()=>{let resolve!:(v?:any)=>void;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
const text=()=>JSON.stringify(tree.toJSON());
const button=(title:string)=>tree.root.findAllByType('Button').find((b:any)=>b.props.title===title);
const enable=()=>button('Enable background suggestions')||button('Enable passive logging');
async function flush(){await act(async()=>{for(let i=0;i<25;i++)await Promise.resolve()})}
async function mount(){await act(async()=>{tree=create(<Intro/>)});await flush()}
async function press(b:any){await act(async()=>{await b.props.onPress()});await flush()}
async function focus(v:boolean){mockFocus=v;await act(async()=>tree.update(<Intro/>));await flush()}
beforeEach(async()=>{setUsernameGateAccount("A");jest.clearAllMocks();(AsyncStorage.getItem as jest.Mock).mockReset().mockImplementation(originalGet);(AsyncStorage.setItem as jest.Mock).mockReset().mockImplementation(originalSet);await setPassiveOptIn(false);await AsyncStorage.clear();jest.clearAllMocks();native.isVisitMonitorAvailable=true;native.PalateVisitMonitor.authorizationStatus.mockReturnValue('always');native.PalateVisitMonitor.startMonitoring.mockReset();(isFlagEnabled as jest.Mock).mockReset().mockResolvedValue(true);(ensureNotificationPermission as jest.Mock).mockReset().mockResolvedValue(false);(Linking.openSettings as jest.Mock).mockReset().mockResolvedValue(undefined);const loc=jest.requireMock('expo-location');loc.getForegroundPermissionsAsync.mockResolvedValue({status:'granted'});loc.getBackgroundPermissionsAsync.mockResolvedValue({status:'granted'});mockFocus=true});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());tree=null});

test('double Not now navigates only once',async()=>{await mount();const cb=button('Not now').props.onPress;await act(async()=>{cb();cb()});expect(mockReplace).toHaveBeenCalledTimes(1)});
test('retained Not now after unmount cannot navigate',async()=>{await mount();const cb=button('Not now').props.onPress;await act(async()=>tree.unmount());tree=null;await act(async()=>cb());expect(mockReplace).not.toHaveBeenCalled()});
test('retained Not now while busy cannot escape operation',async()=>{const p=deferred();(ensureNotificationPermission as jest.Mock).mockReturnValue(p.promise);await mount();const cb=button('Not now').props.onPress;act(()=>{void enable().props.onPress()});await flush();await act(async()=>cb());expect(mockReplace).not.toHaveBeenCalled();await act(async()=>p.resolve(false));await flush()});
test.each(['B','ABA'])('account %s during permission wait cannot authorize fresh consent write',async next=>{const p=deferred();(ensureNotificationPermission as jest.Mock).mockReturnValue(p.promise);await mount();act(()=>{void enable().props.onPress()});await flush();setUsernameGateAccount('B');if(next==='ABA')setUsernameGateAccount('A');await act(async()=>p.resolve(false));await flush();expect(await AsyncStorage.getItem('palate.passive.optIn')).toBeNull();expect(native.PalateVisitMonitor.startMonitoring).not.toHaveBeenCalled();expect(text()).toContain("couldn't confirm setup");expect(button('Retry background check').props.loading).toBe(false)});
