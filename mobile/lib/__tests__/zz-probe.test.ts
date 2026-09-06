import {
  digestWindowStart, digestTimeFor, buildDigest, isDigestWorthSending,
  digestNotificationBody, digestHourOn,
} from "../passive-digest";

const fmt = (d: Date) => d.toString().slice(0, 24);

function entry(name: string, at: Date, band: string) {
  return {
    id: name, place_id: name, name, address: "", alternates: [],
    detectedAt: at.getTime(), dwellMin: 30, confidenceBand: band,
    confidence: band === "high" ? 0.9 : band === "medium" ? 0.5 : 0.2,
    candidateCount: 1,
  } as any;
}

test("probe", () => {
  const log: string[] = [];
  // Local timezone of this machine
  log.push("TZ offset mins=" + new Date().getTimezoneOffset());

  // Case A: Thursday 22:00 capture (Thu digest hour 21 already passed)
  const thu2200 = new Date(2026, 8, 3, 22, 0, 0); // Thu Sep 3 2026
  log.push("Thu 22:00 getDay=" + thu2200.getDay() + " digestHour=" + digestHourOn(thu2200));
  log.push("A schedule-time window start = " + fmt(digestWindowStart(thu2200)));
  log.push("A fire time = " + fmt(digestTimeFor(thu2200)));
  const eA = entry("LateThuPlace", thu2200, "high");
  const dA = buildDigest([eA], thu2200);
  log.push("A schedule-time total=" + dA.total + " worth=" + isDigestWorthSending(dA) +
    " body=" + digestNotificationBody(dA, (ms) => new Date(ms).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})));

  // Now open the digest screen when it fires (Fri 23:01)
  const fri2301 = new Date(2026, 8, 4, 23, 1, 0);
  log.push("Fri 23:01 getDay=" + fri2301.getDay() + " digestHour=" + digestHourOn(fri2301));
  log.push("A delivery-time window start = " + fmt(digestWindowStart(fri2301)));
  const dA2 = buildDigest([eA], fri2301);
  log.push("A delivery-time total=" + dA2.total + " (screen shows this many)");

  // Case B: window width asymmetry midday vs post-digest
  const thu1200 = new Date(2026, 8, 3, 12, 0, 0);
  log.push("B window at Thu 12:00 = " + fmt(digestWindowStart(thu1200)) + " -> now (width hrs=" +
    ((thu1200.getTime() - digestWindowStart(thu1200).getTime())/3600000).toFixed(1) + ")");
  const thu2105 = new Date(2026, 8, 3, 21, 5, 0);
  log.push("B window at Thu 21:05 = " + fmt(digestWindowStart(thu2105)) + " -> now (width hrs=" +
    ((thu2105.getTime() - digestWindowStart(thu2105).getTime())/3600000).toFixed(1) + ")");

  // Case C: yesterday's unconfirmed entry counted at schedule time, dropped at fire time
  const wed1300 = new Date(2026, 8, 2, 13, 0, 0);
  const eC = entry("WedPlace", wed1300, "high");
  const dC1 = buildDigest([eC], thu1200);
  const dC2 = buildDigest([eC], thu2105);
  log.push("C Wed 13:00 entry: counted at Thu 12:00 schedule = " + dC1.total +
           " ; shown at Thu 21:05 open = " + dC2.total);

  // Case D: low-band only
  const eD = entry("LowOnly", thu1200, "low");
  const dD = buildDigest([eD], thu1200);
  log.push("D low-only worthSending=" + isDigestWorthSending(dD) + " total=" + dD.total);

  // Case E: title grammar, 1 high + 1 low
  const dE = buildDigest([entry("H", thu1200, "high"), entry("L", thu1200, "low")], thu1200);
  log.push("E total=" + dE.total + " title=" + (dE.total === 1 ? "One place to confirm" : `${dE.high.length + dE.medium.length} places to confirm`));

  // Case F: Friday digest hour / 11pm
  const fri = new Date(2026, 8, 4, 13, 0, 0);
  log.push("F Friday fire time = " + fmt(digestTimeFor(fri)) + " (hour " + digestHourOn(fri) + ")");
  const sat = new Date(2026, 8, 5, 13, 0, 0);
  log.push("F Saturday fire time = " + fmt(digestTimeFor(sat)) + " (hour " + digestHourOn(sat) + ")");

  // eslint-disable-next-line no-console
  console.log("\n" + log.join("\n") + "\n");
  expect(true).toBe(true);
});
