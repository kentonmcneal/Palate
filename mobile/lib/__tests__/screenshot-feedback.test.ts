import { shouldPrompt, PROMPT_COOLDOWN_MS, DISMISS_MUTE_MS } from "../screenshot-feedback";

const NOW = 1_800_000_000_000;

describe("screenshot feedback throttling", () => {
  it("prompts on a first screenshot", () => {
    expect(shouldPrompt({ enabled: true, lastPromptAt: null, lastDismissAt: null }, NOW)).toBe(true);
  });

  it("never prompts when the user turned it off", () => {
    expect(shouldPrompt({ enabled: false, lastPromptAt: null, lastDismissAt: null }, NOW)).toBe(false);
  });

  it("stays quiet for a full day after prompting", () => {
    const state = { enabled: true, lastPromptAt: NOW, lastDismissAt: null };
    expect(shouldPrompt(state, NOW + PROMPT_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldPrompt(state, NOW + PROMPT_COOLDOWN_MS)).toBe(true);
  });

  it("hard-mutes for a minute after a dismiss", () => {
    // The case that matters: someone screenshotting five things in a row to
    // send to a friend must not get nagged on every one.
    const state = { enabled: true, lastPromptAt: null, lastDismissAt: NOW };
    expect(shouldPrompt(state, NOW + 5_000)).toBe(false);
    expect(shouldPrompt(state, NOW + DISMISS_MUTE_MS)).toBe(true);
  });

  it("applies the daily cooldown even when the dismiss mute has expired", () => {
    const state = { enabled: true, lastPromptAt: NOW, lastDismissAt: NOW };
    expect(shouldPrompt(state, NOW + DISMISS_MUTE_MS + 1)).toBe(false);
  });
});
