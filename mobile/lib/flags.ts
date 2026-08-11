// ============================================================================
// flags.ts — client reader for remote feature flags (see migration 0049).
// ----------------------------------------------------------------------------
// Reads public.feature_flags with a short AsyncStorage cache. FAILS CLOSED:
// on any error, or a missing flag, it returns the provided fallback (default
// false). For a kill switch that means "if in doubt, stay OFF" — a network
// blip can never silently switch passive background location ON.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const CACHE_PREFIX = "palate.flag.";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

type Cached = { enabled: boolean; at: number };

export async function isFlagEnabled(key: string, fallback = false): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (raw) {
      const c = JSON.parse(raw) as Cached;
      if (Date.now() - c.at < TTL_MS) return c.enabled;
    }
  } catch {
    // ignore cache read errors; fall through to network
  }

  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    const enabled = data ? Boolean(data.enabled) : fallback;
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ enabled, at: Date.now() } satisfies Cached));
    return enabled;
  } catch {
    return fallback;
  }
}
