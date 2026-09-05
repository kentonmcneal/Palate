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
    // Stale beats wrong. A network blip used to read as "flag off", and in
    // the passive pipeline "off" marked a real visit processed forever. The
    // last value we ever saw is a far better guess than the fallback.
    const stale = await readStale(key);
    return stale ?? fallback;
  }
}

async function readStale(key: string): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return Boolean((JSON.parse(raw) as Cached).enabled);
  } catch {
    return null;
  }
}

/**
 * Tri-state read: true, false, or null when the flag is genuinely unknown
 * (no network and nothing ever cached). Callers that would destroy data on a
 * wrong answer use this and retry on null.
 */
export async function readFlag(key: string): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (raw) {
      const c = JSON.parse(raw) as Cached;
      if (Date.now() - c.at < TTL_MS) return c.enabled;
    }
  } catch { /* fall through */ }
  try {
    const { data, error } = await supabase.from("feature_flags").select("enabled").eq("key", key).maybeSingle();
    if (error) throw error;
    const enabled = data ? Boolean(data.enabled) : false;
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ enabled, at: Date.now() } satisfies Cached));
    return enabled;
  } catch {
    return readStale(key);
  }
}
