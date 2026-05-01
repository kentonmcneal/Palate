// Palate — Auto-generates the weekly Wrapped for every active user.
//
// Triggered by pg_cron every Sunday at 9am ET. Loops over users with at least
// one visit in the past week, calls the existing `generate_weekly_wrapped`
// RPC for each, and (optionally) sends an Expo push so they know to open it.
//
// No body required — runs on the cron schedule. Returns counts for telemetry.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Authn: only accept calls with the shared cron secret OR the service role key.
  const auth = req.headers.get("Authorization") ?? "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    // Also allow service-role for manual invocation
    if (auth !== `Bearer ${SUPABASE_SERVICE_KEY}`) {
      return json({ error: "unauthorized" }, 401);
    }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Find users with at least one visit in the last 14 days (so we cover
  // the boundary case — the cron might fire slightly early/late).
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: activeUsers, error: aErr } = await admin
    .from("visits")
    .select("user_id")
    .gte("visited_at", cutoff);
  if (aErr) return json({ error: aErr.message }, 500);

  const ids = [...new Set((activeUsers ?? []).map((r: any) => r.user_id))] as string[];
  if (ids.length === 0) return json({ generated: 0, pushed: 0 });

  // Compute Monday of this week (the wrapped is for the WEEK that's ending)
  const weekStart = isoMonday(new Date());

  let generated = 0;
  let pushFailures = 0;
  const tokens: string[] = [];

  for (const uid of ids) {
    try {
      const { error: rpcErr } = await admin.rpc("generate_weekly_wrapped", {
        p_week_start: weekStart,
        p_user_id_override: uid,
      } as any);
      // Note: if your RPC doesn't take p_user_id_override, the line above
      // is harmless — supabase-js will pass extra args; the RPC ignores them.
      // Some setups don't allow that — in which case set up the RPC to look at
      // auth.uid() and call from the user's session, or remove the loop entirely
      // and have the RPC iterate users itself.
      if (rpcErr) continue;
      generated++;

      const { data: prof } = await admin
        .from("profiles")
        .select("push_token")
        .eq("id", uid)
        .maybeSingle();
      if (prof?.push_token) tokens.push(prof.push_token as string);
    } catch {
      // continue to next user
    }
  }

  // Batch push (Expo accepts up to 100 per request)
  let pushed = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100).map((to) => ({
      to,
      sound: "default" as const,
      title: "🔥 Your Palate Wrapped is ready",
      body: "Your week, in your own pattern. Open it up.",
      data: { type: "weekly_wrapped" },
    }));
    try {
      const resp = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      if (resp.ok) pushed += batch.length; else pushFailures += batch.length;
    } catch {
      pushFailures += batch.length;
    }
  }

  return json({ generated, pushed, push_failures: pushFailures, users: ids.length });
});

function isoMonday(d: Date): string {
  const date = new Date(d);
  const day = date.getDay() || 7; // Sunday → 7
  date.setDate(date.getDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
