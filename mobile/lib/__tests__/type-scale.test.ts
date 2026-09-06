import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { TYPE_SCALE, type } from "../../theme";

// ============================================================================
// One ladder, or the tabs stop looking like one app.
// ----------------------------------------------------------------------------
// Measured 2026-09-06: twenty-five distinct font sizes across the app against
// a six-role scale. 12 and 14 sat either side of `small`, 15 and 17 either
// side of `body`, and 19, 21 and 22 clustered around `title`. None of that was
// a decision; it was each screen guessing. This test is what stops the next
// guess: a new size is a step added to TYPE_SCALE with a reason, not a number
// typed into a stylesheet.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");

// The Wrapped story and the share/capture cards are full-bleed typography
// where the size IS the design (heroes run to 92), and PlaceTile computes its
// initials from the tile size. They are exempt on purpose.
const EXEMPT = [
  "app/wrapped-story.tsx",
  "components/WrappedStoryCard.tsx",
  "components/SharePalateCard.tsx",
  "components/CanvasText.tsx",
  "components/PlaceArt.tsx",
  "components/Confetti.tsx",
];

// The surfaces the founder sees side by side. Widening this list is the point;
// it is scoped rather than global so adding a screen is a deliberate step.
const GUARDED = [
  "app/(tabs)",
  "components/RecommendationsCard.tsx",
  "components/RestaurantCompatibilityCard.tsx",
  "components/FeaturedLists.tsx",
  "components/MoodRow.tsx",
  "components/StretchPick.tsx",
  "components/CaptureWarning.tsx",
  "components/InviteCard.tsx",
  "components/HomeHero.tsx",
  "components/AllTimeCard.tsx",
  "components/WrappedCard.tsx",
  "components/WrappedCharts.tsx",
  "components/NextStepCard.tsx",
  "components/Button.tsx",
];

function sizesIn(file: string): { line: number; size: number }[] {
  const out: { line: number; size: number }[] = [];
  const src = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
  src.forEach((text, i) => {
    const m = text.match(/fontSize:\s*(\d+)/);
    if (m) out.push({ line: i + 1, size: Number(m[1]) });
  });
  return out;
}

function guardedFiles(): string[] {
  const files: string[] = [];
  for (const g of GUARDED) {
    if (g.endsWith(".tsx")) { files.push(g); continue; }
    const listed = execSync(`ls "${path.join(ROOT, g)}"`, { encoding: "utf8" })
      .split("\n").filter((f) => f.endsWith(".tsx"));
    for (const f of listed) files.push(`${g}/${f}`);
  }
  return files.filter((f) => !EXEMPT.includes(f) && fs.existsSync(path.join(ROOT, f)));
}

describe("the type ladder", () => {
  it("covers every role in the scale", () => {
    for (const [role, style] of Object.entries(type)) {
      expect(TYPE_SCALE).toContain((style as { fontSize: number }).fontSize);
      expect(role).toBeTruthy();
    }
  });

  it("is the only set of sizes the shared surfaces use", () => {
    const offLadder: string[] = [];
    for (const file of guardedFiles()) {
      for (const { line, size } of sizesIn(file)) {
        if (!(TYPE_SCALE as readonly number[]).includes(size)) {
          offLadder.push(`${file}:${line} fontSize ${size}`);
        }
      }
    }
    expect(offLadder).toEqual([]);
  });

  it("gives every tab the same screen title", () => {
    // Home set its own 21 against everyone else's type.title 20, which is the
    // kind of one-point drift nobody can name and everybody can see.
    const titles = execSync(
      `grep -rn "type.title" "${path.join(ROOT, "app/(tabs)")}" || true`,
      { encoding: "utf8" },
    ).split("\n").filter(Boolean);
    expect(titles.length).toBeGreaterThan(4);
    for (const t of titles) {
      expect(t).not.toMatch(/type\.title,\s*fontSize:/);
    }
  });
});
