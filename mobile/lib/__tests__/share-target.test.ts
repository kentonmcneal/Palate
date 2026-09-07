import fs from "fs";
import path from "path";
import { SHARE_DOMAIN } from "../share-target";

// ============================================================================
// The one URL in the product that strangers read.
// ----------------------------------------------------------------------------
// The Wrapped story card is the app's viral artifact — it is made to be posted
// and seen by people who do not have Palate. It printed "palate.app", which
// does not resolve, so every share ever produced sent somebody nowhere.
//
// These do not check DNS; a test that fails when a network is flaky is a test
// people delete. They check that the address exists in exactly one place and
// that the known-dead ones cannot come back by being typed inline.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");
const DEAD = ["palate.app", "your-palate.com"];

/** Comments may name a dead domain — settings.tsx documents that palate.app
 *  has no MX record, which is exactly the note a future reader wants. Only
 *  live string literals are the problem. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const m = /(?<!:)\/\//.exec(line);
      if (!m) return line;
      const before = line.slice(0, m.index);
      const balanced = (q: string) => (before.split(q).length - 1) % 2 === 0;
      return balanced('"') && balanced("'") && balanced("`") ? before : line;
    })
    .join("\n");
}

function sources(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe("the address on a shared card", () => {
  it("is set, and is not one of the domains that do not answer", () => {
    expect(SHARE_DOMAIN.length).toBeGreaterThan(3);
    expect(DEAD).not.toContain(SHARE_DOMAIN);
  });

  it("catches the JSX-text form the first version of this test missed", () => {
    const jsx = '<CanvasText style={styles.brand}>palate.app</CanvasText>';
    expect(/>[^<>{}\n]*palate\.app/.test(stripComments(jsx))).toBe(true);
    // And still catches the string form.
    expect(/["'`][^"'`\n]*palate\.app/.test(stripComments('const u = "palate.app";'))).toBe(true);
  });

  it("catches a dead domain in a literal but not in a comment", () => {
    // Proving the sweep can fail, and that it is not merely blind.
    expect(/["'`][^"'`\n]*palate\.app/.test(stripComments('const x = "go to palate.app";'))).toBe(true);
    expect(/["'`][^"'`\n]*palate\.app/.test(stripComments('// was "hello@palate.app"'))).toBe(false);
  });

  it("is never hard-coded into a component", () => {
    const offenders: string[] = [];
    for (const rel of [...sources("components"), ...sources("app")]) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      for (const dead of DEAD) {
        const esc = dead.replace(/\./g, "\\.");
        // Two ways a domain reaches a screen, and the first version of this
        // test only knew one of them. WrappedCard rendered
        // `<CanvasText>palate.app</CanvasText>` — JSX TEXT, with no quote in
        // front of it — so the literal check sailed past a live bug on the
        // in-app Wrapped card while reporting all clear. Found by looking at
        // a screenshot of the running app, which no amount of grepping would
        // have replaced.
        const inLiteral = new RegExp(`["'\`][^"'\`\\n]*${esc}`);
        const inJsxText = new RegExp(`>[^<>{}\\n]*${esc}`);
        if (inLiteral.test(src)) offenders.push(`${rel} has "${dead}" in a string`);
        if (inJsxText.test(src)) offenders.push(`${rel} has "${dead}" in JSX text`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reaches the story card from the shared constant", () => {
    const card = fs.readFileSync(path.join(ROOT, "components/WrappedStoryCard.tsx"), "utf8");
    expect(card).toContain("SHARE_DOMAIN");
  });
});
