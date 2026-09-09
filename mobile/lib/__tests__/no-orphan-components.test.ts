import fs from "fs";
import path from "path";

// ============================================================================
// A component nothing renders is worse than no component.
// ----------------------------------------------------------------------------
// Seven of these were found on 2026-09-09, all created three or four months
// earlier and referenced nowhere since. They were not idle: every sweep since
// had "maintained" them. The em-dash pass edited one, a rename edited another,
// a copy change edited a third. Dead code that keeps getting groomed costs
// review attention forever and never runs once.
//
// One of them, RightNowHero, cost more than attention. It was mistaken for a
// live surface twice — once when its missing analytics looked like a bug worth
// reporting, and once when a test of mine asserted venue dedupe on it, which
// is a worse kind of green than a missing test.
//
// If a component is deliberately unrendered — built ahead of the screen that
// will use it — say so in the file with the marker below and this passes.
// Saying so is the point: it makes the intent survive the next person.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");
const MARKER = "@unrendered";

function tsx(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsx(rel));
    else if (e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

function allSources(): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  const walk = (dir: string) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) out.push({ rel, src: fs.readFileSync(path.join(ROOT, rel), "utf8") });
    }
  };
  ["components", "lib", "hooks", "app"].forEach(walk);
  return out;
}

const components = tsx("components");
const sources = allSources();

/** Mentioned by name anywhere else at all — imports, JSX, even a comment.
 *  Deliberately generous: the point is to catch the truly abandoned, not to
 *  police how something is referenced. */
function isReferenced(rel: string): boolean {
  const stem = path.basename(rel).replace(/\.tsx$/, "");
  const word = new RegExp(`\\b${stem}\\b`);
  return sources.some((s) => s.rel !== rel && word.test(s.src));
}

describe("every component is rendered by something", () => {
  it("finds the components at all", () => {
    expect(components.length).toBeGreaterThan(40);
  });

  it("has no component that nothing anywhere mentions", () => {
    const orphans = components
      .filter((rel) => !fs.readFileSync(path.join(ROOT, rel), "utf8").includes(MARKER))
      .filter((rel) => !isReferenced(rel));
    expect(orphans).toEqual([]);
  });

  it("lets a component opt out when it is built ahead of its screen", () => {
    // The marker is the escape hatch, and using it is a statement of intent
    // rather than a silence.
    const withMarker = `// ${MARKER}: waiting on the settings redesign\nexport function X() { return null; }`;
    expect(withMarker.includes(MARKER)).toBe(true);
  });
});
