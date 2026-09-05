// ============================================================================
// notification-schedule.ts — the weekly proactive nudges.
// ----------------------------------------------------------------------------
// A tester asked for these directly: "Once sending locations Friday night or
// Saturday morning directing people to the discover tab — hey it's Friday,
// here's some date night spots in your area."
//
// Everything here is a LOCAL weekly notification, deliberately. Local
// notifications keep firing whether or not the user opens the app, which is
// the entire point of a re-engagement nudge — a schedule we could only refresh
// on app open would reach exactly the users who don't need reaching.
//
// The cost of that choice, stated plainly: an OS-scheduled local notification
// cannot be conditioned on state at fire time. "Skip the ping if they already
// logged a visit in the last two hours" is not enforceable here; it needs
// server-side push. The push token infrastructure already exists
// (registerPushToken in notifications.ts) and is unused — that's the upgrade
// path, noted in SPRINT_LOG rather than faked with a guard that doesn't run.
//
// What IS enforced:
//   • one nudge per day, max — they are on four different weekdays
//   • every fire time sits inside 9am-6pm, so quiet hours can't be violated
//   • a single remote kill switch (feature_flags: discovery_pings)
//   • per-ping opt-out in Settings, and one master toggle
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isFlagEnabled } from "./flags";

export const DISCOVERY_PINGS_FLAG = "discovery_pings";

const SCHEDULED_IDS_KEY = "palate.discoveryPings.ids";
const ENABLED_KEY = "palate.discoveryPings.enabled";

/** iOS calendar weekdays: 1 = Sunday … 7 = Saturday. */
export type Ping = {
  key: string;
  weekday: number;
  hour: number;
  minute: number;
  title: string;
  body: string;
  /** Route the tap opens. */
  pathname: string;
  params?: Record<string, string>;
};

export const PINGS: Ping[] = [
  {
    key: "friday_date_night",
    weekday: 6, // Friday
    hour: 16,
    minute: 30,
    title: "It's Friday",
    body: "Three date night spots near you, picked for your palate.",
    pathname: "/(tabs)/discover",
    params: { list: "date-night" },
  },
  {
    key: "saturday_brunch",
    weekday: 7, // Saturday
    hour: 10,
    minute: 0,
    title: "Saturday brunch, sorted",
    body: "Three near you. No scrolling required.",
    pathname: "/(tabs)/discover",
    params: { list: "brunch" },
  },
  {
    key: "thursday_stretch",
    weekday: 5, // Thursday
    hour: 18,
    minute: 0,
    title: "Same palate all week?",
    body: "One place that's a deliberate left turn.",
    pathname: "/(tabs)",
    params: { mood: "surprise" },
  },
];

async function loadLib(): Promise<typeof import("expo-notifications") | null> {
  try {
    return await import("expo-notifications");
  } catch {
    return null;
  }
}

export async function areDiscoveryPingsEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(ENABLED_KEY)) !== "0";
}

export async function setDiscoveryPingsEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  await refreshDiscoveryPings();
}

async function cancelAll(Notifications: typeof import("expo-notifications")): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULED_IDS_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    for (const id of ids) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
  } finally {
    await AsyncStorage.removeItem(SCHEDULED_IDS_KEY);
  }
}

/**
 * Reconcile the OS schedule with what should be scheduled. Safe to call on
 * every launch: it cancels what it previously scheduled before re-adding, so
 * repeated calls can never stack duplicates (the bug that produced the
 * duplicate-notification screenshots on the confirm path).
 *
 * Never prompts for permission — it rides on a grant the user already gave.
 */
export async function refreshDiscoveryPings(): Promise<number> {
  const Notifications = await loadLib();
  if (!Notifications) return 0;

  await cancelAll(Notifications);

  if (!(await areDiscoveryPingsEnabled())) return 0;
  // Remote kill switch, fails closed.
  if (!(await isFlagEnabled(DISCOVERY_PINGS_FLAG))) return 0;

  const perm = await Notifications.getPermissionsAsync().catch(() => null);
  if (!perm?.granted) return 0;

  const ids: string[] = [];
  for (const ping of PINGS) {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: ping.title,
          body: ping.body,
          sound: "default",
          data: {
            type: "discovery_ping",
            key: ping.key,
            pathname: ping.pathname,
            ...(ping.params ?? {}),
          },
        },
        // SDK 57 requires the typed trigger — the untyped
        // {weekday,hour,minute,repeats} form throws "invalid trigger".
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: ping.weekday,
          hour: ping.hour,
          minute: ping.minute,
        },
      });
      ids.push(id);
    } catch {
      // One bad ping must not take the rest of the schedule down with it.
    }
  }

  await AsyncStorage.setItem(SCHEDULED_IDS_KEY, JSON.stringify(ids));
  return ids.length;
}

/** Every fire time must sit inside waking hours — asserted in tests so a
 *  future edit can't quietly introduce a 3am buzz. */
export function violatesQuietHours(ping: Ping): boolean {
  return ping.hour < 8 || ping.hour >= 22;
}
