// ============================================================================
// notifications.ts — local notifications for the Sunday Wrapped reminder.
// ----------------------------------------------------------------------------
// We use *local* notifications (no push server, no Apple Push Notification
// service required) which means everything works in Expo Go AND TestFlight
// without extra config. The OS schedules them and fires even when the app
// is closed.
//
// Requires the `expo-notifications` package — add it via `npx expo install
// expo-notifications` and rebuild before this file does anything useful.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREF_KEY = "palate.notifications.enabled";
const SCHEDULED_KEY = "palate.notifications.scheduledId";

// Lazy import so the rest of the app keeps building if expo-notifications
// isn't installed yet (it's a new dependency for this feature).
async function loadNotificationsLib(): Promise<typeof import("expo-notifications") | null> {
  try {
    const mod = await import("expo-notifications");
    return mod;
  } catch {
    console.warn(
      "[notifications] expo-notifications not installed — run: npx expo install expo-notifications",
    );
    return null;
  }
}

export async function isReminderEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(PREF_KEY);
  return v === "1";
}

/**
 * Asks for notification permission and schedules a weekly Sunday-9am
 * "Your Palate Wrapped is ready" local notification.
 */
export async function enableSundayWrappedReminder(): Promise<{ ok: boolean; reason?: string }> {
  const Notifications = await loadNotificationsLib();
  if (!Notifications) return { ok: false, reason: "module_missing" };

  const perm = await Notifications.getPermissionsAsync();
  let granted = perm.granted;
  if (!granted) {
    const ask = await Notifications.requestPermissionsAsync();
    granted = ask.granted;
  }
  if (!granted) return { ok: false, reason: "denied" };

  // Cancel any prior scheduling so we don't stack duplicates.
  const existingId = await AsyncStorage.getItem(SCHEDULED_KEY);
  if (existingId) {
    try { await Notifications.cancelScheduledNotificationAsync(existingId); } catch {}
  }

  // Weekly trigger: Sunday at 9:00 AM local time.
  // Notifications.WeekdayTrigger uses 1=Sunday in iOS calendar terms.
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: "🔥 Your Palate Wrapped is ready",
      body: "See what you actually ate this week.",
      sound: "default",
      data: { type: "weekly_wrapped" },
    },
    trigger: {
      weekday: 1, // Sunday
      hour: 9,
      minute: 0,
      repeats: true,
    } as any,
  });

  await AsyncStorage.setItem(SCHEDULED_KEY, id);
  await AsyncStorage.setItem(PREF_KEY, "1");
  return { ok: true };
}

export async function disableSundayWrappedReminder(): Promise<void> {
  const Notifications = await loadNotificationsLib();
  if (!Notifications) return;
  const existingId = await AsyncStorage.getItem(SCHEDULED_KEY);
  if (existingId) {
    try { await Notifications.cancelScheduledNotificationAsync(existingId); } catch {}
  }
  await AsyncStorage.removeItem(SCHEDULED_KEY);
  await AsyncStorage.setItem(PREF_KEY, "0");
}
