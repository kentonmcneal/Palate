// Palate — Push notifier for feed events.
//
// Called by the mobile app (with the user's JWT) after a feed_event insert.
// Looks up the poster's accepted friends, fetches their push tokens, and
// sends a single Expo push request. Silent + best-effort — never throws into
// the caller's UX.
//
// Body: { feed_event_id: string }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "missing auth" }, 401);

    const userClient = createClient(SUPABASE_URL, jwt, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userData } = await userClient.auth.getUser();
    const me = userData.user?.id;
    if (!me) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const feedEventId = body.feed_event_id as string | undefined;
    if (!feedEventId) return json({ error: "feed_event_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Look up the event + caller display
    const { data: event, error: eErr } = await admin
      .from("feed_events")
      .select("id, user_id, kind, payload, created_at")
      .eq("id", feedEventId)
      .maybeSingle();
    if (eErr || !event) return json({ error: "event not found" }, 404);

    // Only the event owner is allowed to trigger pushes for their own event
    if (event.user_id !== me) return json({ error: "forbidden" }, 403);

    const { data: poster } = await admin
      .from("profiles")
      .select("display_name, email")
      .eq("id", me)
      .maybeSingle();
    const posterName =
      poster?.display_name ||
      (poster?.email ? poster.email.split("@")[0] : "Someone");

    // Friends of the poster who can see their events (visibility is enforced
    // via RLS on feed_events; we replicate the same gate here).
    const { data: friends } = await admin
      .from("friendships")
      .select("requester_id, addressee_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${me},addressee_id.eq.${me}`);

    const friendIds = (friends ?? [])
      .map((f) => (f.requester_id === me ? f.addressee_id : f.requester_id))
      .filter(Boolean);

    if (friendIds.length === 0) return json({ sent: 0 });

    const { data: tokens } = await admin
      .from("profiles")
      .select("id, push_token, profile_visibility")
      .in("id", friendIds)
      .not("push_token", "is", null);

    const recipients = (tokens ?? [])
      .filter((t) => t.profile_visibility !== "private")
      .map((t) => t.push_token as string);

    if (recipients.length === 0) return json({ sent: 0 });

    const title = posterName;
    const subtitle = subtitleFor(event.kind, event.payload, posterName);

    // Expo push API: batch up to 100 messages per call.
    const messages = recipients.map((to) => ({
      to,
      sound: "default" as const,
      title,
      body: subtitle,
      data: { type: "feed_event", event_id: feedEventId },
    }));

    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return json({ error: "expo_push_failed", detail: text }, 502);
    }
    return json({ sent: recipients.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function subtitleFor(kind: string, payload: unknown, posterName: string): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (kind === "wrapped_shared") {
    return `Shared a Wrapped — ${p.persona_label ?? "their week's read"}`;
  }
  if (kind === "milestone") {
    return `Hit a ${p.streak_days ?? ""}-day streak`;
  }
  if (kind === "persona_change") {
    return `New persona: ${p.to_persona ?? "—"}`;
  }
  return `${posterName} posted to your feed`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
