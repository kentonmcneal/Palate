import fs from "fs";
import path from "path";

// ============================================================================
// Every edge-function error a person can read must go through readFunctionError.
// ----------------------------------------------------------------------------
// supabase-js reports every non-2xx from an edge function as a
// FunctionsHttpError whose `message` is the fixed string "Edge Function
// returned a non-2xx status code". The reply that says WHICH thing went wrong
// is on `error.context`, an unread Response.
//
// This has cost real debugging twice. Connecting Gmail failed on a device with
// that generic sentence, and three different causes stayed indistinguishable
// for a whole evening. And app/map.tsx shipped a hand-written message for the
// rate-limit case, guarded by `msg.includes("rate_limited")`, from the day it
// was added — a substring that could never appear, because the proxy answered
// rate_limited with a 429 and the 429 became the generic sentence. Capped users
// were told to check their connection.
//
// The rule is narrow on purpose. Swallowing the error is allowed: a missing
// blurb shows nothing and has nothing to explain. What is banned is passing
// the opaque error on to a human, by throwing it or by reading .message.
// A raw `throw error` after supabase.from() is untouched by this — Postgres
// errors carry a real message.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const INVOKE = "supabase.functions.invoke";
/** Enough to cover the destructure and the handling right below it. */
const WINDOW = 320;

const callers = ["lib", "app", "components", "hooks"]
  .flatMap(sourceFiles)
  .map((rel) => ({ rel, src: fs.readFileSync(path.join(ROOT, rel), "utf8") }))
  .filter(({ rel, src }) => src.includes(INVOKE) && !rel.endsWith("function-error.ts"));

/** The handling code immediately following each invoke in a file. */
function windows(src: string): string[] {
  const out: string[] = [];
  let i = src.indexOf(INVOKE);
  while (i !== -1) {
    out.push(src.slice(i, i + WINDOW));
    i = src.indexOf(INVOKE, i + 1);
  }
  return out;
}

describe("edge function errors reach the person", () => {
  it("finds the call sites, so a rename cannot silently empty this suite", () => {
    expect(callers.length).toBeGreaterThan(3);
  });

  it.each(callers.map((c) => c.rel))("%s never surfaces the opaque error", (rel) => {
    const src = callers.find((c) => c.rel === rel)!.src;
    for (const w of windows(src)) {
      // Thrown as-is: the caller's catch sees the generic sentence.
      expect(w).not.toMatch(/throw error\b/);
      // Read directly: same sentence, one step later.
      expect(w).not.toMatch(/\berror\.message\b/);
    }
  });
});
