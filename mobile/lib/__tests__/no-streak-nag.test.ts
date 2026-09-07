import fs from "fs";
import path from "path";

// ============================================================================
// Palate does not threaten to take something away.
// ----------------------------------------------------------------------------
// The app shipped an 8pm local notification reading "Your N-day streak is on
// the line. Log today's meal before midnight to keep it alive." The founder
// received one and asked for it to go.
//
// The product's promise is that it notices where you ate so you do not have
// to think about it. A notification that threatens a loss unless you open the
// app inverts that: it makes the app the thing you owe. The streak chip came
// off Home for the same reason, and the passive digest already asks a better
// question an hour later, naming the places you were actually at.
//
// The streak itself is not the problem and still exists: it drives milestone
// posts and shows in your own stats. Nobody gets messaged about losing it.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...sourceFiles(rel));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

describe("no streak pressure in anything a person receives", () => {
  const files = [...sourceFiles("lib"), ...sourceFiles("app"), ...sourceFiles("components")];

  it("schedules no streak reminder anywhere", () => {
    // The payload form, which only appears when one is being SCHEDULED.
    // Cancelling reads cancelScheduledOfKind(..., "type", "streak_reminder"),
    // which must stay: devices still hold ones scheduled by older builds.
    const offenders = files.filter((f) =>
      /type:\s*"streak_reminder"/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("uses no loss-framing copy", () => {
    // Narrow on purpose. An earlier version banned "on the line" outright and
    // flagged a palate description reading "the quiet bar with one chef left
    // on the line", which is a kitchen, not a threat.
    const banned = [
      /streak is on the line/i,
      /keep it alive/i,
      /streak (ends|is at risk|will end|dies)/i,
      /before midnight/i,
      /don'?t lose your/i,
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const line of src.split("\n")) {
        const code = line.trim();
        // Comments explaining the removal are not copy anybody receives.
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
        if (banned.some((re) => re.test(line))) offenders.push(`${f}: ${code.slice(0, 70)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
