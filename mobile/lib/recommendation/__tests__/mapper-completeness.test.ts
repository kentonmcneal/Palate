import fs from "fs";
import path from "path";
import { toInput } from "../candidates";

const REC = path.resolve(__dirname, "..");
const ROOT = path.resolve(REC, "..", "..");

function declaredFields(): string[] {
  const src = fs.readFileSync(path.join(REC, "types.ts"), "utf8");
  const i = src.indexOf("export type RestaurantInput = {");
  const body = src.slice(i, src.indexOf("\n};", i));
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
}

// ----------------------------------------------------------------------------
// One mapper, and it carries everything.
// ----------------------------------------------------------------------------
// There were four hand-rolled RestaurantInput mappers and no two agreed. The
// shipped one dropped regular_opening_hours, so the open-venue filter had
// never excluded anything and Home's explore row served closed restaurants.
// Another dropped tags and vibe, so up to +16 of the gem adjustment was
// permanently zero on the main screen.
//
// None of it was visible, because the ranking harness declared a FIFTH mapper
// that carried every field — so the "no closed restaurant in the top ten"
// guard had been green for the whole life of the feature while testing code
// that does not ship.
//
// This test exists so a NEW field cannot repeat that. It reads the type and
// checks the mapper against it, rather than checking a list somebody has to
// remember to update.
// ----------------------------------------------------------------------------
describe("RestaurantInput mapping", () => {
  it("carries every field the type declares", () => {
    const fields = declaredFields();
    expect(fields.length).toBeGreaterThan(20);

    // Give the mapper a row where every field has a distinguishable value, so
    // a dropped one shows up as undefined rather than as a coincidental null.
    const row: Record<string, unknown> = {};
    for (const f of fields) row[f] = `v_${f}`;

    const out = toInput(row) as Record<string, unknown>;
    const dropped = fields.filter((f) => out[f] === undefined);
    expect(dropped).toEqual([]);
  });

  it("does not invent fields the type does not declare", () => {
    const fields = new Set(declaredFields());
    const out = toInput({ google_place_id: "x", name: "y" }) as Record<string, unknown>;
    const extra = Object.keys(out).filter((k) => !fields.has(k));
    expect(extra).toEqual([]);
  });

  it("is the only mapper the ranking harness uses", () => {
    // The harness defining its own mapper is what made the closed-restaurant
    // guard blind. If it stops importing the shipped one, that blindness is
    // back and nothing else will say so.
    const harness = fs.readFileSync(
      path.join(REC, "__tests__", "ranking-harness.test.ts"), "utf8",
    );
    expect(harness).toMatch(/import\s*\{[^}]*\btoInput\b[^}]*\}\s*from\s*"\.\.\/candidates"/);
  });

  it("keeps the surfaces on the shared mapper", () => {
    // Home and Discover each had their own. A local `function toInput` in
    // either is the four-mappers problem starting again.
    for (const rel of ["app/(tabs)/discover.tsx", "components/RecommendationsCard.tsx"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src).not.toMatch(/function toInput\s*\(/);
    }
  });
});
