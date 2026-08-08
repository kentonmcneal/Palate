// Palate — Push notifier for new waitlist signups.
//
// Fired by a DB trigger (migration 0045) whenever a profile lands on the
// waitlist (approval_status -> 'pending'). Authenticates with the shared
// CRON_SECRET (same secret as the Sunday Wrapped / featured-lists crons), so it
// is deployed with `--no-verify-jwt`. Looks up every admin's push token and
// sends a single Expo push. Silent + best-effort — never throws into the
// trigger.
//
// Body: { new_user_id?: string }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Shared-secret auth — same shape as the existing cron-invoked functions.
    const secret = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const newUserId = body.new_user_id as string | undefined;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Who just joined (best-effort label for the notification body).
    let joinerLabel = "Someone new";
    if (newUserId) {
      const { data: joiner } = await admin
        .from("profiles")
        .select("display_name, email")
        .eq("id", newUserId)
        .maybeSingle();
      joinerLabel =
        joiner?.display_name ||
        (joiner?.email ? String(joiner.email).split("@")[0] : "Someone new");
    }

    // How many are waiting right now (gives the admin a running count).
    const { count: pendingCount } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "pending");

    // Every admin with a registered push token.
    const { data: admins } = await admin
      .from("profiles")
      .select("id, push_token")
      .eq("is_admin", true)
      .not("push_token", "is", null);

    const recipients = (admins ?? [])
      .map((a) => a.push_token as string)
      .filter(Boolean);

    if (recipients.length === 0) return json({ sent: 0, reason: "no_admin_push_token" });

    const n = pendingCount ?? 0;
    const messages = recipients.map((to) => ({
      to,
      sound: "default" as const,
      title: "New Palate signup",
      body: `${joinerLabel} is waiting to join${n > 0 ? ` · ${n} pending` : ""}`,
      data: { type: "waitlist_pending", new_user_id: newUserId ?? null },
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
    return json({ sent: recipients.length, pending: n });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
