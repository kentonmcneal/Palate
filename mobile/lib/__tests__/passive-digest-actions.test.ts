import * as Notifications from "expo-notifications";
import { scheduleDigest, CONFIRM_CATEGORY } from "../passive-digest";
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
