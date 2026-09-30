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

test.each([{lat:91},{lng:181},{hour:24},{hour:1.5},{dwellMin:null},{dwellMin:-1},{visitId:null},{visitId:0},{visitId:''}])('invalid legacy field %j refuses suppression and preserves bytes',async invalid=>{const raw=JSON.stringify([{lat:40.75,lng:-73.99,hour:9,weekday:true,...invalid}]);await AsyncStorage.setItem(HISTORY_KEY,raw);await expect(isHomeOrWorkSuppressed(visit('x'))).rejects.toMatchObject({retryLater:true});await expect(recordForClustering(visit('x'))).rejects.toMatchObject({retryLater:true});expect(await AsyncStorage.getItem(HISTORY_KEY)).toBe(raw)});
test('queued write rejection allows next independent writer to recover without loss',async()=>{await recordForClustering(visit('prior'));const started=deferred(),release=deferred();jest.spyOn(AsyncStorage,'setItem').mockImplementationOnce(async()=>{started.resolve();await release.promise;throw Error('disk')});const first=recordForClustering(visit('fail'));const caught=first.catch(e=>e);await started.promise;const second=recordForClustering(visit('next'));release.resolve();expect(await caught).toMatchObject({retryLater:true});await second;expect((await history()).map(x=>x.visitId)).toEqual(['prior','next'])});
test('five concurrent short coffee visits remain meals rather than work',async()=>{await Promise.all(Array.from({length:5},(_,i)=>recordForClustering(visit('coffee-'+i,8,9,21+i))));expect(await history()).toHaveLength(5);expect(await qualifyVisit(visit('today',8,9,28))).toMatchObject({ok:true})});
test('history retains cap through concurrent append',async()=>{await AsyncStorage.setItem(HISTORY_KEY,JSON.stringify(Array.from({length:500},(_,i)=>({lat:40.75,lng:-73.99,hour:12,weekday:false,visitId:'old-'+i,dwellMin:8}))));await Promise.all([recordForClustering(visit('a')),recordForClustering(visit('b'))]);const h=await history();expect(h).toHaveLength(500);expect(h.slice(-2).map(x=>x.visitId)).toEqual(['a','b']);expect(h[0].visitId).toBe('old-2')});

test.each(['',null,4])('record rejects invalid incoming identity %s without poisoning history',async id=>{await recordForClustering(visit('valid'));await recordForClustering(visit(id as any));expect((await history()).map(x=>x.visitId)).toEqual(['valid']);expect(await qualifyVisit(visit('later'))).toMatchObject({ok:true})});
