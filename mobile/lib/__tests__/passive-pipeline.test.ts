import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  dwellMinutes,
  distanceMeters,
  qualifyVisit,
  isHomeOrWorkSuppressed,
  recordForClustering,
} from "../passive-pipeline";
import { resolveRadius } from "../passive-pipeline";
import { isQuietHours } from "../passive-confirm";
import type { RawVisit } from "../passive-capture";

function visit(partial: Partial<RawVisit> = {}): RawVisit {
  const departAt = Date.parse("2026-08-10T13:00:00");
  const base: RawVisit = {
    id: "v1",
    lat: 33.749,
    lng: -84.388,
    horizontalAccuracy: 30,
    arrivalAt: departAt - 45 * 60_000, // 45 min dwell
    departureAt: departAt,
    capturedAt: departAt,
    simulated: true,
  };
  // Spread so an explicit `null` (e.g. an open visit) overrides the default.
  return { ...base, ...partial };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("dwell + distance", () => {
  it("computes dwell minutes", () => {
    expect(dwellMinutes(visit())).toBeCloseTo(45, 0);
  });
  it("returns null for an open visit", () => {
    expect(dwellMinutes(visit({ departureAt: null }))).toBeNull();
  });
  it("distanceMeters ~0 for identical points and >100m apart", () => {
    expect(distanceMeters(33.749, -84.388, 33.749, -84.388)).toBeCloseTo(0, 1);
    expect(distanceMeters(33.749, -84.388, 33.75, -84.388)).toBeGreaterThan(100);
  });
});

describe("qualifyVisit thresholds", () => {
  it("accepts a normal 45-min visit with good accuracy", async () => {
    const q = await qualifyVisit(visit());
    expect(q.ok).toBe(true);
  });
  it("rejects a too-short dwell", async () => {
    const depart = Date.parse("2026-08-10T13:00:00");
    const q = await qualifyVisit(visit({ arrivalAt: depart - 3 * 60_000, departureAt: depart }));
    expect(q).toMatchObject({ ok: false, reason: "dwell-too-short" });
  });

  // The two cases the feature exists for, stated as the spec: a short sit-down
  // and a fast-food counter stop both have to qualify.
  it("accepts a 10-minute sit-down", async () => {
    const depart = Date.parse("2026-08-10T13:00:00");
    const q = await qualifyVisit(visit({ arrivalAt: depart - 10 * 60_000, departureAt: depart }));
    expect(q).toMatchObject({ ok: true });
  });

  it("accepts a 5-minute fast-food stop", async () => {
    const depart = Date.parse("2026-08-10T13:00:00");
    const q = await qualifyVisit(visit({ arrivalAt: depart - 5 * 60_000, departureAt: depart }));
    expect(q).toMatchObject({ ok: true });
  });
  it("rejects a too-long dwell", async () => {
    const depart = Date.parse("2026-08-10T13:00:00");
    const q = await qualifyVisit(visit({ arrivalAt: depart - 5 * 3_600_000, departureAt: depart }));
    expect(q).toMatchObject({ ok: false, reason: "dwell-too-long" });
  });
  it("rejects a low-accuracy fix", async () => {
    const q = await qualifyVisit(visit({ horizontalAccuracy: 250 }));
    expect(q).toMatchObject({ ok: false, reason: "low-accuracy" });
  });
  it("rejects an open visit", async () => {
    const q = await qualifyVisit(visit({ departureAt: null }));
    expect(q).toMatchObject({ ok: false, reason: "open-visit" });
  });
});

describe("home/work suppression", () => {
  it("suppresses a recurring overnight location, not a one-off daytime one", async () => {
    const home = { lat: 33.9, lng: -84.4 };
    // Three overnight (2am) visits at the same spot -> learned as home.
    for (let i = 0; i < 3; i++) {
      await recordForClustering(
        visit({ id: `h${i}`, lat: home.lat, lng: home.lng, arrivalAt: Date.parse("2026-08-10T02:00:00") }),
      );
    }
    expect(await isHomeOrWorkSuppressed(visit({ lat: home.lat, lng: home.lng }))).toBe(true);
    // A different, un-clustered lunch spot is not suppressed.
    expect(await isHomeOrWorkSuppressed(visit({ lat: 33.749, lng: -84.388 }))).toBe(false);
  });
});

describe("quiet hours", () => {
  it("is quiet at 11pm and 6am, awake at noon", () => {
    expect(isQuietHours(new Date(2026, 7, 10, 23, 0))).toBe(true);
    expect(isQuietHours(new Date(2026, 7, 10, 6, 0))).toBe(true);
    expect(isQuietHours(new Date(2026, 7, 10, 12, 0))).toBe(false);
  });
});

describe("significant-change source thresholds", () => {
  // A significant-change fix is coarse by nature. Judging it by the CLVisit
  // accuracy bound would reject every one, which is what made the backstop
  // useless in the first place.
  it("accepts a coarse fix from the slc source that CLVisit bounds would reject", async () => {
    const coarse = visit({ horizontalAccuracy: 300, source: "slc" });
    await expect(qualifyVisit(coarse)).resolves.toMatchObject({ ok: true });
  });

  it("still rejects a coarse fix that claims to be a CLVisit", async () => {
    const coarse = visit({ horizontalAccuracy: 300 });
    await expect(qualifyVisit(coarse)).resolves.toMatchObject({
      ok: false,
      reason: "low-accuracy",
    });
  });

  it("rejects an slc fix that is coarse even by slc standards", async () => {
    const useless = visit({ horizontalAccuracy: 900, source: "slc" });
    await expect(qualifyVisit(useless)).resolves.toMatchObject({
      ok: false,
      reason: "low-accuracy",
    });
  });

  it("searches a wider radius for slc fixes, and treats a missing source as CLVisit", () => {
    expect(resolveRadius(visit({ source: "slc" }))).toBeGreaterThan(resolveRadius(visit()));
    expect(resolveRadius(visit())).toBe(resolveRadius(visit({ source: "visit" })));
  });

  it("applies dwell rules identically regardless of source", async () => {
    const short = visit({
      source: "slc",
      arrivalAt: Date.parse("2026-08-10T12:58:00"),
      departureAt: Date.parse("2026-08-10T13:00:00"),
    });
    await expect(qualifyVisit(short)).resolves.toMatchObject({ reason: "dwell-too-short" });
  });
});

describe("stop source (primary detector)", () => {
  // A "stop" record ships with a one-shot high-accuracy fix, so it must be held
  // to the tight bounds — that precision is the whole reason we can name one
  // restaurant rather than list a block.
  it("holds stop records to the precise accuracy bound", async () => {
    await expect(qualifyVisit(visit({ source: "stop", horizontalAccuracy: 30 })))
      .resolves.toMatchObject({ ok: true });
    await expect(qualifyVisit(visit({ source: "stop", horizontalAccuracy: 300 })))
      .resolves.toMatchObject({ ok: false, reason: "low-accuracy" });
  });

  it("searches the tight radius for stop records", () => {
    expect(resolveRadius(visit({ source: "stop" }))).toBe(resolveRadius(visit()));
  });
});
