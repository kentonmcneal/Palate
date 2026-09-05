import { loadView, loadErrorMessage } from "../load-state";

// A thrown error and an empty result used to render identically. The feed
// returned 400 on every call for its entire existence and looked like an empty
// feed; later it returned 35 rows and still showed nothing, with no way to tell
// from the screen which was happening.
describe("loadView", () => {
  it("shows the error when there is nothing to fall back on", () => {
    expect(loadView({ loading: false, error: new Error("boom"), count: 0 })).toBe("error");
  });

  it("shows empty only when the load genuinely succeeded with nothing", () => {
    expect(loadView({ loading: false, error: null, count: 0 })).toBe("empty");
  });

  it("keeps rows on screen when a refresh fails", () => {
    // A failed pull-to-refresh must not blank a list the user is reading.
    expect(loadView({ loading: false, error: new Error("boom"), count: 12 })).toBe("content");
  });

  it("does not flash empty while the first load is still running", () => {
    expect(loadView({ loading: true, error: null, count: 0 })).toBe("loading");
  });

  it("prefers the error over the spinner once one exists", () => {
    expect(loadView({ loading: true, error: new Error("boom"), count: 0 })).toBe("error");
  });
});

describe("loadErrorMessage", () => {
  it("names a connection problem as one", () => {
    expect(loadErrorMessage(new Error("Network request failed"))).toMatch(/connection/i);
  });

  it("tells someone what to do about an expired session", () => {
    expect(loadErrorMessage(new Error("JWT expired"))).toMatch(/sign out/i);
  });

  it("never shows a raw exception to a person", () => {
    const msg = loadErrorMessage(new Error("PGRST200: could not find relationship"));
    expect(msg).not.toMatch(/PGRST/);
    expect(msg).toBe("Something went wrong loading this.");
  });

  it("handles a thrown non-error without crashing the screen", () => {
    expect(typeof loadErrorMessage("just a string")).toBe("string");
    expect(typeof loadErrorMessage(null)).toBe("string");
  });
});
