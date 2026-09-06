import { buildDigest, digestNotificationTitle, digestWindowStart, digestTimeFor } from "../passive-digest";
import type { InboxEntry } from "../passive-confirm";

const INBOX_EXPIRY_H = 48; // passive-confirm.ts:46

const e = (id: string, d: string, band: "high"|"medium"|"low" = "high"): InboxEntry => ({
  id, place_id: "p-"+id, name: id, address: "", alternates: [],
  detectedAt: new Date(d).getTime(), dwellMin: 30,
  confidence: band === "high" ? 0.9 : band === "medium" ? 0.5 : 0.2,
  confidenceBand: band, candidateCount: 1,
} as InboxEntry);

/** getInbox()'s 48h prune, evaluated at `at`. */
const inboxAt = (all: InboxEntry[], at: Date) =>
  all.filter((x) => x.detectedAt >= at.getTime() - INBOX_EXPIRY_H * 3_600_000);

/** What scheduleDigest bakes into the notification (windowed, at bake time). */
const notif = (all: InboxEntry[], bake: Date) => {
  const d = buildDigest(inboxAt(all, bake), bake);           // windowed: default true
  return { n: d.high.length + d.medium.length, title: digestNotificationTitle(d) };
};
/** What app/digest.tsx now renders (UNWINDOWED, at open time). */
const screen = (all: InboxEntry[], open: Date) => {
  const d = buildDigest(inboxAt(all, open), open, { windowed: false });
  return { rows: d.high.length + d.medium.length, confirmBtn:
    [...d.high, ...d.medium, ...d.low].filter((x) => x.preChecked).length, total: d.total };
};

test("probe current tree", () => {
  const log: string[] = [];
  const show = (tag: string, all: InboxEntry[], bake: Date, open: Date) => {
    const nn = notif(all, bake), ss = screen(all, open);
    log.push(`${tag}\n   bake ${bake.toString().slice(0,24)} winStart=${digestWindowStart(bake).toString().slice(4,24)}` +
      `  fires ${digestTimeFor(bake).toString().slice(0,24)}\n   notif=${nn.n} "${nn.title}"  |  screen rows=${ss.rows} btn=Confirm ${ss.confirmBtn}` +
      `  ${nn.n === ss.confirmBtn ? "MATCH" : "*** MISMATCH ***"}`);
  };

  // B — the prior agent's scenario: leftovers from a digest the user ignored.
  show("B leftovers (the claim's scenario)",
    [e("wedLunch","2026-09-02T12:30:00"), e("wedDinner","2026-09-02T19:00:00"), e("thuLunch","2026-09-03T12:30:00")],
    new Date("2026-09-03T12:30:05"), new Date("2026-09-03T21:01:00"));

  // C — a capture lands after the digest was delivered.
  show("C capture after delivery",
    [e("lunch","2026-09-03T12:30:00"), e("dinner","2026-09-03T21:20:00")],
    new Date("2026-09-03T12:30:05"), new Date("2026-09-03T21:30:00"));

  // F — entry older than the bake-time window start but still inside 48h at open.
  show("F entry just outside the notif window, alive on screen",
    [e("tueAfternoon","2026-09-01T14:00:00"), e("thuLunch","2026-09-03T12:30:00")],
    new Date("2026-09-02T13:00:00"), new Date("2026-09-02T21:05:00"));

  // G — two nights of leftovers, second night.
  show("G two nights ignored",
    [e("tueDinner","2026-09-01T19:00:00"), e("wedLunch","2026-09-02T12:30:00")],
    new Date("2026-09-02T12:30:05"), new Date("2026-09-02T21:05:00"));

  // H — low-band only on screen but a high in the window, etc.
  show("H mixed bands",
    [e("wedLow","2026-09-02T12:00:00","low"), e("thuHigh","2026-09-03T13:00:00","high")],
    new Date("2026-09-03T13:00:05"), new Date("2026-09-03T21:05:00"));

  console.log("\n" + log.join("\n") + "\n");
  expect(true).toBe(true);
});
