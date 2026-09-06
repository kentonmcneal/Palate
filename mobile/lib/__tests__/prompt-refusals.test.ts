import AsyncStorage from "@react-native-async-storage/async-storage";

// A place answered "not here" twice is almost always home, work, or the shop
// next door. These tests cover the three layers of the demotion: the pure
// line (shouldDemote), the count behind it (placeRefusals, against a recording
// query builder), and the seam in notifyOrInbox that turns a count into a Low
// inbox entry without ever losing the entry.

type Call = [string, unknown[]];
const mockDb: {
  count: number | null;
  error: null | { message: string; code?: string };
  throwOn: string | null;
  calls: Call[];
  from: string[];
} = { count: 0, error: null, throwOn: null, calls: [], from: [] };

jest.mock("../supabase", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit", "insert", "upsert", "delete", "maybeSingle", "single"]) {
    builder[m] = (...args: unknown[]) => {
      mockDb.calls.push([m, args]);
      if (mockDb.throwOn === m) throw new Error(`boom in ${m}`);
      return builder;
    };
  }
  // Awaiting the builder resolves the query, as supabase-js does.
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: [], count: mockDb.count, error: mockDb.error });
  return {
    supabase: {
      from: (table: string) => { mockDb.from.push(table); return builder; },
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    },
  };
});

jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("../observability", () => ({ captureError: jest.fn() }));
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  setNotificationCategoryAsync: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
}));
// recentlyPrompted is stubbed; placeRefusals and shouldDemote are the real
// ones, so the seam test exercises the actual count-to-demotion path.
jest.mock("../visits", () => ({
  ...jest.requireActual("../visits"),
  recentlyPrompted: jest.fn().mockResolvedValue(false),
}));

import { track } from "../analytics";
import { captureError } from "../observability";
import {
  shouldDemote, placeRefusals, recordPromptDecision, recentlyPrompted, DEMOTE_AFTER_REFUSALS,
} from "../visits";
import { notifyOrInbox, getInbox, DEMOTED_CONFIDENCE_CAP } from "../passive-confirm";

const NOON = new Date();
NOON.setHours(12, 0, 0, 0);

function resolved(placeId: string, name: string, confidence: number, band: string, detectedAt = NOON.getTime()) {
  return {
    raw: {
      id: `${placeId}-${detectedAt}`,
      departureAt: detectedAt,
      capturedAt: detectedAt,
      horizontalAccuracy: 30,
      source: "visit",
    },
    candidates: [{ google_place_id: placeId, name, address: "1 Main St" }],
    cacheHit: false,
    confidence,
    confidenceBand: band,
  } as never;
}

function suppressions(reason: string) {
  return (track as jest.Mock).mock.calls.filter(
    (c) => c[0] === "confirm_notif_suppressed" && c[1]?.reason === reason,
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockDb.count = 0;
  mockDb.error = null;
  mockDb.throwOn = null;
  mockDb.calls = [];
  mockDb.from = [];
  jest.useFakeTimers().setSystemTime(NOON);
});
afterEach(() => {
  jest.useRealTimers();
});

describe("shouldDemote", () => {
  it("never demotes a place that has not been refused", () => {
    expect(shouldDemote(0)).toBe(false);
  });

  it("gives a single refusal the benefit of the doubt", () => {
    // One "not here" is a walk past. Two is a pattern.
    expect(shouldDemote(1)).toBe(false);
  });

  it("demotes at exactly two", () => {
    expect(shouldDemote(2)).toBe(true);
    expect(DEMOTE_AFTER_REFUSALS).toBe(2);
  });

  it("stays demoted however many more refusals arrive", () => {
    expect(shouldDemote(3)).toBe(true);
    expect(shouldDemote(40)).toBe(true);
  });

  it("treats nonsense counts as no evidence", () => {
    // A failed read returns 0; anything odder than that must fail safe too.
    expect(shouldDemote(-1)).toBe(false);
    expect(shouldDemote(Number.NaN)).toBe(false);
  });
});

describe("placeRefusals", () => {
  it("counts only refusals, for this place, inside the window", async () => {
    mockDb.count = 3;
    const n = await placeRefusals("home");
    expect(n).toBe(3);
    expect(mockDb.from).toEqual(["prompt_decisions"]);
    // A count query, not a row fetch: nothing about the rows themselves is needed.
    expect(mockDb.calls).toContainEqual(["select", ["id", { count: "exact", head: true }]]);
    expect(mockDb.calls).toContainEqual(["eq", ["google_place_id", "home"]]);
    expect(mockDb.calls).toContainEqual(["in", ["outcome", ["dismissed", "wrong_place"]]]);
    const since = new Date(NOON.getTime() - 90 * 24 * 60 * 60_000).toISOString();
    expect(mockDb.calls).toContainEqual(["gte", ["decided_at", since]]);
  });

  it("honours a custom window", async () => {
    await placeRefusals("home", 7);
    const since = new Date(NOON.getTime() - 7 * 24 * 60 * 60_000).toISOString();
    expect(mockDb.calls).toContainEqual(["gte", ["decided_at", since]]);
  });

  it("returns zero when the query errors", async () => {
    mockDb.count = 5;
    mockDb.error = { message: "permission denied", code: "42501" };
    expect(await placeRefusals("home")).toBe(0);
  });

  it("returns zero when the client throws", async () => {
    mockDb.throwOn = "in";
    expect(await placeRefusals("home")).toBe(0);
  });

  it("returns zero when the count comes back null", async () => {
    mockDb.count = null;
    expect(await placeRefusals("home")).toBe(0);
  });

  it("adds no user filter, because RLS already scopes the rows", async () => {
    await placeRefusals("home");
    const eqs = mockDb.calls.filter((c) => c[0] === "eq").map((c) => c[1][0]);
    expect(eqs).toEqual(["google_place_id"]);
  });
});

describe("recordPromptDecision reports a failed insert", () => {
  it("captures the error and tracks it instead of dropping it", async () => {
    mockDb.error = { message: 'invalid input value for enum prompt_outcome: "skip_today"', code: "22P02" };
    await expect(recordPromptDecision("home", "skip_today")).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalledWith(
      mockDb.error,
      expect.objectContaining({ at: "visits:recordPromptDecision", outcome: "skip_today", google_place_id: "home" }),
    );
    expect(track).toHaveBeenCalledWith(
      "prompt_decision_failed",
      expect.objectContaining({ outcome: "skip_today", place_id: "home", code: "22P02" }),
    );
  });

  it("stays quiet when the insert lands", async () => {
    await recordPromptDecision("home", "dismissed");
    expect(captureError).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith("prompt_decision_failed", expect.anything());
    expect(mockDb.calls).toContainEqual(["insert", [{ user_id: "u1", google_place_id: "home", outcome: "dismissed" }]]);
  });
});

describe("notifyOrInbox demotes a place refused before", () => {
  it("stores a twice-refused High detection as Low, so the digest lists it under Anything else", async () => {
    mockDb.count = 2;
    const result = await notifyOrInbox(resolved("home", "Corner Shop", 0.9, "high"), 45);

    expect(result).toBe("inboxed-digest");
    const [entry] = await getInbox();
    expect(entry.confidenceBand).toBe("low");
    expect(entry.confidence).toBe(DEMOTED_CONFIDENCE_CAP);
    expect(DEMOTED_CONFIDENCE_CAP).toBeLessThan(0.4);
    expect(suppressions("refused_before")).toEqual([
      ["confirm_notif_suppressed", { reason: "refused_before", place_id: "home" }],
    ]);
  });

  it("still lands the demoted detection in the inbox, so a real meal there is never lost", async () => {
    mockDb.count = 6;
    await notifyOrInbox(resolved("home", "Corner Shop", 0.9, "high"), 45);
    const inbox = await getInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].place_id).toBe("home");
    expect(inbox[0].name).toBe("Corner Shop");
  });

  it("leaves a once-refused place exactly as scored", async () => {
    mockDb.count = 1;
    await notifyOrInbox(resolved("cafe", "Corner Cafe", 0.9, "high"), 30);
    const [entry] = await getInbox();
    expect(entry.confidenceBand).toBe("high");
    expect(entry.confidence).toBe(0.9);
    expect(suppressions("refused_before")).toHaveLength(0);
  });

  it("never raises a confidence that was already lower than the cap", async () => {
    mockDb.count = 2;
    await notifyOrInbox(resolved("hall", "Food Hall", 0.2, "low"), 12);
    const [entry] = await getInbox();
    expect(entry.confidence).toBe(0.2);
    expect(entry.confidenceBand).toBe("low");
  });

  it("caps an entry that carried no confidence at all", async () => {
    // Entries from older builds have no score; Math.min against undefined
    // would be NaN, which the digest cannot band.
    mockDb.count = 2;
    await notifyOrInbox(resolved("old", "Old Build Spot", undefined as never, undefined as never), 20);
    const [entry] = await getInbox();
    expect(entry.confidence).toBe(0);
    expect(entry.confidenceBand).toBe("low");
  });

  it("treats a failed refusal read as no refusals", async () => {
    mockDb.throwOn = "gte";
    await notifyOrInbox(resolved("cafe", "Corner Cafe", 0.9, "high"), 30);
    const [entry] = await getInbox();
    expect(entry.confidenceBand).toBe("high");
    expect(suppressions("refused_before")).toHaveLength(0);
  });

  it("keeps the recently-dismissed suppression ahead of the demotion", async () => {
    // A venue rejected minutes ago stays out of the inbox entirely; the
    // refusal count is not even consulted.
    (recentlyPrompted as jest.Mock).mockResolvedValueOnce(true);
    mockDb.count = 2;
    const result = await notifyOrInbox(resolved("home", "Corner Shop", 0.9, "high"), 45);
    expect(result).toBe("suppressed-recent");
    expect(await getInbox()).toHaveLength(0);
    expect(mockDb.from).not.toContain("prompt_decisions");
    expect(suppressions("recently_dismissed")).toHaveLength(1);
    expect(suppressions("refused_before")).toHaveLength(0);
  });

  it("collapses a repeat detection of a demoted place into one entry", async () => {
    mockDb.count = 2;
    const t = NOON.getTime();
    const first = await notifyOrInbox(resolved("home", "Corner Shop", 0.9, "high", t), 45);
    const second = await notifyOrInbox(resolved("home", "Corner Shop", 0.9, "high", t + 60_000), 45);
    expect(first).toBe("inboxed-digest");
    expect(second).toBe("suppressed-duplicate");
    expect(await getInbox()).toHaveLength(1);
    // The duplicate is reported as a duplicate, not as a second demotion.
    expect(suppressions("refused_before")).toHaveLength(1);
  });
});
