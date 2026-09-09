import fs from "fs";
import path from "path";

// ============================================================================
// The list of dead exported functions may shrink. It may not grow.
// ============================================================================
// Seventeen exported functions are called by nothing — not another module, not
// a test, not even their own file. They are listed rather than deleted because
// they are not all the same thing:
//
//   • Superseded. friends.loadFriendsLeaderboard lost to board.loadBoard, and
//     nobody removed the loser.
//   • Deliberately parked. gmail.rescanGmail carries a comment saying to leave
//     it: the scheduled scan_all path shares its server handler and a button
//     wired to it would write visits and spend lookups with no review step.
//   • Dormant behind a flag. messages.unreadTotal has no caller because
//     direct_messages is off, and it becomes an unread badge the day it is on.
//   • Admin tooling built ahead of the screen that would use it.
//
// Deleting all of those on one judgement would throw away the second and third
// kinds. So this freezes the set instead: the count cannot rise, and anything
// removed from the list must also be removed from the codebase. It turns an
// unknown quantity of dead code into a known one that cannot grow while nobody
// is looking, which is how the nine dead components got to four months old.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");

const KNOWN_DEAD = [
  "components/Impressions.tsx:resetImpressionsForTest",
  "components/Shimmer.tsx:ListSkeleton",
  "lib/browsing-location.ts:getBrowsingCity",
  "lib/feed.ts:postMilestone",
  "lib/feedback-admin.ts:feedbackScreenshotUrl",
  "lib/feedback-admin.ts:feedbackUnreadCount",
  "lib/friends.ts:followCounts",
  "lib/friends.ts:loadFriendsLeaderboard",
  "lib/gmail.ts:rescanGmail",
  "lib/haptics.ts:triggerHapticWarning",
  "lib/messages.ts:unreadTotal",
  "lib/notification-primer.ts:__resetPrimerGate",
  "lib/passive-permissions.ts:canReAskAlways",
  "lib/personal-signal.ts:emptyPersonalSignal",
  "lib/profile.ts:getTastePreferences",
  "lib/taste-vector.ts:topN",
  "lib/waitlist.ts:listBlacklistedPlaces",
];

function sources(): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  const walk = (dir: string) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "__fixtures__") continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) out.push({ rel, src: fs.readFileSync(path.join(ROOT, rel), "utf8") });
    }
  };
  ["components", "lib", "hooks", "app"].forEach(walk);
  return out;
}

// This file names every dead function in KNOWN_DEAD, so scanning it would
// find each of them "referenced" and report nothing dead at all. The guard
// would defeat itself and pass forever, which is the exact failure mode it
// exists to prevent elsewhere.
const SELF = path.join("lib", "__tests__", "no-new-dead-exports.test.ts");
const all = sources().filter((f) => f.rel !== SELF);
const prod = all.filter((f) => !f.rel.includes("__tests__"));
const EXPORTED_FN = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;

/** Called by nothing anywhere, including its own file and every test. */
function deadExports(): string[] {
  const dead: string[] = [];
  for (const f of prod) {
    for (const m of f.src.matchAll(EXPORTED_FN)) {
      const name = m[1];
      const word = new RegExp(`\\b${name}\\b`);
      const ownUses = (f.src.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length - 1;
      const elsewhere = all.some((o) => o.rel !== f.rel && word.test(o.src));
      if (ownUses === 0 && !elsewhere) dead.push(`${f.rel}:${name}`);
    }
  }
  return dead.sort();
}

describe("dead exported functions", () => {
  const dead = deadExports();

  it("scans a real number of files", () => {
    expect(prod.length).toBeGreaterThan(100);
  });

  it("has not grown", () => {
    const added = dead.filter((d) => !KNOWN_DEAD.includes(d));
    expect(added).toEqual([]);
  });

  it("does not list anything that has since been wired up or removed", () => {
    // Keeps the list honest in the other direction: burn one down and this
    // fails until the entry goes too.
    const stale = KNOWN_DEAD.filter((k) => !dead.includes(k));
    expect(stale).toEqual([]);
  });
});
