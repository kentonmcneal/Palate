// ============================================================================
// build-info.ts — which bundle is this, actually.
// ----------------------------------------------------------------------------
// "Did the update land?" came up repeatedly during a night of OTA publishing,
// and there was no way to answer it from the phone. The app version alone does
// not distinguish two updates on the same runtime, which is exactly the case
// that matters: every OTA tonight shipped to runtime 0.1.7 and 0.1.8, so a
// tester on an hour-old bundle and one on the current bundle both read "0.1.8".
//
// Surfaced in Settings -> About so a tester can read it back without a cable,
// and so "I still see the old screen" becomes a checkable claim rather than a
// guess about whether the double-launch worked.
// ============================================================================

import * as Updates from "expo-updates";
import Constants from "expo-constants";

export type BuildInfo = {
  version: string;
  /** Short id of the running OTA, or null when running the built-in bundle. */
  updateId: string | null;
  /** When that update was published. */
  publishedAt: string | null;
  /** True when no OTA has been applied — the code baked into the binary. */
  embedded: boolean;
  runtimeVersion: string | null;
};

export function buildInfo(): BuildInfo {
  const version = (Constants.expoConfig?.version as string | undefined) ?? "unknown";

  // In development there is no update at all; every field here is optional at
  // runtime whatever the types claim, so nothing is read without a guard.
  const id = (Updates.updateId as string | null | undefined) ?? null;
  const created = (Updates.createdAt as Date | null | undefined) ?? null;

  return {
    version,
    updateId: id ? id.slice(0, 8) : null,
    publishedAt: created ? created.toLocaleString() : null,
    embedded: Boolean(Updates.isEmbeddedLaunch),
    runtimeVersion: (Updates.runtimeVersion as string | null | undefined) ?? null,
  };
}

/**
 * One line for Settings. Says plainly when you are NOT on an update.
 *
 * Pure and separate from buildInfo() on purpose: the reader touches the
 * expo-updates namespace, which is awkward to mock and pointless to test, while
 * the wording is the part worth pinning.
 */
export function formatBuildInfo(info: BuildInfo): string {
  if (info.embedded || !info.updateId) {
    return `Palate ${info.version} · no update applied (built-in bundle)`;
  }
  return `Palate ${info.version} · update ${info.updateId}${
    info.publishedAt ? ` · ${info.publishedAt}` : ""
  }`;
}

export function buildInfoLine(): string {
  return formatBuildInfo(buildInfo());
}

/**
 * Force a check now, and reload if something new arrived.
 *
 * expo-updates checks on launch and applies on the NEXT launch, which means a
 * tester who opens the app, looks, and closes it is permanently one update
 * behind — and during a run of frequent publishes they never catch up. This is
 * the way out that does not involve explaining app lifecycles to somebody.
 *
 * Returns what happened so the caller can say it plainly rather than leaving
 * the user to guess whether anything occurred.
 */
export async function checkForUpdateNow(): Promise<
  | { status: "updated" }
  | { status: "current" }
  | { status: "unavailable"; reason: string }
> {
  if (!Updates.isEnabled) {
    return { status: "unavailable", reason: "Updates are off in this build." };
  }
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return { status: "current" };
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync(); // does not return
    return { status: "updated" };
  } catch (e: any) {
    return {
      status: "unavailable",
      reason: String(e?.message ?? e).slice(0, 140),
    };
  }
}
