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
        // lib/ is swept too: a label defined there and rendered by a screen
        // is just as visible as one written into the JSX, and "Pattern
        // Forming" lived in lib/palate-labels.ts for exactly that reason.
        out = execSync(`grep -rn --include=*.tsx --include=*.ts -F "${w}" app components lib | grep -v __tests__`, { cwd: root, encoding: "utf8" });
      } catch { out = ""; }
      for (const line of out.split("\n").filter(Boolean)) {
        // The Tag union and deriveTags hold KEYS, not display text: renaming a
        // key would orphan stored rows, so palateTags maps key to phrase at
        // render time (TAG_LABEL) and the keys stay as they are. Guarded by
        // palate-tag-labels.test.ts instead, which asserts every key has a
        // plain phrase and that none of the phrases is jargon.
        if (line.startsWith("lib/palate/palateTags.ts") || line.startsWith("lib/palate/palateTypes.ts")) continue;
        // A comment explaining the history is not a string anybody reads.
        const body = line.split(":").slice(2).join(":").trim();
        if (body.startsWith("//") || body.startsWith("*") || body.startsWith("/*")) continue;
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
