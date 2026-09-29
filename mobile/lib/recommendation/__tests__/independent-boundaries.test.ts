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
import { generateCandidates, isStretch, toInput } from '../candidates';
import { computeCompatibility } from '../compatibility';
import { scoreRestaurant, scoreContext } from '../scoring';
import { gemAdjustment } from '../gems';
import { computeRightNow, type RightNowStrategy } from '../right-now';
import { shortlist } from '../shortlist';
import type { RestaurantInput } from '../types';
const HERE={lat:0,lng:0};
const row=(id:string,extra:Partial<RestaurantInput>={}):RestaurantInput=>({google_place_id:id,name:'Independent '+id,latitude:0,longitude:0,primary_type:'restaurant',rating:4.4,user_rating_count:300,price_level:2,...extra});
function graph(){const v=emptyVector();v.visitCount=10;v.cuisineType={italian:10};v.formatClass={casual_dining:10};return assembleGraph(v,null);}
const strategies:RightNowStrategy[]=['best','comfort','closest','quality','stretch'];
const hours=[{open:{day:5,hour:22},close:{day:6,hour:2}}];
const dates=[new Date(2026,9,2,21,59),new Date(2026,9,2,22),new Date(2026,9,3,1,59),new Date(2026,9,3,2)];
test.each(dates.map((now,i)=>({now,open:i===1||i===2})))('overnight boundary $now',async({now,open})=>{
 const g=graph();const result=await computeRightNow({graph:g,here:HERE,now,strategy:'quality',preFetched:[row('higher',{cuisine_type:'italian',rating:5,regular_opening_hours:hours}),row('unknown',{cuisine_type:'italian',rating:4.1})]});
 expect(result.rightNow?.restaurant.google_place_id).toBe(open?'higher':'unknown');
});
test('Saturday-to-Sunday period stays open across the week boundary',async()=>{
 const now=new Date(2026,9,4,1);const result=await computeRightNow({graph:graph(),here:HERE,now,strategy:'quality',preFetched:[row('higher',{rating:5,regular_opening_hours:[{open:{day:6,hour:22},close:{day:0,hour:2}}]}),row('unknown',{rating:4})]});expect(result.rightNow?.restaurant.google_place_id).toBe('higher');
});
test('always-open sentinel survives and mapper carries raw Google period array/status',async()=>{
 const raw=row('always',{rating:5,business_status:'OPERATIONAL',regular_opening_hours:[{open:{day:0,hour:0,minute:0}}]});
 expect(toInput(raw).regular_opening_hours).toEqual(raw.regular_opening_hours);expect(toInput(raw).business_status).toBe('OPERATIONAL');
 const result=await computeRightNow({graph:graph(),here:HERE,now:dates[0],strategy:'quality',preFetched:[toInput(raw),row('unknown',{rating:4})]});expect(result.rightNow?.restaurant.google_place_id).toBe('always');
});
test.each(strategies)('all hard enum gates survive availability fallback %s',async strategy=>{
 const g=graph();g.dislikes.placeIds.add('hidden');
 const fields:Partial<RestaurantInput>[]=[{google_place_id:'hidden'},{business_status:'CLOSED_PERMANENTLY'},{format_class:'fast_food'},{types:['fast_food_restaurant']},{chain_name:'Synthetic'},{name:'McDonald\'s'},{is_chain_brand:true},{recommendation_eligibility:0.49}];
 const rows=fields.map((x,i)=>row('bad'+i,{cuisine_type:'chinese',format_class:'casual_dining',regular_opening_hours:null,...x}));
 expect(await computeRightNow({graph:g,here:HERE,now:dates[0],strategy,preFetched:rows})).toEqual({rightNow:null,stretch:null});
});
test('temporary closure enum remains deliberately allowed by existing policy',async()=>{
 const cs=await generateCandidates({graph:graph(),here:HERE,preFetched:[toInput(row('temp',{business_status:'CLOSED_TEMPORARILY',recommendation_eligibility:0.5}))]});expect(cs).toHaveLength(1);
});
test('missing cuisine with flavor adjacency does not imply novelty',async()=>{
 const g=graph();g.flavors={spicy:10};const r=row('unknown',{flavor_tags:['spicy']});expect(isStretch(g,r)).toBe(false);
 for(const strategy of ['best','comfort'] as const)expect((await computeRightNow({graph:g,here:HERE,now:dates[0],strategy,preFetched:[r]})).rightNow).not.toBeNull();
});
test('flavor dedup leaves the intentionally disabled flavor weight unchanged',()=>{
 const g=graph();g.flavors={spicy:1,savory:3};const r=row('flavor',{cuisine_type:'italian',flavor_tags:['spicy']});
 expect(computeCompatibility(g,{...r,flavor_tags:['spicy','spicy','spicy']})).toEqual(computeCompatibility(g,r));
 expect(computeCompatibility(g,{...r,flavor_tags:['spicy','savory']}).breakdown.tasteFit).toBe(computeCompatibility(g,r).breakdown.tasteFit);
 const changed={...g,flavors:{spicy:3,savory:1}};expect(computeCompatibility(changed,r).breakdown.tasteFit).toBe(computeCompatibility(g,r).breakdown.tasteFit);
});
test.each([new Date(2026,9,2,9),new Date(2026,9,3,12),new Date(2026,9,2,14),new Date(2026,9,2,19),new Date(2026,9,2,23)])('occasion evidence idempotent across meal slot $now',now=>{
 const occasions=['breakfast','brunch','working_lunch','date_night','late_night'];const r=row('slot',{occasion_tags:occasions});
 expect(scoreContext({...r,occasion_tags:[...occasions,...occasions]}, {now})).toBe(scoreContext(r,{now}));
});
test('existing strategy ordering remains when every choice is known closed',async()=>{
 const rows=[row('near',{cuisine_type:'italian',latitude:0,rating:4}),row('rated',{cuisine_type:'italian',latitude:.01,rating:5})].map(r=>({...r,regular_opening_hours:hours}));
 const opts={graph:graph(),here:HERE,now:dates[0],preFetched:rows};
 expect((await computeRightNow({...opts,strategy:'closest'})).rightNow?.restaurant.google_place_id).toBe('near');
 expect((await computeRightNow({...opts,strategy:'quality'})).rightNow?.restaurant.google_place_id).toBe('rated');
});

test('cheap independent quick_service format is intentionally not a fast-food hard gate',async()=>{
 const r=row('counter',{format_class:'quick_service',price_level:1});expect(await generateCandidates({graph:graph(),here:HERE,preFetched:[r]})).toHaveLength(1);
});
