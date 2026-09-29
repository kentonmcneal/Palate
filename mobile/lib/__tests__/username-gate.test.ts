import {
  markUsernameClaimed, isUsernameClaimed, subscribeUsernameClaimed, __resetUsernameGate, setUsernameGateAccount, usernameGateSession,
} from "../username-gate";

beforeEach(() => { __resetUsernameGate(); setUsernameGateAccount("A"); });

// The gate shipped keyed on [session], which does not change when you save a
// handle — so the flag stayed true, the guard bounced you back, and the screen
// asked again forever. These pin the bit that broke the loop.
describe("username gate", () => {
  it("starts unclaimed", () => {
    expect(isUsernameClaimed()).toBe(false);
  });

  it("flips synchronously, so the guard cannot read a stale value", () => {
    markUsernameClaimed(usernameGateSession());
    expect(isUsernameClaimed()).toBe(true);
  });

  it("notifies the guard", () => {
    const seen = jest.fn();
    subscribeUsernameClaimed(seen);
    markUsernameClaimed(usernameGateSession());
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("only fires once, however many times it is called", () => {
    const seen = jest.fn();
    subscribeUsernameClaimed(seen);
    markUsernameClaimed(usernameGateSession());
    markUsernameClaimed(usernameGateSession());
    expect(seen).toHaveBeenCalledTimes(1);
    expect(isUsernameClaimed()).toBe(true);
  });

  it("stops notifying after unsubscribe", () => {
    const seen = jest.fn();
    subscribeUsernameClaimed(seen)();
    markUsernameClaimed(usernameGateSession());
    expect(seen).not.toHaveBeenCalled();
  });

  it("test reset clears the current session", () => {
    markUsernameClaimed(usernameGateSession());
    __resetUsernameGate();
    // A fresh account session must independently establish its handle.
    expect(isUsernameClaimed()).toBe(false);
  });
});


test("account replacement preserves subscribers but rejects obsolete completions", () => {
  const seen = jest.fn(); subscribeUsernameClaimed(seen);
  const a = usernameGateSession(); markUsernameClaimed(a);
  setUsernameGateAccount("A"); expect(isUsernameClaimed()).toBe(true);
  setUsernameGateAccount("B"); expect(isUsernameClaimed()).toBe(false);
  expect(markUsernameClaimed(a)).toBe(false);
  expect(seen).toHaveBeenCalledTimes(1);
  expect(markUsernameClaimed(usernameGateSession())).toBe(true);
  expect(seen).toHaveBeenCalledTimes(2);
  setUsernameGateAccount("A"); expect(markUsernameClaimed(a)).toBe(false);
  expect(isUsernameClaimed()).toBe(false);
  setUsernameGateAccount(null);
  expect(markUsernameClaimed(usernameGateSession())).toBe(false);
});
