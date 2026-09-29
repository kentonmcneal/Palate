// No catalogue/user fixtures or I/O: execute the shipped pure pipeline with
// supplied rows. Any accidental transition to a data loader fails immediately.
jest.mock('../../nearby-cache', () => ({ getOrFetchNearby: () => { throw new Error('Unexpected nearby I/O'); } }));
jest.mock('../../places', () => ({ nearbyRestaurants: () => { throw new Error('Unexpected Places I/O'); } }));
jest.mock('../../taste-vector', () => ({ computeTasteVector: () => { throw new Error('Unexpected history I/O'); } }));
jest.mock('../../personal-signal', () => ({ loadPersonalSignal: () => { throw new Error('Unexpected personal I/O'); } }));
jest.mock('../../supabase', () => ({ supabase: new Proxy({}, { get: () => { throw new Error('Unexpected database I/O'); } }) }));

import { assembleGraph, emptyVector } from '../taste-graph';
import type { TasteGraph } from '../taste-graph';
import type { RestaurantInput } from '../types';
import { computeCompatibility } from '../compatibility';
import { generateCandidates, isStretch } from '../candidates';
import { scoreRestaurant } from '../scoring';
import { computeRightNow } from '../right-now';
import { shortlist } from '../shortlist';

const CUISINES = ['italian', 'chinese', 'mexican', 'indian'];
const HERE = { lat: 0, lng: 0 };
const NOW = new Date(2026, 8, 29, 19);
const row = (id: string, over: Partial<RestaurantInput> = {}): RestaurantInput => ({
  google_place_id: id, name: `Synthetic ${id}`, primary_type: 'restaurant',
  latitude: 0, longitude: 0, price_level: 2, rating: 4.4, user_rating_count: 300,
  ...over,
});
function graph(cuisine: string, visits: number): TasteGraph {
  const v = emptyVector();
  v.visitCount = visits;
  if (visits > 0) {
    v.cuisineType = { [cuisine]: visits };
    v.formatClass = { casual_dining: visits };
  }
  return assembleGraph(v, null);
}
async function pipeline(g: TasteGraph, rows: RestaurantInput[]) {
  const candidates = await generateCandidates({ graph: g, here: HERE, preFetched: rows });
  const ranked = candidates.map(c => ({ r: c.restaurant, score: scoreRestaurant(g, c.restaurant, { here: HERE, now: NOW, mode: 'browsing' }) }))
    .sort((a, b) => b.score.finalScore - a.score.finalScore || a.r.google_place_id.localeCompare(b.r.google_place_id));
  const result = shortlist(ranked, { graph: g, now: NOW, seed: 'synthetic:2026-09-29', toInput: x => x.r, explore: false });
  return { candidates, ranked, result };
}

// 4 cuisines × 4 histories × 2 pool sizes = 32 paired scenarios.
const matrix = CUISINES.flatMap(cuisine => [0, 1, 5, 35].flatMap(visits => [40, 2000].map(size => ({ cuisine, visits, size }))));
describe('synthetic paired pipeline matrix (32 scenarios)', () => {
  test.each(matrix)('$cuisine / $visits visits / $size rows', async ({ cuisine, visits, size }) => {
    const g = graph(cuisine, visits);
    const other = CUISINES[(CUISINES.indexOf(cuisine) + 1) % CUISINES.length];
    const rows = Array.from({ length: size }, (_, i) => row(`venue-${i}`, { cuisine_type: i % 2 ? other : cuisine, format_class: 'casual_dining' }));
    const a = await pipeline(g, rows);
    const b = await pipeline(g, [...rows].reverse());
    expect(a.candidates).toHaveLength(size);
    expect(a.ranked.every(x => Number.isFinite(x.score.finalScore))).toBe(true);
    expect(a.result.picks.map(x => x.r.google_place_id)).toEqual(b.result.picks.map(x => x.r.google_place_id));
    expect(a.result.picks).toHaveLength(3);
    const own = a.ranked.find(x => x.r.google_place_id === 'venue-0')!;
    const alternate = a.ranked.find(x => x.r.google_place_id === 'venue-1')!;
    if (visits === 0) expect(own.score.finalScore).toBe(alternate.score.finalScore);
    else {
      expect(own.score.finalScore).toBeGreaterThan(alternate.score.finalScore);
      expect(a.candidates.find(c => c.restaurant.google_place_id === 'venue-0')!.pool).toBe('taste_similar');
    }
    // Paired metadata change: occasions cannot be negative evidence when
    // the PERSON has no occasion map; clock omitted to isolate compatibility.
    const enriched = { ...rows[0], occasion_tags: ['date_night'] };
    expect(computeCompatibility(g, enriched).score).toBe(computeCompatibility(g, rows[0]).score);
    for (const strategy of ['best', 'comfort'] as const) {
      const pick = await computeRightNow({ graph: g, here: HERE, now: NOW, preFetched: rows, strategy });
      expect(pick.rightNow).not.toBeNull();
      if (visits > 0) expect(pick.rightNow!.restaurant.cuisine_type).toBe(cuisine);
    }
  });
});

test.each([1, 3, 5, 35])('price-only history ignores unlearned attributes (%i visits)', visits => {
  const v = emptyVector(); v.visitCount = visits; v.averagePriceLevel = 2;
  const g = assembleGraph(v, null), r = row('price-only');
  const baseline = computeCompatibility(g, r);
  for (const over of [{ format_class: 'casual_dining' }, { occasion_tags: ['date_night'] }, { format_class: 'casual_dining', occasion_tags: ['date_night'] }]) {
    const c = computeCompatibility(g, { ...r, ...over });
    expect(c.breakdown.behaviorFit).toBe(baseline.breakdown.behaviorFit);
    expect(c.score).toBe(baseline.score);
  }
});

test('existing format and occasion histories still discriminate', () => {
  for (const dimension of ['format', 'occasion']) {
    const v = emptyVector(); v.visitCount = 5;
    if (dimension === 'format') v.formatClass = { casual_dining: 5 };
    else v.occasion = { date_night: 5 };
    const g = assembleGraph(v, null);
    const good = row('good', dimension === 'format' ? { format_class: 'casual_dining' } : { occasion_tags: ['date_night'] });
    const other = row('other', dimension === 'format' ? { format_class: 'fine_dining' } : { occasion_tags: ['breakfast'] });
    expect(computeCompatibility(g, good).breakdown.behaviorFit).toBeGreaterThan(computeCompatibility(g, other).breakdown.behaviorFit);
  }
});

test.each(CUISINES)('familiar type is comfort; explicit new subregion stays stretch (%s)', async cuisine => {
  const g = graph(cuisine, 5);
  const familiar = row('familiar', { cuisine_type: cuisine, format_class: 'casual_dining' });
  const novel = row('novel', { ...familiar, google_place_id: 'novel', name: 'Synthetic Novel', cuisine_subregion: `${cuisine}_new_subregion` });
  expect(isStretch(g, familiar)).toBe(false);
  expect(isStretch(g, novel)).toBe(true);
  const c = await generateCandidates({ graph: g, here: HERE, preFetched: [familiar, novel] });
  expect(c.find(x => x.restaurant.google_place_id === 'familiar')!.pool).toBe('taste_similar');
  expect(c.find(x => x.restaurant.google_place_id === 'novel')!.pool).toBe('stretch_adjacent');
});

test.each([40, 2000].flatMap(size => [1, 5, 35].map(visits => ({ size, visits }))))('known subregion caps despite missing type ($size rows, $visits visits)', async ({ size, visits }) => {
  const v = emptyVector(); v.visitCount = visits; v.cuisineSubregion = { italian_trattoria: visits };
  const g = assembleGraph(v, null);
  const rows = Array.from({ length: size }, (_, i) => row(`sub-${i}`, i < 3
    ? { cuisine_subregion: 'italian_trattoria' }
    : { cuisine_type: CUISINES[1 + i % 3] }));
  const { result } = await pipeline(g, rows);
  expect(result.picks).toHaveLength(3);
  expect(result.picks.filter(x => x.r.cuisine_subregion === 'italian_trattoria')).toHaveLength(visits < 3 ? 1 : 2);
});

test('region fallback caps, entirely unknown remains uncapped, thin pools still fill', () => {
  const g = graph('italian', 0);
  const pick = (rows: RestaurantInput[]) => shortlist(rows, { graph: g, now: NOW, seed: 'fixed', toInput: r => r, explore: false }).picks;
  const unknown = ['Alder', 'Birch', 'Cedar'].map(id => row(id));
  expect(pick(unknown)).toEqual(unknown);
  const sameRegion = unknown.map(r => ({ ...r, cuisine_region: 'italian' }));
  expect(pick(sameRegion)).toEqual(sameRegion);
  const varied = [...sameRegion, row('Dogwood', { cuisine_region: 'east_asian' }), row('Elm', { cuisine_region: 'south_asian' })];
  expect(pick(varied).map(r => r.google_place_id)).toEqual(['Alder', 'Dogwood', 'Elm']);
});

test('actual candidate pipeline preserves exclusions and duplicate-ID removal', async () => {
  const g = graph('italian', 5);
  g.dislikes = { ...g.dislikes, placeIds: new Set(['hidden']) };
  const keep = row('keep');
  const { candidates } = await pipeline(g, [keep, { ...keep }, row('hidden'), row('closed', { business_status: 'CLOSED_PERMANENTLY' }), row('fast', { primary_type: 'fast_food_restaurant' })]);
  expect(candidates.map(c => c.restaurant.google_place_id)).toEqual(['keep']);
  expect((await pipeline(g, [])).result.picks).toEqual([]);
});
