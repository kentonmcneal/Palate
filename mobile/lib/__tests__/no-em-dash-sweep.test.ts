import fs from "fs";
import path from "path";

// ============================================================================
// No em dash in anything a person reads. Anywhere.
// ----------------------------------------------------------------------------
// The founder's words: "no em dashes, it gives AI." The rule was already
// enforced — in five separate places, each covering its own module:
// palate-copy-plain, palate-copy-grammar, palate-tag-labels, capture-status,
// function-error. Every one of them is a per-module test, so a card added to
// Profile tomorrow is covered by none of them.
//
// That is exactly the mistake that cost a round trip on the Wrapped copy: the
// fix was made per screen, so Insights kept every problem Wrapped had. A rule
// about language belongs in one sweep over every renderer, not in a test
// beside each one.
//
// What counts as prose, and what does not:
//   • "—" alone is the empty-value placeholder in a table cell. Kept.
//   • "[obs] not installed — run npx ..." is a developer log. Kept.
//   • a character class like /[-–—|@]/ is a parser, not a sentence. Kept.
//   • four or more words with a word either side of the dash is prose. Banned.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");
const DIRS = ["app", "components", "lib"];
const SKIP = new Set(["node_modules", "__tests__", "__fixtures__"]);

function sources(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Drop comments. A `//` inside a string or a URL is not a comment. */
export function stripComments(src: string): string {
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

/** True when this string is prose somebody reads, not a placeholder or a log. */
export function isOffendingCopy(text: string): boolean {
  const t = text.trim();
  if (t === "—") return false;
  if (t.startsWith("[")) return false;
  return /\w\s*—\s*\w/.test(t) && t.split(/\s+/).length >= 4;
}

const LITERAL = /"([^"\n]*—[^"\n]*)"|'([^'\n]*—[^'\n]*)'|`([^`]*—[^`]*)`|>([^<>{}\n]*—[^<>{}\n]*)</g;

/** Every offending "file:line: text" in one source file. */
export function findEmDashCopy(rel: string, src: string): string[] {
  const out: string[] = [];
  stripComments(src).split("\n").forEach((line, i) => {
    if (!line.includes("—")) return;
    for (const m of line.matchAll(LITERAL)) {
      const s = m.slice(1).find((g) => g !== undefined);
      if (s && isOffendingCopy(s)) out.push(`${rel}:${i + 1}: ${s.trim()}`);
    }
  });
  return out;
}

describe("no em dash in user-facing copy, in any screen or component", () => {
  const files = DIRS.flatMap(sources);

  it("sweeps a real number of files, so a bad path cannot pass it silently", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("finds none", () => {
    const offenders = files.flatMap((rel) =>
      findEmDashCopy(rel, fs.readFileSync(path.join(ROOT, rel), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  // Proving the sweep can fail. A guard nobody has seen fail is a guard nobody
  // knows works — three of tonight's bugs were checks that could never match.
  it("catches prose, and leaves placeholders, logs and parsers alone", () => {
    const bad = 'const t = "Palate learns what you like — quietly.";';
    expect(findEmDashCopy("x.ts", bad)).toHaveLength(1);

    expect(findEmDashCopy("x.tsx", '<Text style={s.none}>—</Text>')).toEqual([]);
    expect(findEmDashCopy("x.ts", 'console.warn("[obs] not installed — run expo install")')).toEqual([]);
    expect(findEmDashCopy("x.ts", 'const t = "[obs] not installed — run expo install";')).toEqual([]);
    expect(findEmDashCopy("x.ts", 's.split(/\\s[-–—|@]\\s/)[0];')).toEqual([]);
    expect(findEmDashCopy("x.ts", '// a comment — with a dash in it')).toEqual([]);
  });
});
