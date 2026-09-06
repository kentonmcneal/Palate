import { assembleGraph } from "../recommendation/taste-graph";
import { computeCompatibility } from "../recommendation/compatibility";
import { filterRecommendable } from "../recommendation/eligibility";
import { aggregate } from "../taste-vector";
const rows = require("./__audit_memphis.json");
function mkVisit(region: string|null, sub: string|null, type: string, price: number, daysAgo: number) {
  return { visited_at: new Date(Date.now() - daysAgo * 86400000).toISOString(), meal_type: null,
    restaurant: { id: type + daysAgo, name: "x", cuisine_type: type, cuisine_region: region, cuisine_subregion: sub, format_class: "casual_dining", chain_type: null, occasion_tags: ["group_dinner"], flavor_tags: null, cultural_context: null, neighborhood: "h", latitude: 35.1, longitude: -89.84, price_level: price } };
}
const pool = filterRecommendable(rows as any) as any[];
test("audit2", () => {
  const withType = pool.filter((r) => r.cuisine_type);
  const typeNoRegion = pool.filter((r) => r.cuisine_type && !r.cuisine_region && !r.cuisine_subregion);
  const noTypeNoRegion = pool.filter((r) => !r.cuisine_type && !r.cuisine_region);
  console.log(`POOL n=${pool.length}: cuisine_type present ${withType.length}; region OR subregion present ${pool.filter(r=>r.cuisine_region||r.cuisine_subregion).length}`);
  console.log(`  rows with a cuisine_type but NO region/subregion (scored as UNKNOWN 0.35): ${typeNoRegion.length}`);
  console.log(`  rows with nothing at all: ${noTypeNoRegion.length}`);
  // Real-shaped user: catalogue visits carry cuisine_type but usually null region.
  const realistic: any[] = [];
  for (let i = 0; i < 20; i++) realistic.push(mkVisit(null, null, i % 3 === 0 ? "italian" : "american", 2, i * 3));
  const gReal = assembleGraph(aggregate(realistic, []), null);
  const sReal = pool.map((r) => computeCompatibility(gReal, r).score).sort((a,b)=>b-a);
  console.log("\nUser whose OWN visits have cuisine_type but null region (the catalogue's actual shape):");
  console.log("  graph.cuisines keys:", JSON.stringify(Object.keys(gReal.cuisines)), " cuisineTypes keys:", JSON.stringify(Object.keys(gReal.cuisineTypes)));
  console.log("  compat top10:", sReal.slice(0,10).join(","), " distinct:", new Set(sReal).size);
  // Same user but their visits DO carry regions
  const classified: any[] = [];
  for (let i = 0; i < 20; i++) classified.push(mkVisit(i%3===0?"european":"north_american", i%3===0?"italian":"southern_us", i%3===0?"italian":"american", 2, i*3));
  const gC = assembleGraph(aggregate(classified, []), null);
  const sC = pool.map((r) => ({ n: r.name, t: r.cuisine_type, reg: r.cuisine_region, s: computeCompatibility(gC, r).score })).sort((a,b)=>b.s-a.s);
  console.log("\nSame user WITH regions on their visits — top 8 scored places:");
  sC.slice(0,8).forEach(x=>console.log(`   ${x.s}%  ${x.n}  type=${x.t} region=${x.reg}`));
  const italian = sC.filter(x=>x.t==="italian");
  console.log(`  italian places in pool: ${italian.length}; their scores: ${italian.map(x=>x.s).join(",")}`);
  expect(true).toBe(true);
});
