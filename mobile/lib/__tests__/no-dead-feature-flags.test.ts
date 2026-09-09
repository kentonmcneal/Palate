import fs from "fs";
import path from "path";

// ============================================================================
// A switch that controls nothing is worse than no switch.
// ----------------------------------------------------------------------------
// `passive_capture_funnel` sat in feature_flags for months, set to false, read
// by nobody, while the instrumentation it named shipped ungated and has been
// firing the whole time. The row said a capability was off while that
// capability was on.
//
// It survived because a grep finds it everywhere: migration 0050 creates a
// VIEW with the identical name. Searching for the string is noisy; searching
// for a READ of the key returns nothing. Removed in 0143.
//
// This lists the seven that remain and asserts each is actually read
// somewhere — the app, an edge function, or an RPC in a migration. Add a flag
// and it must be wired before the suite goes green.
// ============================================================================

const REPO = path.resolve(__dirname, "..", "..", "..");
const MOBILE = path.resolve(__dirname, "..", "..");

const FLAGS = [
  "direct_messages",
  "discovery_pings",
  "passive_capture_confirm",
  "passive_capture_detection",
  "passive_capture_resolve",
  "rec_feedback_loop",
  "server_push",
];

function read(dirs: string[], exts: string[]): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  const walk = (abs: string, rel: string) => {
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      const a = path.join(abs, e.name);
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(a, r);
      else if (exts.some((x) => e.name.endsWith(x))) out.push({ rel: r, src: fs.readFileSync(a, "utf8") });
    }
  };
  for (const d of dirs) walk(path.isAbsolute(d) ? d : path.join(REPO, d), d);
  return out;
}

const sources = [
  ...read([path.join(MOBILE, "lib"), path.join(MOBILE, "app"), path.join(MOBILE, "components")], [".ts", ".tsx"]),
  ...read(["supabase/functions", "supabase/migrations"], [".ts", ".sql"]),
];

/** A READ of the flag, not merely the string.
 *
 *  Three things name a flag without consulting it, and all three are present
 *  in this repo: the seed row that creates it, a VIEW that happens to share
 *  its name (migration 0050), and the migration that DELETES it — which was
 *  the first version of this matcher's undoing, since
 *  `delete ... where key = 'x'` looks exactly like a read of x. Managing a
 *  flag is not consulting one. */
function isRead(flag: string): boolean {
  const patterns = [
    new RegExp(`isFlagEnabled\\([^)]*${flag}`),
    new RegExp(`key\\s*=\\s*'${flag}'`),
    new RegExp(`eq\\(\\s*["']key["']\\s*,\\s*["']${flag}["']`),
    new RegExp(`FLAG\\s*=\\s*["']${flag}["']`),
  ];
  return sources.some((s) => s.src.split("\n").some((line) => lineReads(line, patterns)));
}

const DML = /\b(delete\s+from|insert\s+into|update)\b/i;

/** One line, decided. Separated so the rule can be exercised on strings it was
 *  written for rather than on a repo whose contents legitimately change. */
function lineReads(line: string, patterns: RegExp[]): boolean {
  return !DML.test(line) && patterns.some((p) => p.test(line));
}

function patternsFor(flag: string): RegExp[] {
  return [
    new RegExp(`isFlagEnabled\\([^)]*${flag}`),
    new RegExp(`key\\s*=\\s*'${flag}'`),
    new RegExp(`eq\\(\\s*["']key["']\\s*,\\s*["']${flag}["']`),
    new RegExp(`FLAG\\s*=\\s*["']${flag}["']`),
  ];
}

describe("every feature flag controls something", () => {
  it("reads a real number of sources, app and server", () => {
    expect(sources.length).toBeGreaterThan(150);
    expect(sources.some((s) => s.rel.includes("supabase"))).toBe(true);
  });

  it.each(FLAGS)("%s is read somewhere", (flag) => {
    expect(isRead(flag)).toBe(true);
  });

  it("tells a read of a flag from a mention of one", () => {
    const p = patternsFor("passive_capture_funnel");
    // Reads — these consult the flag.
    expect(lineReads(`  if (await isFlagEnabled("passive_capture_funnel")) {`, p)).toBe(true);
    expect(lineReads(`  select enabled from feature_flags where key = 'passive_capture_funnel'`, p)).toBe(true);

    // Mentions — these are why the dead flag survived for months.
    // A view that happens to share the name (migration 0050):
    expect(lineReads(`create or replace view public.passive_capture_funnel as`, p)).toBe(false);
    // The seed row that creates it (migration 0049):
    expect(lineReads(`  ('passive_capture_funnel', false, 'Phase 2: instrumentation'),`, p)).toBe(false);
    // And the migration that removes it, which reads like a read and is not:
    expect(lineReads(`delete from public.feature_flags where key = 'passive_capture_funnel';`, p)).toBe(false);
  });

});
