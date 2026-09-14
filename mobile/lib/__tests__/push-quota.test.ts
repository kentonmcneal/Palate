import {
  admit,
  classOf,
  CEILINGS,
  MAX_ANNOUNCE_PER_USER_PER_DAY,
  type PushClass,
  type QuotaRow,
} from "../../../supabase/functions/_shared/push-quota";

const NOW = new Date("2026-09-14T01:02:27Z").getTime();
const U = "user-1";

function hoursOut(h: number): string {
  return new Date(NOW + h * 3600 * 1000).toISOString();
}

function row(id: string, type: string, ttlHours: number | null): QuotaRow {
  return {
    id,
    user_id: U,
    data: { type },
    expires_at: ttlHours == null ? null : hoursOut(ttlHours),
  };
}

function counts(partial: Partial<Record<PushClass, number>>): Record<PushClass, Map<string, number>> {
  const mk = (n?: number) => (n ? new Map([[U, n]]) : new Map<string, number>());
  return { direct: mk(partial.direct), announce: mk(partial.announce), ambient: mk(partial.ambient) };
}

/**
 * Build the trailing-24h tally from the push types actually delivered, routing
 * each through classOf exactly as send-push does.
 *
 * Hand-placing a number in a named bucket instead would make the test assert
 * its own setup: it would still pass with every type collapsed back into one
 * shared bucket, which is the very bug these cases exist to catch.
 */
function sentTypes(...types: string[]): Record<PushClass, Map<string, number>> {
  const by: Record<PushClass, Map<string, number>> = {
    direct: new Map(),
    announce: new Map(),
    ambient: new Map(),
  };
  for (const t of types) {
    const m = by[classOf({ data: { type: t } })];
    m.set(U, (m.get(U) ?? 0) + 1);
  }
  return by;
}

describe("classOf", () => {
  it("splits correspondence, announcements and the ambient feed", () => {
    expect(classOf({ data: { type: "dm_message" } })).toBe("direct");
    expect(classOf({ data: { type: "post_comment" } })).toBe("direct");
    expect(classOf({ data: { type: "user_joined" } })).toBe("announce");
    expect(classOf({ data: { type: "friend_visit" } })).toBe("ambient");
  });

  // A heart is a reaction, not a message. Fifteen likes must not cost
  // somebody fifteen buzzes, so likes stay rationed with the ambient feed.
  it("keeps likes ambient", () => {
    expect(classOf({ data: { type: "post_like" } })).toBe("ambient");
    expect(classOf({ data: { type: "comment_like" } })).toBe("ambient");
  });

  // An unknown type must be rationed, never privileged: a new push type added
  // without touching this file should default to the strictest sensible cap.
  it("defaults an unknown or missing type to ambient", () => {
    expect(classOf({ data: { type: "something_new" } })).toBe("ambient");
    expect(classOf({ data: {} })).toBe("ambient");
    expect(classOf({ data: null })).toBe("ambient");
  });
});

// The bug this file exists to prevent. On 2026-09-13 and again on 2026-09-14
// a "someone you follow ate somewhere" push was DROPPED because the user had
// already received three "someone joined Palate" pushes that day. Over nine
// days production sent sixteen announcements and one friend_visit.
describe("announcements cannot starve the social loop", () => {
  it("admits a friend_visit even after three announcements the same day", () => {
    const sent = sentTypes("user_joined", "user_joined", "user_joined");
    const v = admit([row("fv", "friend_visit", 12)], sent, NOW);
    expect(v.admit.map((r) => r.id)).toEqual(["fv"]);
    expect(v.expire).toEqual([]);
    expect(v.defer).toEqual([]);
  });

  it("still caps the ambient feed on its own merits", () => {
    const v = admit([row("fv", "friend_visit", 12)], counts({ ambient: 3 }), NOW);
    expect(v.admit).toEqual([]);
    // 12h TTL dies inside the 24h defer window, so deferring would only be a
    // slower way of dropping it.
    expect(v.expire).toEqual(["fv"]);
  });

  it("rations announcements to one a day", () => {
    const rows = [row("a1", "user_joined", 72), row("a2", "user_joined", 72), row("a3", "user_joined", 72)];
    const v = admit(rows, counts({}), NOW);
    expect(v.admit).toHaveLength(MAX_ANNOUNCE_PER_USER_PER_DAY);
    expect(v.expire).toHaveLength(2);
  });

  // "Someone joined three days ago" is worth nothing. Deferring a signup burst
  // trickles it out one a day for three days — the stale backlog the expiry
  // mechanism exists to avoid — so surplus announcements are dropped outright
  // even though their 72h TTL would survive a defer.
  it("drops surplus announcements rather than deferring them", () => {
    const v = admit([row("a2", "user_joined", 72)], counts({ announce: 1 }), NOW);
    expect(v.defer).toEqual([]);
    expect(v.expire).toEqual(["a2"]);
  });
});

describe("a scarce slot goes to whatever dies first", () => {
  // Arrival order would hand the slot to the older announcement. Here the two
  // rows are the same class with one slot left between them.
  it("prefers the perishable row over the durable one", () => {
    const rows = [row("durable", "comeback", 72), row("perishable", "friend_visit", 12)];
    const v = admit(rows, counts({ ambient: 2 }), NOW);
    expect(v.admit.map((r) => r.id)).toEqual(["perishable"]);
  });

  // Never expiring means important, not discardable: visit confirmations carry
  // a null expiry and must not sort last behind perishable broadcasts.
  it("puts a never-expiring row first, not last", () => {
    const rows = [row("broadcast", "friend_visit", 12), row("confirm", "user_wrapped", null)];
    const v = admit(rows, counts({ ambient: 2 }), NOW);
    expect(v.admit.map((r) => r.id)).toEqual(["confirm"]);
    // The broadcast then loses on the ambient cap's own terms, and its 12h TTL
    // dies inside the defer window, so it is dropped rather than deferred.
    expect(v.expire).toEqual(["broadcast"]);
  });
});

describe("correspondence keeps its own, higher ceiling", () => {
  it("is unaffected by a full ambient and announcement budget", () => {
    const sent = sentTypes("friend_visit", "post_like", "comeback", "user_joined");
    const v = admit([row("dm", "dm_message", 48)], sent, NOW);
    expect(v.admit.map((r) => r.id)).toEqual(["dm"]);
  });

  it("is still bounded", () => {
    const v = admit([row("dm", "dm_message", 48)], counts({ direct: CEILINGS.direct }), NOW);
    expect(v.admit).toEqual([]);
    // 48h outlives the 24h defer window, so a real message waits rather than
    // being thrown away.
    expect(v.defer).toEqual(["dm"]);
  });
});

describe("within-run admission counts against the same budget", () => {
  it("does not let one drain hand a user four ambient pushes", () => {
    const rows = [
      row("f1", "friend_visit", 12),
      row("f2", "friend_visit", 13),
      row("f3", "friend_visit", 14),
      row("f4", "friend_visit", 15),
    ];
    const v = admit(rows, counts({}), NOW);
    expect(v.admit).toHaveLength(CEILINGS.ambient);
    expect(v.expire).toEqual(["f4"]);
  });
});
