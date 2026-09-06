import { captureStatus, CAPTURE_OK_BODY } from "../capture-status";

// The strip must never be wrong about which of the two grants is missing, and
// must send a first-timer to the value screen and everyone else to Settings.
describe("captureStatus", () => {
  const base = { always: true, whenInUse: true, notifications: true, optedIn: true };

  it("is quiet when both grants are in", () => {
    expect(captureStatus(base)).toEqual({ kind: "ok", body: CAPTURE_OK_BODY });
  });

  it("location comes first, whatever notifications say", () => {
    const s = captureStatus({ ...base, always: false, notifications: false });
    expect(s.kind).toBe("location");
  });

  it("names While Using when that is what the person picked", () => {
    const s = captureStatus({ ...base, always: false, whenInUse: true });
    expect(s.kind === "location" && s.body).toMatch(/While Using/);
  });

  it("sends somebody who never opted in to the intro, and everyone else to Settings", () => {
    const fresh = captureStatus({ ...base, always: false, optedIn: false });
    const opted = captureStatus({ ...base, always: false, optedIn: true });
    expect(fresh.kind === "location" && fresh.fix).toBe("passive-intro");
    expect(opted.kind === "location" && opted.fix).toBe("ios-settings");
  });

  it("asks for notifications only once location is Always", () => {
    const s = captureStatus({ ...base, notifications: false });
    expect(s.kind).toBe("notifications");
    expect(s.kind === "notifications" && s.fix).toBe("notifications-intro");
  });

  it("uses no em dashes in anything a person reads", () => {
    for (const s of [
      captureStatus(base),
      captureStatus({ ...base, always: false }),
      captureStatus({ ...base, always: false, whenInUse: false }),
      captureStatus({ ...base, notifications: false }),
    ]) {
      const text = s.kind === "ok" ? s.body : s.title + s.body;
      expect(text).not.toMatch(/\u2014/);
    }
  });
});
