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
import { cancelScheduledOfKind } from "./notification-dedupe";
// Static named import ONLY. A dynamic `import("react-native")` (or `import *`)
// enumerates the whole RN namespace, tripping the deprecated PushNotificationIOS
// lazy getter, which does `new NativeEventEmitter(null)` under the New
// Architecture and throws a fatal Invariant Violation inside registerPushToken.
import { Platform } from "react-native";

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
 * Ensure notification permission (request once if undetermined). Used by passive
 * capture so a later-detected visit can actually prompt. Returns whether granted.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = await loadNotificationsLib();
  if (!Notifications) return false;
  const perm = await Notifications.getPermissionsAsync();
  if (perm.granted) return true;
  if (!perm.canAskAgain) return false;
  const ask = await Notifications.requestPermissionsAsync();
  return ask.granted;
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

  // Cancel every prior Sunday reminder by kind, not by a remembered id.
  await cancelScheduledOfKind(Notifications, "type", "weekly_wrapped");

  // Weekly trigger: Sunday at 9:00 AM local time.
  // Notifications.WeekdayTrigger uses 1=Sunday in iOS calendar terms.
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: "🔥 Your Palate Wrapped is ready",
      body: "See what you actually ate this week.",
      sound: "default",
      data: { type: "weekly_wrapped" },
    },
    // SDK 57 typed weekly trigger (weekday 1 = Sunday). The old untyped
    // {weekday,hour,minute,repeats} form throws "invalid trigger" on SDK 57.
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1, // 1 = Sunday
      // 10, not 9: the cron writes Wrapped at 14:00 UTC, which is 09:00 in
      // Chicago and 10:00 in New York. At 9 local, anyone east of Chicago
      // was told it was ready before it existed.
      hour: 10,
      minute: 0,
    },
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

  try {
    // Need notification permission first. These calls MUST live inside the try:
    // on a brand-new account this is the first-ever permission prompt, and a
    // native rejection here (not a plain "denied" status) would otherwise escape
    // as an unhandled rejection — which the New Architecture turns into a fatal
    // that expo-updates escalates to a launch crash.
    // Never prompts. This runs on every session, which on a fresh install is
    // the first second of the first launch: the worst possible moment to put
    // up the iOS permission dialog, with no explanation of what it is for.
    // 6 of 14 accounts said yes to it. The ask now lives on
    // /notifications-intro (requestPushPermission below), which says what the
    // notifications are before iOS asks; this only records a grant that
    // already exists.
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;

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

    // The recipient's timezone, without which server-side quiet hours are
    // meaningless — the server has no other way to know when someone's night
    // is. Migration 0055 fails closed on a null here (no proactive push at
    // all), so this is worth writing even when the token hasn't changed.
    let tz: string | null = null;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      tz = null;
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("push_token, timezone")
      .eq("id", user.id)
      .maybeSingle();

    const tokenUnchanged = prof?.push_token === token;
    const tzUnchanged = !tz || prof?.timezone === tz;
    if (tokenUnchanged && tzUnchanged) return;

    const patch: Record<string, unknown> = {
      push_token: token,
      push_platform: Platform.OS === "ios" ? "ios" : "android",
    };
    if (tz) patch.timezone = tz;

    await supabase.from("profiles").update(patch).eq("id", user.id);
  } catch (err) {
    console.warn("[notifications] push token register failed", err);
  }
}

export type PushAsk = "granted" | "denied" | "blocked";

/**
 * The one place the app asks iOS for notification permission cold, called
 * from the primer screen after the person has read what they are agreeing
 * to. "blocked" means iOS will not show the dialog again and the only route
 * is Settings.
 */
export async function requestPushPermission(): Promise<PushAsk> {
  const Notifications = await loadNotificationsLib();
  if (!Notifications) return "blocked";
  const perm = await Notifications.getPermissionsAsync();
  if (perm.granted) {
    await registerPushToken();
    return "granted";
  }
  if (!perm.canAskAgain) return "blocked";
  const ask = await Notifications.requestPermissionsAsync();
  if (!ask.granted) return ask.canAskAgain === false ? "blocked" : "denied";
  await registerPushToken();
  return "granted";
}

async function loadDeviceLib(): Promise<typeof import("expo-device") | null> {
  try { return await import("expo-device"); } catch { return null; }
}

/**
 * Cancel the nightly streak nudge, on every Home load, forever.
 *
 * This used to schedule an 8pm local notification reading "Your N-day streak
 * is on the line. Log today's meal before midnight to keep it alive." The
 * founder received one and asked for it to go, and he is right twice over.
 *
 * It is the wrong thing to say. Palate's promise is that it notices where you
 * ate so you do not have to think about it, and a notification threatening to
 * take something away if you do not open the app is the opposite promise: it
 * makes the app the thing you owe, rather than the thing that helps. The
 * streak chip already came off Home for the same reason.
 *
 * It was also redundant. It fired at 8pm, an hour before the passive digest,
 * which asks a strictly better question because it names the places you were
 * actually at instead of asking cold whether you ate.
 *
 * This function stays rather than simply deleting the scheduler, because
 * every device that ran the old code has one of these already sitting in
 * iOS's queue, and deleting the code that creates them does not remove the
 * ones already created. It is cheap and idempotent, so it can keep running.
 */
export async function cancelStreakReminder(): Promise<void> {
  const Notifications = await loadNotificationsLib();
  if (!Notifications) return;
  await cancelScheduledOfKind(Notifications, "type", "streak_reminder");
  await AsyncStorage.removeItem(DAILY_REMINDER_KEY).catch(() => {});
}

export async function disableSundayWrappedReminder(): Promise<void> {
  const Notifications = await loadNotificationsLib();
  if (!Notifications) return;
  await cancelScheduledOfKind(Notifications, "type", "weekly_wrapped");
  await AsyncStorage.removeItem(SCHEDULED_KEY);
  await AsyncStorage.setItem(PREF_KEY, "0");
}

/**
 * Whether iOS will actually deliver a notification right now. Read-only: it
 * never prompts, so it is safe on every render of the home screen.
 *
 * This exists because notifications were absent from the activation ladder
 * entirely. Somebody could have Always location granted and meals detecting
 * and notifications off, which is the most wasteful state the app can be in:
 * it is watching, it is resolving, and it is asking nobody.
 */
export async function notificationsGranted(): Promise<boolean> {
  try {
    const Notifications = await loadNotificationsLib();
    if (!Notifications) return false;
    const perm = await Notifications.getPermissionsAsync();
    return !!perm.granted;
  } catch {
    return false;
  }
}
