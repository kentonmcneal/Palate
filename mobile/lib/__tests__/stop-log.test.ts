import { parseStopLog } from "../../modules/palate-visit-monitor";

describe("parseStopLog", () => {
  it("parses a native trace line into an entry with ms timestamps", () => {
    expect(parseStopLog(["1756000000|candidate_started|acc=65m"])).toEqual([
      { at: 1756000000000, kind: "candidate_started", detail: "acc=65m" },
    ]);
  });

  it("keeps entries whose detail is empty", () => {
    expect(parseStopLog(["1756000000|emit_via_timer|"])).toEqual([
      { at: 1756000000000, kind: "emit_via_timer", detail: "" },
    ]);
  });

  it("preserves pipes inside the detail rather than truncating it", () => {
    // Error strings from CoreLocation can contain anything.
    const [entry] = parseStopLog(["1756000000|precise_fix_failed|kCLError|domain=1"]);
    expect(entry.detail).toBe("kCLError|domain=1");
  });

  it("drops malformed lines instead of throwing", () => {
    // A debug screen must never crash on a corrupt log line.
    expect(parseStopLog(["", "garbage", "notanumber|kind|d", "1756000000|ok|"])).toEqual([
      { at: 1756000000000, kind: "ok", detail: "" },
    ]);
  });
});
