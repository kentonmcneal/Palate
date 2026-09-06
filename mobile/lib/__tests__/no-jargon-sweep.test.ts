import { execSync } from "child_process";
import path from "path";

// The founder's test for Wrapped: no line should read as words the model
// uses about itself. This sweeps every rendered string for the ones that did.
describe("no jargon in rendered copy", () => {
  it("keeps the old model words out of screens and components", () => {
    const root = path.resolve(__dirname, "..", "..");
    const words = ["Roamer", "Grounded", "Trend-aware", "NEXT ERA", "next era", "Pattern Forming", "Premium</Text>", "Novelty</Text>", "Consistency</Text>"];
    const hits: string[] = [];
    for (const w of words) {
      let out = "";
      try {
        out = execSync(`grep -rn --include=*.tsx -F "${w}" app components`, { cwd: root, encoding: "utf8" });
      } catch { out = ""; }
      for (const line of out.split("\n").filter(Boolean)) {
        // Comments explain the history; only rendered strings count: the word
        // inside quotes or backticks, or between a > and a <.
        const code = line.split(":").slice(2).join(":");
        const rendered = new RegExp(`(["'\`>])[^"'\`<]*${w.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}`);
        if (!rendered.test(code)) continue;
        hits.push(line);
      }
    }
    expect(hits).toEqual([]);
  });
});
