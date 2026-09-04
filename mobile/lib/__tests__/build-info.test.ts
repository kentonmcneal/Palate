import { formatBuildInfo, type BuildInfo } from "../build-info";

function info(over: Partial<BuildInfo> = {}): BuildInfo {
  return {
    version: "0.1.8",
    updateId: "17ef8f8f",
    publishedAt: "9/4/2026, 1:11 AM",
    embedded: false,
    runtimeVersion: "0.1.8",
    ...over,
  };
}

// "Did the update land?" was unanswerable from the phone. Every OTA tonight
// went to the same runtime, so a bundle from an hour ago and the current one
// both reported 0.1.8 — the version alone cannot distinguish them.
describe("formatBuildInfo", () => {
  it("names the running update, so two bundles on one runtime are tellable apart", () => {
    const line = formatBuildInfo(info());
    expect(line).toContain("update 17ef8f8f");
    expect(line).toContain("0.1.8");
    expect(line).toContain("9/4/2026");
  });

  it("says plainly when no update has been applied", () => {
    expect(formatBuildInfo(info({ embedded: true, updateId: null })))
      .toContain("no update applied");
  });

  it("does not claim an update when there is only an embedded bundle", () => {
    // embedded false but no id — a dev build. Still must not imply an OTA.
    expect(formatBuildInfo(info({ updateId: null })))
      .toContain("no update applied");
  });

  it("omits the date rather than printing an empty separator", () => {
    const line = formatBuildInfo(info({ publishedAt: null }));
    expect(line).toBe("Palate 0.1.8 · update 17ef8f8f");
  });
});
