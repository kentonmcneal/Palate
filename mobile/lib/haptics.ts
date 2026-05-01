// ============================================================================
// haptics.ts — thin wrapper around expo-haptics with lazy import.
// ----------------------------------------------------------------------------
// Lazy so the rest of the app keeps building if expo-haptics isn't installed
// in some build pass; calls are no-ops in that case. Always non-blocking.
// ============================================================================

async function loadHaptics(): Promise<typeof import("expo-haptics") | null> {
  try {
    return await import("expo-haptics");
  } catch {
    return null;
  }
}

/** Crisp double-tap feel for save / confirm actions. */
export async function triggerHapticSuccess(): Promise<void> {
  try {
    const Haptics = await loadHaptics();
    if (!Haptics) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Silent — haptics never block UX.
  }
}

/** Light tap for selection / toggle. */
export async function triggerHapticSelection(): Promise<void> {
  try {
    const Haptics = await loadHaptics();
    if (!Haptics) return;
    await Haptics.selectionAsync();
  } catch {
    // Silent.
  }
}

/** Warning thump for destructive / failure feedback. */
export async function triggerHapticWarning(): Promise<void> {
  try {
    const Haptics = await loadHaptics();
    if (!Haptics) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // Silent.
  }
}
