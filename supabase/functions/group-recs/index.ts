// Palate — "best restaurant for everybody".
//
// Given 2-4 friends, rank nearby places for the group and return the picks
// with per-person scores.
//
// WHY THIS IS SERVER-SIDE AND NOT A CLIENT FEATURE
// Ranking for a group requires reading every member's taste history. Doing that
// on a phone means shipping other people's eating patterns to someone else's
// device, where they can be read regardless of what the UI chooses to draw. So
// the vectors never leave this function: the caller sends user ids and gets
// back restaurants and scores.
//
// AGGREGATION IS MINIMAX, NOT MEAN — the single most important decision here.
// Averaging taste vectors reliably picks the blandest option in range: the
// place nobody objects to is not the place anybody wanted. "Best restaurant for
// everybody" means nobody has a bad night, which is maximising the FLOOR. A
// veto pass runs first, because an allergy or a hard dislike is not a scoring
// problem and should not be outvoted by three enthusiasts.
//
// CANDIDATES COME FROM CACHE ONLY. This function never calls Google. If the
// area has no stored coverage it says so and returns nothing, rather than
// quietly spending on a paid lookup — group sessions are the exact shape of
// feature that turns one paid call into hundreds.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_MEMBERS = 4;
/** Below this for ANY member, a place is vetoed regardless of the others. */
const VETO_FLOOR = 30;
const MAX_CANDIDATES = 200;
const RESULT_SIZE = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Candidate = {
  google_place_id: string;
  name: string;
  cuisine_region: string | null;
  cuisine_subregion: string | null;
  cuisine_type: string | null;
  format_class: string | null;
  price_level: number | null;
  rating: number | null;
  user_rating_count: number | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** A member's eating pattern, reduced to shares. Never returned to a caller. */
type Profile = {
  userId: string;
  regions: Record<string, number>;
  subregions: Record<string, number>;
  formats: Record<string, number>;
  prices: Record<string, number>;
  visits: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "missing auth" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !caller?.user) return json({ error: "bad auth" }, 401);
    const callerId = caller.user.id;

    const body = await req.json().catch(() => ({}));
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const radius = Math.min(Number(body.radius_m) || 3000, 8000);
    const requested: string[] = Array.isArray(body.member_ids) ? body.member_ids : [];

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: "lat/lng required" }, 400);
    }

    // The caller is always in their own group, and never needs befriending.
    const others = [...new Set(requested.filter((id) => id && id !== callerId))];
    if (others.length === 0) return json({ error: "no_members" }, 400);
    if (others.length > MAX_MEMBERS - 1) return json({ error: "too_many_members" }, 400);

    // --- authorization: every member must be an ACCEPTED friend of the caller.
    // Checked here, per member, rather than trusted from the request. Without
    // this the endpoint would read any user's history for anyone who guessed
    // an id.
    const { data: friendRows } = await admin
      .from("friendships")
      .select("requester_id, addressee_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${callerId},addressee_id.eq.${callerId}`);

    const friends = new Set<string>();
    for (const f of (friendRows ?? []) as { requester_id: string; addressee_id: string }[]) {
      friends.add(f.requester_id === callerId ? f.addressee_id : f.requester_id);
    }
    const unauthorized = others.filter((id) => !friends.has(id));
    if (unauthorized.length > 0) return json({ error: "not_friends" }, 403);

    const memberIds = [callerId, ...others];

    // --- profiles (server-side only; never returned)
    const profiles: Profile[] = [];
    for (const id of memberIds) {
      profiles.push(await buildProfile(admin, id));
    }
    const thin = profiles.filter((p) => p.visits < 3).map((p) => p.userId);

    // --- candidates: CACHE ONLY. No Google, ever, from this path.
    const dLat = radius / 111_000;
    const dLng = radius / ((111_000 * Math.cos((lat * Math.PI) / 180)) || 111_000);
    const { data: places } = await admin
      .from("restaurants_resolved")
      .select(
        "google_place_id, name, cuisine_region, cuisine_subregion, cuisine_type:resolved_cuisine_type, format_class:resolved_format_class, price_level, rating, user_rating_count, neighborhood, latitude, longitude, chain_name, is_chain_brand, recommendation_eligibility, primary_type, types",
      )
      .gte("latitude", lat - dLat).lte("latitude", lat + dLat)
      .gte("longitude", lng - dLng).lte("longitude", lng + dLng)
      .or("recommendation_eligibility.is.null,recommendation_eligibility.gt.0")
      .order("user_rating_count", { ascending: false, nullsFirst: false })
      .limit(MAX_CANDIDATES);

    const candidates = ((places ?? []) as (Candidate & {
      chain_name: string | null;
      is_chain_brand: boolean | null;
    })[]).filter((c) => !c.chain_name && c.is_chain_brand !== true);

    if (candidates.length === 0) {
      // Honest, specific, and NOT a silent fallback to a paid lookup.
      return json({ picks: [], reason: "no_cached_coverage", thin_members: thin });
    }

    // --- score, veto, rank
    const scored = candidates.map((c) => {
      const perMember = profiles.map((p) => ({
        user_id: p.userId,
        score: scoreFor(p, c),
      }));
      const floor = Math.min(...perMember.map((m) => m.score));
      return { candidate: c, perMember, floor };
    });

    const survivors = scored.filter((s) => s.floor >= VETO_FLOOR);
    // If the veto removes everything, say so rather than serving the group a
    // place one of them will hate.
    const pool = survivors.length > 0 ? survivors : [];

    pool.sort((a, b) => {
      if (b.floor !== a.floor) return b.floor - a.floor;
      // Tie-break on the group average — among places with the same worst
      // case, prefer the one that is better for everyone else.
      const avg = (s: typeof a) => s.perMember.reduce((n, m) => n + m.score, 0) / s.perMember.length;
      return avg(b) - avg(a);
    });

    return json({
      picks: pool.slice(0, RESULT_SIZE).map((s) => ({
        google_place_id: s.candidate.google_place_id,
        name: s.candidate.name,
        cuisine: s.candidate.cuisine_type,
        neighborhood: s.candidate.neighborhood,
        price_level: s.candidate.price_level,
        rating: s.candidate.rating,
        group_score: Math.round(s.floor),
        per_member: s.perMember.map((m) => ({ user_id: m.user_id, score: Math.round(m.score) })),
      })),
      vetoed: scored.length - survivors.length,
      considered: scored.length,
      thin_members: thin,
      reason: survivors.length === 0 ? "all_vetoed" : null,
    });
  } catch (e) {
    console.error("group-recs failed", e);
    return json({ error: String(e) }, 500);
  }
});

/**
 * Reduce a member's visits to shares. Deliberately small: cuisine, format and
 * price are what a group actually negotiates over. This is a SIMPLER scorer
 * than the client's five-dimension compatibility model, and that is a known
 * trade — see the note in SPRINT_LOG. What matters for a group pick is the
 * ordering among these candidates, not parity with the solo match number.
 */
async function buildProfile(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<Profile> {
  const { data } = await admin
    .from("visits")
    .select("restaurant:restaurants(cuisine_region, cuisine_subregion, format_class, price_level)")
    .eq("user_id", userId)
    .order("visited_at", { ascending: false })
    .limit(300);

  const regions: Record<string, number> = {};
  const subregions: Record<string, number> = {};
  const formats: Record<string, number> = {};
  const prices: Record<string, number> = {};
  let visits = 0;

  for (const row of (data ?? []) as { restaurant: Record<string, unknown> | Record<string, unknown>[] | null }[]) {
    const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
    if (!r) continue;
    visits++;
    bump(regions, r.cuisine_region as string | null);
    bump(subregions, r.cuisine_subregion as string | null);
    bump(formats, r.format_class as string | null);
    bump(prices, r.price_level == null ? null : String(r.price_level));
  }

  normalize(regions); normalize(subregions); normalize(formats); normalize(prices);
  return { userId, regions, subregions, formats, prices, visits };
}

function bump(map: Record<string, number>, key: string | null) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

function normalize(map: Record<string, number>) {
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  if (total === 0) return;
  for (const k of Object.keys(map)) map[k] = map[k] / total;
}

/**
 * 0..100 for one person and one place.
 *
 * A member with almost no history scores everything near the neutral middle
 * rather than near zero — otherwise a newcomer would veto the entire city on
 * their first night out, which is the opposite of what the veto is for.
 */
function scoreFor(p: Profile, c: Candidate): number {
  if (p.visits < 3) return 55;

  const region = c.cuisine_region ? (p.regions[c.cuisine_region] ?? 0) : 0;
  const sub = c.cuisine_subregion ? (p.subregions[c.cuisine_subregion] ?? 0) : 0;
  const format = c.format_class ? (p.formats[c.format_class] ?? 0) : 0;
  const price = c.price_level != null ? (p.prices[String(c.price_level)] ?? 0) : 0;

  // Shares are small numbers (a third of your meals is 0.33), so each is
  // scaled toward its own ceiling rather than used raw.
  const taste = Math.min(1, region * 2.2) * 0.45 + Math.min(1, sub * 2.6) * 0.20;
  const habit = Math.min(1, format * 2.2) * 0.20 + Math.min(1, price * 2.2) * 0.15;

  // Quality floor: a place nobody in the group has a pattern for should still
  // beat a badly-reviewed one.
  const quality =
    c.rating == null ? 0.5 :
    c.rating >= 4.5 ? 1 :
    c.rating >= 4.2 ? 0.8 :
    c.rating >= 3.9 ? 0.55 : 0.25;

  const composite = (taste + habit) * 0.75 + quality * 0.25;
  return Math.max(20, Math.min(99, Math.round(Math.pow(composite, 0.75) * 100)));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
