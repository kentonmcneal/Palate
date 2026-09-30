import AsyncStorage from '@react-native-async-storage/async-storage';
import { processPendingVisits } from '../passive-runner';
import { drainNativeVisits,getQueuedVisits } from '../passive-capture';
import { PalateVisitMonitor } from '../../modules/palate-visit-monitor';
import {qualifyVisit,resolveVenue} from '../passive-pipeline';
// Explicit storage boundary preserves empty strings and permits spies without
// mutating the implementation of the official mock's already-mocked getter.
jest.mock('@react-native-async-storage/async-storage',()=>{
 const store=new Map<string,string>();
 return {__esModule:true,default:{getItem:async(k:string)=>store.get(k)??null,setItem:async(k:string,v:string)=>{store.set(k,v)},removeItem:async(k:string)=>{store.delete(k)},clear:async()=>{store.clear()}}};
});
jest.mock('../analytics',()=>({track:jest.fn()}));
jest.mock('../observability',()=>({breadcrumb:jest.fn()}));
jest.mock('../flags',()=>({isFlagEnabled:jest.fn(async()=>true),readFlag:jest.fn(async()=>true)}));
jest.mock('../../modules/palate-visit-monitor',()=>({isVisitMonitorAvailable:true,logDetectorNote:jest.fn(),PalateVisitMonitor:{getPendingVisits:jest.fn(),clearVisits:jest.fn()}}));
jest.mock('../passive-pipeline',()=>({qualifyVisit:jest.fn(async()=>({ok:false,reason:'dwell-too-short'})),recordForClustering:jest.fn(),resolveVenue:jest.fn()}));
jest.mock('../passive-confirm',()=>({notifyOrInbox:jest.fn()}));
const native=PalateVisitMonitor!;const PROC='palate.passive.processedIds',RETRY='palate.passive.retryQueue',RAW='palate.passiveCapture.queue';
const visit={id:'new',lat:40,lng:-73,horizontalAccuracy:10,arrivalAt:1000,departureAt:2000,capturedAt:2000,source:'stop'};
beforeEach(async()=>{jest.restoreAllMocks();jest.clearAllMocks();await AsyncStorage.clear();(native.getPendingVisits as jest.Mock).mockReturnValue([visit]);});
afterEach(()=>jest.restoreAllMocks());

test('legacy identity-only durable rows reach qualification without invented field migration',async()=>{
 (native.getPendingVisits as jest.Mock).mockReturnValue([]);await AsyncStorage.setItem(RAW,JSON.stringify([{id:'legacy'}]));await processPendingVisits();expect(qualifyVisit).toHaveBeenCalledWith({id:'legacy'});expect(JSON.parse((await AsyncStorage.getItem(RAW))!)).toEqual([{id:'legacy'}]);
});
test('valid zero-attempt zero-date legacy retry remains processable',async()=>{
 (native.getPendingVisits as jest.Mock).mockReturnValue([]);await AsyncStorage.setItem(RETRY,JSON.stringify([{raw:{id:'retry'},attempts:0,firstFailedAt:0}]));expect((await processPendingVisits()).retried).toBe(1);expect(qualifyVisit).toHaveBeenCalledWith({id:'retry'});
});
test('duplicate processed IDs remain readable and suppress native raw work',async()=>{
 await AsyncStorage.setItem(PROC,JSON.stringify(['new','new']));expect((await processPendingVisits()).detected).toBe(0);expect(qualifyVisit).not.toHaveBeenCalled();expect(native.clearVisits).toHaveBeenCalledWith(['new']);
});
test('raw merge write failure never acknowledges native and later recovers older data',async()=>{
 await AsyncStorage.setItem(RAW,JSON.stringify([{id:'older'}]));jest.spyOn(AsyncStorage,'setItem').mockRejectedValueOnce(Error('disk full'));await expect(processPendingVisits()).rejects.toThrow('disk full');expect(native.clearVisits).not.toHaveBeenCalled();expect(JSON.parse((await AsyncStorage.getItem(RAW))!)).toEqual([{id:'older'}]);await processPendingVisits();expect(native.clearVisits).toHaveBeenCalledWith(['new']);expect(JSON.parse((await AsyncStorage.getItem(RAW))!).map((x:any)=>x.id)).toEqual(['older','new']);
});
test('native clear failure leaves durable handoff and permits retry',async()=>{
 (native.clearVisits as jest.Mock).mockImplementationOnce(()=>{throw Error('native unavailable')});await expect(processPendingVisits()).rejects.toThrow('native unavailable');expect(JSON.parse((await AsyncStorage.getItem(RAW))!).map((x:any)=>x.id)).toEqual(['new']);await processPendingVisits();expect(qualifyVisit).toHaveBeenCalledTimes(1);
});
test('empty native queue still refuses corrupt durable queue',async()=>{
 (native.getPendingVisits as jest.Mock).mockReturnValue([]);await AsyncStorage.setItem(RAW,'{');await expect(drainNativeVisits()).rejects.toThrow();expect(native.clearVisits).not.toHaveBeenCalled();expect(await AsyncStorage.getItem(RAW)).toBe('{');
});
for(const key of [PROC,RETRY])test(`${key} read failure releases guard without native access and retries`,async()=>{
 const read=AsyncStorage.getItem.bind(AsyncStorage);jest.spyOn(AsyncStorage,'getItem').mockImplementation(async k=>{if(k===key)throw Error('blocked');return read(k)});await expect(processPendingVisits()).rejects.toThrow('blocked');expect(native.getPendingVisits).not.toHaveBeenCalled();jest.restoreAllMocks();expect((await processPendingVisits()).detected).toBe(1);
});
test('retry invalid identity refuses before native when raw queue also unavailable',async()=>{
 await AsyncStorage.setItem(RETRY,JSON.stringify([{raw:{id:'   '},attempts:1,firstFailedAt:1}]));await AsyncStorage.setItem(RAW,'{');await expect(processPendingVisits()).rejects.toThrow('retry queue');expect(native.getPendingVisits).not.toHaveBeenCalled();
});
test('native-unavailable branch uses strict queue read and accepts valid legacy rows',async()=>{
 const bridge=require('../../modules/palate-visit-monitor');bridge.isVisitMonitorAvailable=false;
 try {await AsyncStorage.setItem(RAW,'{');await expect(drainNativeVisits()).rejects.toThrow();expect(native.getPendingVisits).not.toHaveBeenCalled();await AsyncStorage.setItem(RAW,JSON.stringify([{id:'legacy'}]));await expect(drainNativeVisits()).resolves.toEqual([{id:'legacy'}]);expect(native.clearVisits).not.toHaveBeenCalled();}finally{bridge.isVisitMonitorAvailable=true;}
});
