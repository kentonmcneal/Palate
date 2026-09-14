import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");

// ----------------------------------------------------------------------------
// The digest hands confirmDigest real data. Do not cast it away.
// ----------------------------------------------------------------------------
// digest.tsx called confirmDigest(confirmed as never, skipped as never, …).
// Two separate bugs shipped behind that cast:
//
//   • stopLat/stopLng were present on DigestEntry and dropped here, so every
//     prompt_decision ever written has a null position and location-scoped
//     learning has never learned anything.
//   • dwellMin, candidateCount and accuracyM were present and dropped, so all
//     48 refusals on record are featureless and attribution cannot be
//     calibrated at all.
//
// Both were TYPED correctly on both sides. `as never` is what stopped the
// compiler checking the one boundary where it mattered — and removing the
// casts compiled clean first time, so they were never needed.
// ----------------------------------------------------------------------------
describe("the digest → confirm boundary is type-checked", () => {
  const src = fs.readFileSync(path.join(ROOT, "app/digest.tsx"), "utf8");

  it("passes its entries to confirmDigest without casting them away", () => {
    const call = src.slice(src.indexOf("await confirmDigest("));
    const args = call.slice(0, call.indexOf(");"));
    expect(args).not.toMatch(/as never/);
    expect(args).not.toMatch(/as any/);
    expect(args).not.toMatch(/as unknown/);
  });

  it("ConfirmableEntry still declares the fields that were being dropped", () => {
    // If someone narrows the type again, the data stops travelling even with
    // the cast gone.
    const dc = fs.readFileSync(path.join(ROOT, "lib/digest-confirm.ts"), "utf8");
    const decl = dc.slice(dc.indexOf("export type ConfirmableEntry"));
    const body = decl.slice(0, decl.indexOf("\n};"));
    for (const field of ["stopLat", "stopLng", "accuracyM", "dwellMin", "candidateCount"]) {
      expect(body).toContain(field);
    }
  });
});
