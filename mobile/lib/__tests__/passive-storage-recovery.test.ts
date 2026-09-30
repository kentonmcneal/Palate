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
for(const key of [PROC,RETRY,RAW])test.each(['read-failure','invalid-json','wrong-shape','invalid-entry','empty-string'])(`${key} %s preserves bytes and native records`,async(kind)=>{
 const text=kind==='read-failure'?'[]':kind==='invalid-json'?'{':kind==='wrong-shape'?'{}':kind==='invalid-entry'?'[null]':'';
 await AsyncStorage.setItem(key,text);const read=AsyncStorage.getItem.bind(AsyncStorage);
 if(kind==='read-failure'||kind==='empty-string')jest.spyOn(AsyncStorage,'getItem').mockImplementation(async k=>{if(k===key){if(kind==='read-failure')throw Error('unavailable');return '';}return read(k)});
 const write=jest.spyOn(AsyncStorage,'setItem').mockClear();
 await expect(processPendingVisits()).rejects.toThrow();expect(native.clearVisits).not.toHaveBeenCalled();expect(qualifyVisit).not.toHaveBeenCalled();expect(resolveVenue).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
 if(key!==RAW)expect(native.getPendingVisits).not.toHaveBeenCalled();
});
test('raw queue display fallback cannot authorize native drain replacement',async()=>{
 await AsyncStorage.setItem(RAW,'{');expect(await getQueuedVisits()).toEqual([]);await expect(drainNativeVisits()).rejects.toThrow();expect(native.clearVisits).not.toHaveBeenCalled();expect(await AsyncStorage.getItem(RAW)).toBe('{');
});
test('read recovery releases runner and preserves older queued record',async()=>{
 const old={...visit,id:'old'};await AsyncStorage.setItem(RAW,JSON.stringify([old]));const get=AsyncStorage.getItem.bind(AsyncStorage);jest.spyOn(AsyncStorage,'getItem').mockRejectedValueOnce(Error('temporary'));
 await expect(processPendingVisits()).rejects.toThrow();expect(native.getPendingVisits).not.toHaveBeenCalled();
 const result=await processPendingVisits();expect(result.detected).toBe(2);expect(native.clearVisits).toHaveBeenCalledWith(['new']);expect(JSON.parse((await get(RAW))!).map((r:any)=>r.id)).toEqual(['old','new']);
});
test.each([{attempts:-1},{attempts:1.5},{attempts:'1'},{firstFailedAt:-1},{firstFailedAt:null},{raw:{id:''}}])('malformed retry metadata %j blocks before drain',async(patch)=>{
 await AsyncStorage.setItem(RETRY,JSON.stringify([{raw:visit,attempts:1,firstFailedAt:1000,...patch}]));await expect(processPendingVisits()).rejects.toThrow();expect(native.getPendingVisits).not.toHaveBeenCalled();
});
test('verified missing queues permit capture and processed IDs suppress repeat work',async()=>{
 expect((await processPendingVisits()).detected).toBe(1);expect(qualifyVisit).toHaveBeenCalledTimes(1);expect((await processPendingVisits()).detected).toBe(0);expect(qualifyVisit).toHaveBeenCalledTimes(1);
});
