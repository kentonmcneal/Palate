import * as Notifications from "expo-notifications";
import { scheduleDigest, CONFIRM_CATEGORY, buildDigest, digestNotificationTitle } from "../passive-digest";
import type { InboxEntry } from "../passive-confirm";
jest.mock("expo-notifications", () => ({
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("synthetic-id"),
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
jest.mock("../eating-pattern", () => ({ loadEatingPattern: jest.fn().mockResolvedValue(null) }));
jest.mock("../analytics", () => ({ track: jest.fn() }));
const now = new Date(2026, 8, 29, 18);
const entry = (band: string, count: number, id="coffee"): InboxEntry => ({
 id, place_id: id, name: "Synthetic coffee shop", address: "Fixture", alternates: [],
 detectedAt: new Date(2026,8,29,10).getTime(), dwellMin: 8, confidenceBand: band, candidateCount: count,
});
beforeEach(() => jest.clearAllMocks());
async function scheduled(entries: InboxEntry[]) {
 await scheduleDigest(entries, async()=>null, async()=>{}, now);
 expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
 return (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].content;
}
it.each(["high", "medium"])("ambiguous %s stop requires venue choice without direct Yes/No", async band => {
 const content = await scheduled([entry(band,2)]);
 expect(content.categoryIdentifier).toBeUndefined();
 expect(content.data.place_id).toBeUndefined();
 expect(content.data.inbox_id).toBeUndefined();
 expect(content.body).toMatch(/several places.*tap to choose/i);
 expect(content.body).not.toMatch(/answer here/i);
});
it.each(["high", "medium"])("unambiguous %s coffee names venue and preserves direct answer", async band => {
 const content = await scheduled([entry(band,1)]);
 expect(content.categoryIdentifier).toBe(CONFIRM_CATEGORY);
 expect(content.data.place_id).toBe("coffee");
 expect(content.body).toContain("Synthetic coffee shop");
 expect(content.body).toMatch(/answer here/i);
 if(band === "high") expect(content.title).toBe("Food or a drink at Synthetic coffee shop?");
});
it("multiple stops open the digest without direct confirmation of the first", async()=>{
 const content=await scheduled([entry("high",1,"a"),entry("high",1,"b")]);
 expect(content.categoryIdentifier).toBeUndefined();
 expect(content.data.place_id).toBeUndefined();
 expect(content.title).toBe("Food or drinks at 2 places today?");
});
it("low-only coffee keeps a review prompt without direct confirmation",async()=>{
 const content=await scheduled([entry("low",1)]);
 expect(content.categoryIdentifier).toBeUndefined();
 expect(content.body).toMatch(/food or drink stops/i);
});

it("legacy high-band ambiguous stops stay visible but are never preselected",()=>{
 const digest=buildDigest([entry("high",2)],now);
 expect(digest.high).toHaveLength(1);
 expect(digest.high[0].preChecked).toBe(false);
 expect(digest.high[0].ambiguous).toBe(true);
 expect(digestNotificationTitle(digest)).toBe("Were you out today?");
});
it("mixed high-band title counts only stops actually preselected",()=>{
 const digest=buildDigest([entry("high",2,"ambiguous"),{...entry("high",1,"clear"),name:"Clear cafe"}],now);
 expect(digest.high.filter(e=>e.preChecked).map(e=>e.id)).toEqual(["clear"]);
 expect(digestNotificationTitle(digest)).toBe("Food or a drink at Clear cafe?");
});

const legacyAmbiguityCases: { label: string; metadata: Partial<InboxEntry> }[] = [
  {
    label: "missing count with an alternate",
    metadata: {
      candidateCount: undefined,
      alternates: [{ google_place_id: "other-cafe", name: "Other cafe" }] as InboxEntry["alternates"],
    },
  },
  {
    label: "incorrect count of one with an alternate",
    metadata: {
      candidateCount: 1,
      alternates: [{ google_place_id: "other-cafe", name: "Other cafe" }] as InboxEntry["alternates"],
    },
  },
  {
    label: "cluster flag without a count",
    metadata: { candidateCount: undefined, cluster: true },
  },
];

it.each(legacyAmbiguityCases)("legacy $label stays visible, unchecked and unnamed in the title", ({ metadata }) => {
  const digest = buildDigest([{ ...entry("high", 1), confidence: 0.9, ...metadata }], now);
  expect(digest.total).toBe(1);
  expect(digest.high).toHaveLength(1);
  expect(digest.high[0]).toMatchObject({ id: "coffee", ambiguous: true, preChecked: false });
  expect(digestNotificationTitle(digest)).toBe("Were you out today?");
});

it.each(legacyAmbiguityCases)("legacy $label cannot receive direct scheduler confirmation actions", async ({ metadata }) => {
  const content = await scheduled([{ ...entry("high", 1), confidence: 0.9, ...metadata }]);
  expect(content.categoryIdentifier).toBeUndefined();
  expect(content.data.place_id).toBeUndefined();
  expect(content.data.inbox_id).toBeUndefined();
  expect(content.title).toBe("Were you out today?");
  expect(content.body).toMatch(/several places.*tap to choose/i);
  expect(content.body).not.toMatch(/answer here/i);
});
