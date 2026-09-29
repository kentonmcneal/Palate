// Real pure pipeline, synthetic fixtures. Every loading boundary throws.
jest.mock('../../nearby-cache', () => ({
  getOrFetchNearby: () => {
    throw Error('Unexpected nearby I/O');
  }
}));
jest.mock('../../places', () => ({
  nearbyRestaurants: () => {
    throw Error('Unexpected Places I/O');
  }
}));
jest.mock('../../taste-vector', () => ({
  computeTasteVector: () => {
    throw Error('Unexpected history I/O');
  }
}));
jest.mock('../../personal-signal', () => ({
  loadPersonalSignal: () => {
    throw Error('Unexpected personal I/O');
  }
}));
jest.mock('../../supabase', () => ({
  supabase: new Proxy({}, {
    get: () => {
      throw Error('Unexpected database I/O');
    }
  })
}));
import { assembleGraph, emptyVector } from '../taste-graph';
import { generateCandidates } from '../candidates';
import { computeRightNow, type RightNowStrategy } from '../right-now';
import { isRecommendable } from '../eligibility';
import type { RestaurantInput } from '../types';
const HERE = { lat: 0, lng: 0 };
const NOW = new Date(2026, 8, 29, 19);
const strategies: RightNowStrategy[] = ['best', 'closest', 'comfort', 'stretch', 'quality'];
// Synthetic independent names: assertions concern matching, not real businesses.
const independentNames = ['Sonic Boom Ramen', 'Masonic Dining Hall', 'Denny Lane Kitchen', 'Outback Orchard Bistro', 'The Longhorn Table'];
const venue = (name: string, extra: Partial<RestaurantInput> = {}): RestaurantInput => ({
  google_place_id: 'synthetic-venue', name, primary_type: 'restaurant',
  latitude: 0, longitude: 0, rating: 4.6, user_rating_count: 300,
  cuisine_type: 'italian', price_level: 2, ...extra,
});
describe('Right Now shares conservative candidate chain eligibility', () => {
  for (const strategy of strategies) {
    it.each(independentNames)(strategy + ' retains eligible independent %s', async name => {
      const graph = assembleGraph(emptyVector(), null), restaurant = venue(name);
      expect(isRecommendable(restaurant)).toBe(true);
      const pool = await generateCandidates({ graph, here: HERE, preFetched: [restaurant] });
      expect(pool.map(c => c.restaurant.google_place_id)).toEqual([restaurant.google_place_id]);
      const result = await computeRightNow({ graph, here: HERE, now: NOW, strategy, preFetched: [restaurant] });
      expect(result.rightNow?.restaurant.google_place_id).toBe(restaurant.google_place_id);
    });
    it.each(["Domino's Pizza #4521", 'Sonic Drive-In', "Wendy's", 'Outback Steakhouse', 'LongHorn Steakhouse', 'The Capital Grille', 'Capital Grille', 'Dairy Queen', 'Baskin-Robbins', 'Cold Stone', 'Cold Stone Creamery', 'BDubs', 'B-Dubs', 'Chickfila'])(strategy + ' still excludes known chain %s', async name => {
      const graph = assembleGraph(emptyVector(), null), restaurant = venue(name);
      expect(isRecommendable(restaurant)).toBe(false);
      const result = await computeRightNow({ graph, here: HERE, now: NOW, strategy, preFetched: [restaurant] });
      expect(result).toEqual({ rightNow: null, stretch: null });
    });
  }
  it.each([
    { chain_name: 'Synthetic Classified Brand' }, { is_chain_brand: true },
    { types: ['fast_food_restaurant'] }, { business_status: 'CLOSED_PERMANENTLY' },
  ])('retains structured exclusions: %o', async extra => {
    const graph = assembleGraph(emptyVector(), null), restaurant = venue('Sonic Boom Ramen', extra);
    expect(isRecommendable(restaurant)).toBe(false);
    expect(await computeRightNow({ graph, here: HERE, now: NOW, preFetched: [restaurant] })).toEqual({ rightNow: null, stretch: null });
  });
});
