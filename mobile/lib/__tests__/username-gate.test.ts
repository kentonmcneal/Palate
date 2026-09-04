import {
  markUsernameClaimed, isUsernameClaimed, subscribeUsernameClaimed, __resetUsernameGate,
} from "../username-gate";

beforeEach(() => __resetUsernameGate());

// The gate shipped keyed on [session], which does not change when you save a
// handle — so the flag stayed true, the guard bounced you back, and the screen
// asked again forever. These pin the bit that broke the loop.
describe("username gate", () => {
  it("starts unclaimed", () => {
    expect(isUsernameClaimed()).toBe(false);
  });

  it("flips synchronously, so the guard cannot read a stale value", () => {
    markUsernameClaimed();
    expect(isUsernameClaimed()).toBe(true);
  });

  it("notifies the guard", () => {
    const seen = jest.fn();
    subscribeUsernameClaimed(seen);
    markUsernameClaimed();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("only fires once, however many times it is called", () => {
    const seen = jest.fn();
    subscribeUsernameClaimed(seen);
    markUsernameClaimed();
    markUsernameClaimed();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(isUsernameClaimed()).toBe(true);
  });

  it("stops notifying after unsubscribe", () => {
    const seen = jest.fn();
    subscribeUsernameClaimed(seen)();
    markUsernameClaimed();
    expect(seen).not.toHaveBeenCalled();
  });

  it("never re-arms — a gate that can is how the loop comes back", () => {
    markUsernameClaimed();
    __resetUsernameGate();
    // Only the test reset clears it; no production path does.
    expect(isUsernameClaimed()).toBe(false);
  });
});
