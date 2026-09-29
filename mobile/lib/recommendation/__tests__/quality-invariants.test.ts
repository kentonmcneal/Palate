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
import { computeCompatibility } from '../compatibility';
import { scoreRestaurant } from '../scoring';
import { gemAdjustment } from '../gems';
import { computeRightNow, type RightNowStrategy } from '../right-now';
import { shortlist } from '../shortlist';
import type { RestaurantInput } from '../types';
const HERE = {
    lat: 0,
    lng: 0
  },
  NOW = new Date(2026, 8, 29, 19),
  CUISINES = ['italian', 'chinese', 'mexican', 'indian'];
const OPEN = [{
    open: {
      day: 2,
      hour: 17
    },
    close: {
      day: 2,
      hour: 23
    }
  }],
  CLOSED = [{
    open: {
      day: 2,
      hour: 8
    },
    close: {
      day: 2,
      hour: 12
    }
  }];
const row = (id: string, extra: Partial<RestaurantInput> = {}): RestaurantInput => ({
  google_place_id: id,
  name: `Venue${id}`,
  primary_type: 'restaurant',
  latitude: 0,
  longitude: 0,
  rating: 4.4,
  user_rating_count: 300,
  price_level: 2,
  ...extra
});
function graph(cuisine = 'italian', visits = 0) {
  const v = emptyVector();
  v.visitCount = visits;
  if (visits) {
    v.cuisineType = {
      [cuisine]: visits
    };
    v.formatClass = {
      casual_dining: visits
    };
  }
  return assembleGraph(v, null);
}
async function ranked(g: ReturnType<typeof graph>, rows: RestaurantInput[]) {
  const c = await generateCandidates({
    graph: g,
    here: HERE,
    preFetched: rows
  });
  return c.map(x => ({
    r: x.restaurant,
    score: scoreRestaurant(g, x.restaurant, {
      here: HERE,
      now: NOW,
      mode: 'browsing'
    })
  })).sort((a, b) => b.score.finalScore - a.score.finalScore);
}
const pairs = CUISINES.flatMap(cuisine => [0, 5, 35].map(visits => ({
  cuisine,
  visits
})));
describe('repeating metadata is not new evidence', () => {
  test.each(pairs)('tag rank invariance $cuisine / $visits', async ({
    cuisine,
    visits
  }) => {
    const g = graph(cuisine, visits),
      a = row('modest', {
        cuisine_type: cuisine,
        rating: 4.2,
        user_rating_count: 80,
        tags: ['local-favorite']
      }),
      b = row('strong', {
        cuisine_type: cuisine,
        rating: 4.8
      });
    const before = await ranked(g, [a, b]),
      after = await ranked(g, [{
        ...a,
        tags: Array(12).fill('local-favorite')
      }, b]);
    expect(after.map(x => [x.r.google_place_id, x.score.finalScore])).toEqual(before.map(x => [x.r.google_place_id, x.score.finalScore]));
  });
  test.each(pairs)('occasion score invariance $cuisine / $visits', ({
    cuisine,
    visits
  }) => {
    const g = graph(cuisine, visits);
    if (visits) g.occasions = {
      date_night: 1,
      casual_solo: 3
    };
    const a = row('occasion', {
        cuisine_type: cuisine,
        occasion_tags: ['date_night']
      }),
      b = {
        ...a,
        occasion_tags: ['date_night', 'date_night', 'date_night']
      };
    expect(computeCompatibility(g, b)).toEqual(computeCompatibility(g, a));
    expect(scoreRestaurant(g, b, {
      here: HERE,
      now: NOW
    })).toEqual(scoreRestaurant(g, a, {
      here: HERE,
      now: NOW
    }));
  });
  test.each(['local-favorite', 'tourist-heavy', 'fast-casual'])('tag case/repetition %s', tag => {
    expect(gemAdjustment(row('a', {
      tags: [tag, tag.toUpperCase(), tag]
    }))).toBe(gemAdjustment(row('a', {
      tags: [tag]
    })));
  });
  test('distinct supporting tags contribute; unknown tags neutral', () => {
    const a = row('a', {
      rating: 4.2,
      user_rating_count: 80,
      tags: ['local-favorite']
    });
    expect(gemAdjustment({
      ...a,
      tags: ['local-favorite', 'critically-acclaimed']
    })).toBeGreaterThan(gemAdjustment(a));
    expect(gemAdjustment({
      ...a,
      tags: ['local-favorite', 'unrecognized']
    })).toBe(gemAdjustment(a));
  });
  test('distinct occasions and observed taste remain informative', () => {
    const g = graph('italian', 5);
    g.occasions = {
      date_night: 1,
      casual_solo: 3
    };
    const a = row('a', {
      cuisine_type: 'italian',
      occasion_tags: ['date_night']
    });
    expect(computeCompatibility(g, {
      ...a,
      occasion_tags: ['date_night', 'casual_solo']
    }).breakdown.behaviorFit).toBeGreaterThan(computeCompatibility(g, a).breakdown.behaviorFit);
    expect(computeCompatibility(g, a).breakdown.tasteFit).toBeGreaterThan(computeCompatibility(g, {
      ...a,
      cuisine_type: 'chinese'
    }).breakdown.tasteFit);
  });
});
const strategies: RightNowStrategy[] = ['best', 'closest', 'comfort', 'stretch', 'quality'];
describe('Right Now availability within strategy pool', () => {
  test.each(strategies.flatMap(strategy => ['open', 'unknown'].map(hours => ({
    strategy,
    hours
  }))))('$strategy with $hours alternative', async ({
    strategy,
    hours
  }) => {
    const cuisine = strategy === 'stretch' ? 'chinese' : 'italian',
      g = graph('italian', 5);
    const shut = row('shut', {
        cuisine_type: cuisine,
        format_class: 'casual_dining',
        rating: 5,
        price_level: 4,
        tags: ['michelin', 'romantic'],
        regular_opening_hours: CLOSED
      }),
      available = row('available', {
        cuisine_type: cuisine,
        format_class: 'casual_dining',
        latitude: 0.01,
        regular_opening_hours: hours === 'open' ? OPEN : null
      });
    const result = await computeRightNow({
      graph: g,
      here: HERE,
      now: NOW,
      preFetched: [shut, available],
      strategy
    });
    expect(result.rightNow?.restaurant.google_place_id).toBe('available');
  });
  test('secondary stretch also prefers available adjacent choice', async () => {
    const g = graph('italian', 5),
      rows = [row('usual', {
        cuisine_type: 'italian'
      }), row('shut', {
        cuisine_type: 'chinese',
        format_class: 'casual_dining',
        rating: 5,
        price_level: 4,
        tags: ['michelin', 'romantic'],
        regular_opening_hours: CLOSED
      }), row('available', {
        cuisine_type: 'mexican',
        format_class: 'casual_dining',
        regular_opening_hours: OPEN
      })];
    expect((await computeRightNow({
      graph: g,
      here: HERE,
      now: NOW,
      preFetched: rows
    })).stretch?.restaurant.google_place_id).toBe('available');
  });
  test.each(strategies)('all-closed fallback preserved: %s', async strategy => {
    const cuisine = strategy === 'stretch' ? 'chinese' : 'italian';
    expect((await computeRightNow({
      graph: graph('italian', 5),
      here: HERE,
      now: NOW,
      preFetched: [row('only', {
        cuisine_type: cuisine,
        format_class: 'casual_dining',
        regular_opening_hours: CLOSED
      })],
      strategy
    })).rightNow?.restaurant.google_place_id).toBe('only');
  });
  test('unknown hours retained without being asserted open', async () => {
    const g = graph(),
      rows = [row('unknown', {
        rating: 4.8
      }), row('open', {
        rating: 4.2,
        regular_opening_hours: OPEN
      })];
    expect(await generateCandidates({
      graph: g,
      here: HERE,
      preFetched: rows
    })).toHaveLength(2);
    const result = await computeRightNow({
      graph: g,
      here: HERE,
      now: NOW,
      preFetched: rows
    });
    expect(result.rightNow?.restaurant.google_place_id).toBe('unknown');
    expect(result.rightNow?.restaurant.regular_opening_hours).toBeUndefined();
  });
});
describe('cold start incomplete classifications', () => {
  test.each(CUISINES.flatMap(cuisine => [40, 2000].map(size => ({
    cuisine,
    size
  }))))('$cuisine / $size diversity and exclusions', async ({
    cuisine,
    size
  }) => {
    const g = graph();
    g.dislikes.placeIds.add('hidden');
    const other = CUISINES.filter(c => c !== cuisine),
      rows = Array.from({
        length: size
      }, (_, i) => row(`n${i}`, {
        cuisine_subregion: i < size - 3 ? `${cuisine}_local` : `${other[i % 3]}_local`
      })),
      forbidden = [row('hidden', {
        rating: 5,
        tags: ['michelin']
      }), row('gone', {
        business_status: 'CLOSED_PERMANENTLY'
      }), row('fast', {
        primary_type: 'fast_food_restaurant'
      }), row('chain', {
        chain_name: 'Synthetic Brand'
      })];
    for (const input of [[...rows, ...forbidden], [...forbidden, ...rows].reverse()]) {
      const ordered = await ranked(g, input);
      expect(ordered).toHaveLength(size);
      expect(ordered.every(x => Number.isFinite(x.score.finalScore))).toBe(true);
      const s = shortlist(ordered, {
        graph: g,
        now: NOW,
        seed: 'fixed',
        toInput: x => x.r
      });
      expect(s.exploreIndex).toBeNull();
      expect(s.picks).toHaveLength(3);
      expect(new Set(s.picks.map(x => x.r.cuisine_subregion)).size).toBe(3);
      expect(s.picks.some(x => forbidden.some(f => f.google_place_id === x.r.google_place_id))).toBe(false);
    }
  });
  test('unknown cuisine stays uncapped; no invented equivalence', async () => {
    const g = graph(),
      ordered = await ranked(g, ['oak', 'elm', 'ash'].map(id => row(id)));
    expect(shortlist(ordered, {
      graph: g,
      now: NOW,
      seed: 'fixed',
      toInput: x => x.r
    }).picks).toHaveLength(3);
  });
});
describe('data coverage and strategy controls', () => {
  test.each(CUISINES)('unlearned metadata stays neutral in compatibility: %s', cuisine => {
    const g = graph(),
      a = row('same', {
        cuisine_type: cuisine
      }),
      b = {
        ...a,
        cuisine_subregion: `${cuisine}_local`,
        format_class: 'casual_dining',
        occasion_tags: ['date_night'],
        tags: ['synthetic-descriptive']
      };
    expect(computeCompatibility(g, b).score).toBe(computeCompatibility(g, a).score);
  });
  test.each(CUISINES)('balanced histories preserve symmetric cuisine scores: %s', cuisine => {
    const v = emptyVector();
    v.visitCount = 20;
    v.cuisineType = Object.fromEntries(CUISINES.map(c => [c, 5]));
    const g = assembleGraph(v, null);
    expect(computeCompatibility(g, row('same', {
      cuisine_type: cuisine
    })).score).toBe(computeCompatibility(g, row('same', {
      cuisine_type: CUISINES[0]
    })).score);
  });
  test.each(strategies)('fallback never resurrects hard exclusions: %s', async strategy => {
    const g = graph('italian', 5);
    g.dislikes.placeIds.add('hidden');
    const rows = [row('hidden', {
      rating: 5,
      tags: ['michelin']
    }), row('gone', {
      business_status: 'CLOSED_PERMANENTLY'
    }), row('fast', {
      primary_type: 'fast_food_restaurant'
    }), row('chain', {
      chain_name: 'Synthetic Brand'
    })];
    const result = await computeRightNow({
      graph: g,
      here: HERE,
      now: NOW,
      preFetched: rows,
      strategy
    });
    expect(result).toEqual({
      rightNow: null,
      stretch: null
    });
  });
  test('measured paired scores (diagnostic only, not human relevance)', async () => {
    const g = graph('italian', 5),
      a = row('modest', {
        cuisine_type: 'italian',
        rating: 4.2,
        user_rating_count: 80,
        tags: ['local-favorite']
      }),
      b = row('strong', {
        cuisine_type: 'italian',
        rating: 4.8
      });
    const scores = (rows: RestaurantInput[]) => rows.map(r => ({
      id: r.google_place_id,
      gem: gemAdjustment(r),
      match: computeCompatibility(g, r).score,
      final: scoreRestaurant(g, r, {
        here: HERE,
        now: NOW,
        mode: 'browsing'
      }).finalScore
    }));
    console.log('PAIRED_DIAGNOSTIC', JSON.stringify({
      before: scores([a, b]),
      repeated: scores([{
        ...a,
        tags: Array(12).fill('local-favorite')
      }, b])
    }));
    expect(await ranked(g, [a, b])).toHaveLength(2);
  });
});
describe('unknown cuisine is not evidence of novelty', () => {
  test.each([0, 1, 5, 35].flatMap(visits => [40, 2000].map(size => ({
    visits,
    size
  }))))('$visits visits / $size unclassified rows do not empty Best or Comfort', async ({
    visits,
    size
  }) => {
    const g = graph('italian', visits),
      rows = Array.from({
        length: size
      }, (_, i) => row(`unknown${i}`, {
        format_class: 'casual_dining'
      }));
    const candidates = await generateCandidates({
      graph: g,
      here: HERE,
      preFetched: rows
    });
    expect(candidates).toHaveLength(size);
    expect(candidates.every(c => c.pool !== 'stretch_adjacent')).toBe(true);
    for (const strategy of ['best', 'comfort'] as const) {
      expect((await computeRightNow({
        graph: g,
        here: HERE,
        now: NOW,
        preFetched: rows,
        strategy
      })).rightNow).not.toBeNull();
    }
  });
  test.each(CUISINES)('known unfamiliar cuisine still supports adjacent discovery: %s', cuisine => {
    const g = graph(CUISINES.find(c => c !== cuisine)!, 5);
    return generateCandidates({
      graph: g,
      here: HERE,
      preFetched: [row('novel', {
        cuisine_type: cuisine,
        format_class: 'casual_dining'
      })]
    }).then(candidates => expect(candidates[0].pool).toBe('stretch_adjacent'));
  });
});
test('unclassified-pool hero diagnostic exercises selection even before pool assertions', async () => {
  const g = graph('italian', 5),
    rows = [row('one', {
      format_class: 'casual_dining'
    }), row('two', {
      format_class: 'casual_dining'
    })];
  const best = await computeRightNow({
      graph: g,
      here: HERE,
      now: NOW,
      preFetched: rows,
      strategy: 'best'
    }),
    comfort = await computeRightNow({
      graph: g,
      here: HERE,
      now: NOW,
      preFetched: rows,
      strategy: 'comfort'
    });
  console.log('UNKNOWN_CUISINE_DIAGNOSTIC', JSON.stringify({
    best: best.rightNow?.restaurant.google_place_id ?? null,
    comfort: comfort.rightNow?.restaurant.google_place_id ?? null
  }));
  expect(best.rightNow).not.toBeNull();
  expect(comfort.rightNow).not.toBeNull();
});
