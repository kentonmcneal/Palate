import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");

// Every screen or component that displays content ONE USER wrote and ANOTHER
// user reads. Apple Guideline 1.2 requires a way to report the content and
// block its author on each of them.
//
// The DM thread was missing both, and the audit that found it noted the
// screens it checked did not include this one — it was caught by a different
// auditor in passing. A private message is where harassment actually happens:
// there is no audience to shame somebody out of it, and nobody else can flag
// it on your behalf.
//
// Listed explicitly rather than discovered, so ADDING a surface is a
// deliberate step that makes you think about this. A new social screen that is
// not in this list is not protected by it — which is the honest limit of a
// test like this, and why the list is short enough to read.
const UGC_SURFACES = [
  "app/(tabs)/feed.tsx",
  "app/thread/[id].tsx",
  "components/CommentsSheet.tsx",
];

describe("user-generated surfaces carry moderation", () => {
  for (const rel of UGC_SURFACES) {
    it(`${rel} can report and block`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src).toMatch(/reportContent\s*\(/);
      expect(src).toMatch(/blockUser\s*\(/);
      // A reason picker, not a bare "reported" toast: the report has to say
      // what it is for or triage cannot act on it.
      expect(src).toMatch(/REPORT_REASONS/);
    });
  }

  it("the reason vocabulary is shared, not retyped per screen", () => {
    const mod = fs.readFileSync(path.join(ROOT, "lib/moderation.ts"), "utf8");
    expect(mod).toMatch(/export const REPORT_REASONS/);
    // Each surface reports a distinct target type, so triage can tell a DM
    // from a comment without opening the row.
    expect(mod).toMatch(/targetType:[^;]*"dm_thread"/);
    expect(mod).toMatch(/targetType:[^;]*"comment"/);
  });
});
