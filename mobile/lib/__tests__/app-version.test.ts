import fs from "fs";
import path from "path";

// ============================================================================
// app.json's version must be the real one, not a runtime the OTA script was
// passing through when something staged files.
// ----------------------------------------------------------------------------
// runtimeVersion uses the appVersion policy, so the runtime IS this string.
// scripts/ota.sh rewrites it once per live runtime because eas update has no
// --runtime-version flag, and twice in one day a `git add -A` landed mid-loop
// and committed 0.1.8. Nothing fails at the time. It fails at the next build,
// silently: that binary is runtime 0.1.8 and every 0.1.9 update goes past it.
//
// A memory note did not prevent the second occurrence. This does, because the
// suite runs before every commit and this is part of it.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");
const REPO = path.resolve(ROOT, "..");

/** The runtimes ota.sh publishes to. First entry is the true app version. */
function runtimesFromScript(): string[] {
  const sh = fs.readFileSync(path.join(REPO, "scripts", "ota.sh"), "utf8");
  const m = /^RUNTIMES=\(([^)]*)\)/m.exec(sh);
  if (!m) throw new Error("scripts/ota.sh no longer declares RUNTIMES=(...)");
  return m[1].trim().split(/\s+/).filter(Boolean);
}

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));

describe("app.json version", () => {
  it("matches the version scripts/ota.sh treats as real", () => {
    const [real, ...older] = runtimesFromScript();
    expect(appJson.expo.version).toBe(real);
    // Named explicitly so the failure message says what went wrong rather than
    // just showing two version strings.
    expect(older).not.toContain(appJson.expo.version);
  });

  it("lists the older runtimes in descending order, so 'first is real' holds", () => {
    const rs = runtimesFromScript().map((v) => v.split(".").map(Number));
    for (let i = 1; i < rs.length; i++) {
      const [a, b] = [rs[i - 1], rs[i]];
      const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
      expect(newer).toBe(true);
    }
  });

  it("is not left mid-publish", () => {
    // ota.sh removes this in a trap, so it survives a crash or a Ctrl-C only
    // if something is genuinely still running.
    expect(fs.existsSync(path.join(REPO, ".ota-running"))).toBe(false);
  });
});
