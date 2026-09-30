jest.mock('@react-native-async-storage/async-storage',()=>{
 const store=new Map<string,string>();
 return {__esModule:true,default:{getItem:async(k:string)=>store.get(k)??null,setItem:async(k:string,v:string)=>{store.set(k,v)},removeItem:async(k:string)=>{store.delete(k)},clear:async()=>{store.clear()}}};
});
// Actual clustering/qualification/runner, synthetic local records only.
// AsyncStorage uses the project's standard in-memory Jest setup. Resolution,
// notifications, telemetry and every service boundary below are isolated.
jest.mock('../visits', () => ({ refusalsNearStop: () => { throw Error('Unexpected visits I/O'); } }));
jest.mock('../supabase', () => ({ supabase: new Proxy({}, { get: () => { throw Error('Unexpected database I/O'); } }) }));
jest.mock('../places', () => ({ nearbyRestaurants: () => { throw Error('Unexpected Places I/O'); }, nearbyRestaurantsDetailed: () => { throw Error('Unexpected Places I/O'); } }));
jest.mock('../nearby-cache', () => ({ getCachedNearby: () => { throw Error('Unexpected cache resolution'); }, setCachedNearby: () => { throw Error('Unexpected cache write'); } }));
jest.mock('../eating-pattern', () => ({ loadEatingPattern: () => { throw Error('Unexpected pattern I/O'); } }));
jest.mock('../passive-misses', () => ({ recordMiss: () => { throw Error('Unexpected miss write'); } }));
jest.mock('../cuisine-catalogue', () => ({ restaurantsNear: () => { throw Error('Unexpected catalogue I/O'); } }));
jest.mock('../analytics', () => ({ track: jest.fn() }));
jest.mock('../observability', () => ({ breadcrumb: jest.fn() }));
jest.mock('../passive-capture', () => ({ drainNativeVisits: jest.fn(async()=>[]), PASSIVE_CAPTURE_FLAG: 'passive_capture' }));
jest.mock('../../modules/palate-visit-monitor', () => ({ logDetectorNote: jest.fn() }));
jest.mock('../passive-confirm', () => ({ notifyOrInbox: () => { throw Error('Unexpected notification'); } }));
jest.mock('../flags', () => ({ isFlagEnabled: async()=>true, readFlag: jest.fn(async (name: string) => { if (name === 'passive_capture_confirm') return true; if (name === 'passive_capture_resolve') return false; throw Error('Unexpected flag ' + name); }) }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordForClustering, isHomeOrWorkSuppressed, qualifyVisit } from '../passive-pipeline';
import { runPipelineForRaw, processPendingVisits } from '../passive-runner';
import { readFlag } from '../flags';
import { drainNativeVisits, type RawVisit } from '../passive-capture';

const HISTORY_KEY = 'palate.passive.clusterHistory';
function visit(id: string, minutes = 8, hour = 9, day = 21, extra: Partial<RawVisit> = {}): RawVisit {
  // Local calendar dates: Mon–Thu in September 2026, independent of host TZ.
  const arrivalAt = new Date(2026, 8, day, hour).getTime();
  return { id, lat: 40.75, lng: -73.99, horizontalAccuracy: 15,
    arrivalAt, departureAt: arrivalAt + minutes * 60_000,
    capturedAt: arrivalAt + minutes * 60_000, source: 'stop', simulated: true, ...extra };
}
async function history(): Promise<Array<{ visitId?: string; dwellMin?: number }>> {
  return JSON.parse((await AsyncStorage.getItem(HISTORY_KEY)) ?? '[]');
}
async function seed(minutes: number, hour = 9, extra: Partial<RawVisit> = {}) {
  for (let i = 0; i < 3; i++) await recordForClustering(visit(`prior-${i}`, minutes, hour, 21 + i, extra));
}
beforeEach(async () => { jest.restoreAllMocks(); await AsyncStorage.clear(); jest.clearAllMocks(); });


afterEach(()=>jest.restoreAllMocks());
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{resolve,promise}}
test('overlapping independent records both survive',async()=>{
 const get=AsyncStorage.getItem.bind(AsyncStorage),started=deferred(),release=deferred();
 jest.spyOn(AsyncStorage,'getItem').mockImplementationOnce(async key=>{const value=await get(key);started.resolve();await release.promise;return value});
 const a=recordForClustering(visit('a'));await started.promise;const b=recordForClustering(visit('b'));await Promise.resolve();release.resolve();await Promise.all([a,b]);
 expect((await history()).map(x=>x.visitId).sort()).toEqual(['a','b']);
});
test('queued read waits for committed work evidence rather than admitting a coffee stop',async()=>{
 await recordForClustering(visit('a',480));await recordForClustering(visit('b',480));
 const set=AsyncStorage.setItem.bind(AsyncStorage),started=deferred(),release=deferred();
 jest.spyOn(AsyncStorage,'setItem').mockImplementationOnce(async(k,v)=>{started.resolve();await release.promise;await set(k,v)});
 const write=recordForClustering(visit('c',480));await started.promise;const q=qualifyVisit(visit('next'));await Promise.resolve();release.resolve();await write;
 expect(await q).toEqual({ok:false,reason:'home-work-suppressed'});
});
test('missing key is genuinely empty',async()=>{expect(await qualifyVisit(visit('new'))).toMatchObject({ok:true});await recordForClustering(visit('new'));expect(await history()).toHaveLength(1)});
test.each(['','{','{}','[null]','[{"lat":40,"lng":-73,"hour":9,"weekday":"false"}]'])('malformed %s cannot authorize or overwrite history',async text=>{
 await AsyncStorage.setItem(HISTORY_KEY,text);const set=jest.spyOn(AsyncStorage,'setItem').mockClear();
 await expect(qualifyVisit(visit('x'))).rejects.toMatchObject({retryLater:true});await expect(recordForClustering(visit('x'))).rejects.toMatchObject({retryLater:true});expect(set).not.toHaveBeenCalled();expect(await AsyncStorage.getItem(HISTORY_KEY)).toBe(text);
});
test('failed read does not convert known travel into a new-user floor',async()=>{
 const get=AsyncStorage.getItem.bind(AsyncStorage);jest.spyOn(AsyncStorage,'getItem').mockImplementation(async key=>{if(key===HISTORY_KEY)throw Error('offline storage');return get(key)});
 await expect(qualifyVisit(visit('x',8))).rejects.toMatchObject({retryLater:true});await expect(recordForClustering(visit('x'))).rejects.toMatchObject({retryLater:true});
});
test('write rejection releases queue and same-ID recovery stays idempotent',async()=>{
 jest.spyOn(AsyncStorage,'setItem').mockRejectedValueOnce(Error('disk'));await expect(recordForClustering(visit('same'))).rejects.toMatchObject({retryLater:true});
 await recordForClustering(visit('same'));await recordForClustering(visit('same',120));expect(await history()).toHaveLength(1);expect((await history())[0].dwellMin).toBe(120);
});
test('uncertain write that persisted before rejecting is safe to replay',async()=>{
 const set=AsyncStorage.setItem.bind(AsyncStorage);jest.spyOn(AsyncStorage,'setItem').mockImplementationOnce(async(k,v)=>{await set(k,v);throw Error('uncertain')});
 await expect(recordForClustering(visit('same'))).rejects.toMatchObject({retryLater:true});await recordForClustering(visit('same'));expect(await history()).toHaveLength(1);
});
test('legacy valid points without ID/dwell remain readable',async()=>{
 await AsyncStorage.setItem(HISTORY_KEY,JSON.stringify([{lat:40.75,lng:-73.99,hour:9,weekday:true}]));expect(await qualifyVisit(visit('x'))).toMatchObject({ok:true});await recordForClustering(visit('x'));expect(await history()).toHaveLength(2);
});
test('actual runner preserves unavailable history through repeated retries then recovers',async()=>{
 await AsyncStorage.setItem(HISTORY_KEY,'{');jest.mocked(drainNativeVisits).mockResolvedValue([visit('queued')]);
 for(let i=0;i<4;i++){const r=await processPendingVisits();expect(r.dropped).toBe(0);const pending=JSON.parse((await AsyncStorage.getItem('palate.passive.retryQueue'))!);expect(pending).toHaveLength(1);expect(pending[0].attempts).toBe(0)}
 await AsyncStorage.setItem(HISTORY_KEY,'[]');const r=await processPendingVisits();expect(r.outcomes).toHaveLength(1);expect(JSON.parse((await AsyncStorage.getItem('palate.passive.retryQueue'))!)).toEqual([]);expect(await history()).toHaveLength(1);
});

test('concurrent same-ID attempts retain one point',async()=>{
 await Promise.all([recordForClustering(visit('same')),recordForClustering(visit('same',120))]);expect(await history()).toHaveLength(1);expect((await history())[0].dwellMin).toBe(120);
});
test('qualification reads history once for travel and suppression',async()=>{
 const get=jest.spyOn(AsyncStorage,'getItem');await qualifyVisit(visit('x'));expect(get.mock.calls.filter(([key])=>key===HISTORY_KEY)).toHaveLength(1);
});
