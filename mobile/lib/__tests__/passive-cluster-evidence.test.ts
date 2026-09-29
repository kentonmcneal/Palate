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
jest.mock('../passive-capture', () => ({ drainNativeVisits: () => { throw Error('Unexpected native drain'); }, PASSIVE_CAPTURE_FLAG: 'passive_capture' }));
jest.mock('../../modules/palate-visit-monitor', () => ({ logDetectorNote: jest.fn() }));
jest.mock('../passive-confirm', () => ({ notifyOrInbox: () => { throw Error('Unexpected notification'); } }));
jest.mock('../flags', () => ({ readFlag: jest.fn(async (name: string) => { if (name === 'passive_capture_confirm') return true; if (name === 'passive_capture_resolve') return false; throw Error('Unexpected flag ' + name); }) }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordForClustering, isHomeOrWorkSuppressed, qualifyVisit } from '../passive-pipeline';
import { runPipelineForRaw } from '../passive-runner';
import { readFlag } from '../flags';
import type { RawVisit } from '../passive-capture';

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
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

describe('duration evidence distinguishes repeated brief stops from long stays', () => {
  for (const hour of [9, 10, 15, 16]) {
    it.each([1, 2, 5, 8, 15, 119.99])(`repeated %s-minute weekday stops at ${hour}:00 do not imply work`, async minutes => {
      await seed(minutes, hour);
      expect(await isHomeOrWorkSuppressed(visit('next', 8, hour, 24))).toBe(false);
      expect(await qualifyVisit(visit('next', 8, hour, 24))).toMatchObject({ ok: true });
    });
  }
  it.each([120, 480])('three distinct %s-minute work stays still suppress', async minutes => {
    await seed(minutes);
    expect(await isHomeOrWorkSuppressed(visit('next', 8, 9, 24))).toBe(true);
    expect(await history()).toHaveLength(3);
  });
  it('three evening-to-morning home stays still suppress beyond the meal ceiling', async () => {
    await seed(780, 19);
    expect(await isHomeOrWorkSuppressed(visit('next'))).toBe(true);
    expect(await history()).toHaveLength(3);
  });
  it('long lunchtime arrivals remain outside workplace evidence', async () => {
    await seed(120, 12);
    expect(await isHomeOrWorkSuppressed(visit('next'))).toBe(false);
  });
  it('existing short daytime history no longer implies work', async () => {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(Array.from({ length: 3 }, () => ({ lat: 40.75, lng: -73.99, hour: 9, weekday: true, dwellMin: 3 }))));
    expect(await isHomeOrWorkSuppressed(visit('next'))).toBe(false);
    expect(await history()).toHaveLength(3); // reinterpreted, not erased
  });
  it('legacy missing-duration overnight history remains readable', async () => {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(Array.from({ length: 3 }, () => ({ lat: 40.75, lng: -73.99, hour: 23, weekday: true }))));
    expect(await isHomeOrWorkSuppressed(visit('next'))).toBe(true);
  });
});

describe('cluster observations need adequate position and independent identity', () => {
  it.each([100.01, 400])('coarse %sm observations cannot teach a 60m work cluster', async horizontalAccuracy => {
    await seed(480, 9, { horizontalAccuracy, source: 'slc' });
    expect(await history()).toHaveLength(0);
    expect(await isHomeOrWorkSuppressed(visit('next'))).toBe(false);
  });
  it('exactly 100m accuracy still permits long evidence', async () => {
    await seed(480, 9, { horizontalAccuracy: 100 });
    expect(await history()).toHaveLength(3);
    expect(await isHomeOrWorkSuppressed(visit('next'))).toBe(true);
  });
  it('sequential retries of one ID remain one work observation', async () => {
    for (let i = 0; i < 4; i++) await recordForClustering(visit('same', 480));
    expect(await history()).toHaveLength(1);
    expect(await isHomeOrWorkSuppressed(visit('next'))).toBe(false);
  });
  it('a completed longer version replaces its same-ID observation', async () => {
    await recordForClustering(visit('same', 5));
    await recordForClustering(visit('same', 480));
    expect(await history()).toEqual([expect.objectContaining({ visitId: 'same', dwellMin: 480 })]);
  });
  it.each([{ arrivalAt: null }, { departureAt: null }, { horizontalAccuracy: -1 }, { horizontalAccuracy: NaN }, { lat: 91 }, { lng: Infinity }])('invalid/open record does not seed history: %o', async extra => {
    await recordForClustering(visit('invalid', 480, 9, 21, extra));
    expect(await history()).toHaveLength(0);
  });
});

describe('recording after qualification cannot weaken dwell floors', () => {
  it('actual runner does not let rejected six-minute away stops make the city familiar', async () => {
    await recordForClustering(visit('home', 780, 19, 20, { lat: 35, lng: -90 }));
    for (let i = 0; i < 3; i++) {
      expect(await runPipelineForRaw(visit(`bus-${i}`, 6, 9, 21 + i))).toMatchObject({ stage: 'unqualified', detail: 'dwell-too-short' });
    }
    expect(await history()).toHaveLength(1);
    expect(await qualifyVisit(visit('next', 6, 9, 24))).toMatchObject({ ok: false, reason: 'dwell-too-short' });
    expect(jest.mocked(readFlag).mock.calls.map(([name]) => name)).toEqual(Array(3).fill('passive_capture_confirm')); // no resolution flag or lookup
  });
  it('actual runner rejects one-minute local stops but admits repeated five-minute coffee qualification', async () => {
    expect(await runPipelineForRaw(visit('bus', 1))).toMatchObject({ stage: 'unqualified', detail: 'dwell-too-short' });
    expect(await history()).toHaveLength(0);
    for (let i = 0; i < 4; i++) {
      expect(await runPipelineForRaw(visit(`coffee-${i}`, 5, 9, 21 + i))).toMatchObject({ stage: 'resolved', detail: 'resolve-flag-off' });
    }
    expect(await history()).toHaveLength(4);
    expect(jest.mocked(readFlag).mock.calls.map(([name]) => name)).toEqual([
      'passive_capture_confirm',
      ...Array.from({ length: 4 }, () => ['passive_capture_confirm', 'passive_capture_resolve']).flat(),
    ]); // known confirmation gate; resolution disabled before any venue lookup
  });
  it('keeps the local five-minute and away twelve-minute exact boundaries', async () => {
    expect(await qualifyVisit(visit('local-short', 4.99))).toMatchObject({ ok: false, reason: 'dwell-too-short' });
    expect(await qualifyVisit(visit('local-five', 5))).toMatchObject({ ok: true });
    await recordForClustering(visit('home', 780, 19, 20, { lat: 35, lng: -90 }));
    expect(await qualifyVisit(visit('away-short', 11.99))).toMatchObject({ ok: false, reason: 'dwell-too-short' });
    expect(await qualifyVisit(visit('away-twelve', 12))).toMatchObject({ ok: true });
  });
});
