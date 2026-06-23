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
const DAILY_REMINDER_KEY = "palate.notifications.dailyReminderId";

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

/**
 * Register an Expo push token for the signed-in user. Idempotent — only
 * writes to profiles when the token actually changed. Safe to call on every
 * app launch from the root layout.
 */
export async function registerPushToken(): Promise<void> {
  const Notifications = await loadNotificationsLib();
  if (!Notifications) return;
  const Device = await loadDeviceLib();
  // Push notifications don't work in iOS Simulator. Bail silently — local
  // notifications and the rest of the app keep working.
  if (Device && !Device.isDevice) return;

  // Need notification permission first
  const perm = await Notifications.getPermissionsAsync();
  let granted = perm.granted;
  if (!granted) {
    const ask = await Notifications.requestPermissionsAsync();
    granted = ask.granted;
  }
  if (!granted) return;

  try {
    const Constants = await import("expo-constants");
    const projectId =
      Constants.default.expoConfig?.extra?.eas?.projectId ??
      Constants.default.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenData.data;

    const { supabase } = await import("./supabase");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Only update if the token actually changed.
    const { data: prof } = await supabase
      .from("profiles")
      .select("push_token")
      .eq("id", user.id)
      .maybeSingle();
    if (prof?.push_token === token) return;

    const Platform = (await import("react-native")).Platform;
    await supabase.from("profiles").update({
      push_token: token,
      push_platform: Platform.OS === "ios" ? "ios" : "android",
    }).eq("id", user.id);
  } catch (err) {
    console.warn("[notifications] push token register failed", err);
  }
}

async function loadDeviceLib(): Promise<typeof import("expo-device") | null> {
  try { return await import("expo-device"); } catch { return null; }
}

/**
 * Re-engagement nudge. Schedules a one-shot local notification for this
 * evening if the user hasn't logged today, with streak-aware copy so an
 * at-risk streak gets a sharper message. Safe to call on every Home load:
 * it cancels any prior daily reminder first so we never stack.
 *
 * Only schedules for users who have ALREADY granted notification permission —
 * it never prompts. (The Sunday-Wrapped opt-in in Settings is where users
 * grant permission; this rides on that grant.)
 */
export async function refreshDailyReminder(opts: { loggedToday: boolean; streak: number }): Promise<void> {
  const Notifications = await loadNotificationsLib();
  if (!Notifications) return;

  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;

  // Clear any prior daily reminder so we never stack duplicates.
  const existing = await AsyncStorage.getItem(DAILY_REMINDER_KEY);
  if (existing) {
    try { await Notifications.cancelScheduledNotificationAsync(existing); } catch {}
    await AsyncStorage.removeItem(DAILY_REMINDER_KEY);
  }

  // Already logged today → nothing to nudge. Tomorrow's Home load reschedules.
  if (opts.loggedToday) return;

  // Fire tonight at 8:00pm local — only if that's still comfortably in the
  // future (no midnight buzzing; if it's already past, the next day handles it).
  const fire = new Date();
  fire.setHours(20, 0, 0, 0);
  if (fire.getTime() <= Date.now() + 60_000) return;

  const { title, body } = streakReminderCopy(opts.streak);
  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default", data: { type: "streak_reminder" } },
    trigger: fire as any,
  });
  await AsyncStorage.setItem(DAILY_REMINDER_KEY, id);
}

function streakReminderCopy(streak: number): { title: string; body: string } {
  if (streak >= 1) {
    return {
      title: `🔥 Your ${streak}-day streak is on the line`,
      body: "Log today's meal before midnight to keep it alive.",
    };
  }
  return {
    title: "What did you eat today?",
    body: "Ten seconds to log it — every visit sharpens your Wrapped.",
  };
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
