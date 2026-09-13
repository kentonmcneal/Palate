import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");

// ----------------------------------------------------------------------------
// Timezone must be written for accounts that never granted notifications.
// ----------------------------------------------------------------------------
// It used to be set ONLY inside registerPushToken(), which returns early when
// notification permission was never granted. On 2026-09-13 that left eleven of
// eighteen accounts with a null timezone, three of them holding a live push
// token — and next_sendable_at() fails closed on a null (0055), so those three
// could never receive a proactive push at all. Nothing anywhere reported it.
//
// The shape of that bug is "the only writer is behind a permission gate", so
// that is what this checks.
// ----------------------------------------------------------------------------
describe("timezone is captured independently of notification permission", () => {
  const notifications = fs.readFileSync(path.join(ROOT, "lib/notifications.ts"), "utf8");
  const layout = fs.readFileSync(path.join(ROOT, "app/_layout.tsx"), "utf8");

  it("exports a standalone syncTimezone", () => {
    expect(notifications).toMatch(/export async function syncTimezone\(/);
  });

  it("syncTimezone does not require a push token", () => {
    const start = notifications.indexOf("export async function syncTimezone(");
    const body = notifications.slice(start, notifications.indexOf("\n}", start));
    expect(body).not.toMatch(/getExpoPushTokenAsync|push_token:/);
    expect(body).toMatch(/resolvedOptions\(\)\.timeZone/);
    expect(body).toMatch(/update\(\{ timezone/);
  });

  it("the app calls it on launch, separately from registerPushToken", () => {
    expect(layout).toMatch(/syncTimezone\(\)/);
    // Separately: if the only call site were inside the push branch we would
    // be back where we started.
    const tzCall = layout.indexOf("syncTimezone()");
    const pushCall = layout.indexOf("registerPushToken()");
    expect(tzCall).toBeGreaterThan(-1);
    expect(tzCall).not.toBe(pushCall);
  });

  it("writes on change, not only when missing", () => {
    // Somebody who moves or travels should not keep their old night.
    const start = notifications.indexOf("export async function syncTimezone(");
    const body = notifications.slice(start, notifications.indexOf("\n}", start));
    expect(body).toMatch(/prof\?\.timezone === tz/);
  });
});
