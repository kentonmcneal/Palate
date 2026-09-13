import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const SYNC_RAW = fs.readFileSync(path.join(ROOT, "lib/passive-inbox-sync.ts"), "utf8");
// Strip comments before matching. The file explains the old bug in prose, and
// a guard that trips on its own documentation is a guard nobody keeps.
const SYNC = SYNC_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const CONFIRM = fs.readFileSync(path.join(ROOT, "lib/passive-confirm.ts"), "utf8");

// ----------------------------------------------------------------------------
// Raw location must not leave the device before a visit is confirmed.
// ----------------------------------------------------------------------------
// This is the app's one hard privacy promise, written into the header of
// passive-inbox-sync.ts. It was broken without anybody touching that file:
// the mirror spread the whole InboxEntry, and stopLat/stopLng were added to
// InboxEntry later for location-scoped refusals (0145). The leak arrived with
// the new field.
//
// So the guard is not "does it mention stopLat" — it is structural. The
// payload must be built from a literal whitelist, never from the entry, and
// every field on InboxEntry must be a field somebody consciously listed.
// ----------------------------------------------------------------------------
describe("the inbox mirror cannot leak where a person stood", () => {
  it("never puts the stop coordinates in the payload", () => {
    const fn = SYNC.slice(SYNC.indexOf("function mirrorPayload"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).not.toMatch(/stopLat:/);
    expect(body).not.toMatch(/stopLng:/);
  });

  it("builds the payload from a whitelist, not by spreading the entry", () => {
    // `payload: e`, `payload: { ...e }` and `e as unknown as Record<...>` are
    // all the original bug wearing different clothes.
    expect(SYNC).not.toMatch(/payload:\s*e\b/);
    expect(SYNC).not.toMatch(/payload:\s*\{\s*\.\.\.e/);
    expect(SYNC).toMatch(/payload:\s*mirrorPayload\(e\)/);
  });

  it("forces a decision about every field on InboxEntry", () => {
    // Extract the declared field names of InboxEntry.
    const start = CONFIRM.indexOf("export type InboxEntry = {");
    const decl = CONFIRM.slice(start, CONFIRM.indexOf("\n};", start));
    const fields = [...decl.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(10);

    const fn = SYNC_RAW.slice(SYNC_RAW.indexOf("function mirrorPayload"));
    const body = fn.slice(0, fn.indexOf("\n}"));

    // A field is "decided" if it is either copied into the payload or named in
    // a comment explaining why it is withheld. Anything else is a field that
    // arrived after this file was last read — exactly how the leak happened.
    const undecided = fields.filter(
      (f) => !new RegExp(`\\b${f}:`).test(body) && !new RegExp(`\\b${f}\\b`).test(body),
    );
    expect(undecided).toEqual([]);
  });
});
