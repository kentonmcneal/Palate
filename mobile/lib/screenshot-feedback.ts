// ============================================================================
// screenshot-feedback.ts — offer the feedback form when a user screenshots.
// ----------------------------------------------------------------------------
// A tester pointed out that screenshots weren't prompting anything. They were
// right: nothing in the app listened for one. A screenshot is the clearest
// free signal we get that something on screen was worth capturing — surprising,
// broken, or good enough to share.
//
// The prompt is deliberately cheap to ignore. Users screenshot for reasons that
// have nothing to do with us (sending a restaurant to a friend is the whole
// point of the app), so an over-eager sheet would be worse than no sheet:
//
//   • once per 24h, at most
//   • 60s hard mute after a dismiss, so a burst of screenshots can't nag
//   • off entirely with one toggle in Settings
//
// The OS never hands us the screenshot image — we only learn that one happened.
// The manual attach path in app/feedback.tsx stays the way to send a picture.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";

const ENABLED_KEY = "palate.screenshotFeedback.enabled";
const LAST_PROMPT_KEY = "palate.screenshotFeedback.lastPromptAt";
const LAST_DISMISS_KEY = "palate.screenshotFeedback.lastDismissAt";

export const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const DISMISS_MUTE_MS = 60 * 1000;

export type PromptState = {
  enabled: boolean;
  lastPromptAt: number | null;
  lastDismissAt: number | null;
};

/**
 * Pure decision function — all the throttling rules in one testable place.
 */
export function shouldPrompt(state: PromptState, now: number): boolean {
  if (!state.enabled) return false;
  if (state.lastDismissAt != null && now - state.lastDismissAt < DISMISS_MUTE_MS) return false;
  if (state.lastPromptAt != null && now - state.lastPromptAt < PROMPT_COOLDOWN_MS) return false;
  return true;
}

async function readNumber(key: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Default ON — an opt-out, not an opt-in. */
export async function isScreenshotPromptEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(ENABLED_KEY)) !== "0";
}

export async function setScreenshotPromptEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, on ? "1" : "0");
}

export async function loadPromptState(): Promise<PromptState> {
  const [enabled, lastPromptAt, lastDismissAt] = await Promise.all([
    isScreenshotPromptEnabled(),
    readNumber(LAST_PROMPT_KEY),
    readNumber(LAST_DISMISS_KEY),
  ]);
  return { enabled, lastPromptAt, lastDismissAt };
}

export async function recordPromptShown(now = Date.now()): Promise<void> {
  await AsyncStorage.setItem(LAST_PROMPT_KEY, String(now));
}

export async function recordPromptDismissed(now = Date.now()): Promise<void> {
  await AsyncStorage.setItem(LAST_DISMISS_KEY, String(now));
}

/** Convenience for the listener: read state and decide in one call. */
export async function shouldPromptNow(now = Date.now()): Promise<boolean> {
  return shouldPrompt(await loadPromptState(), now);
}
