// Palate — drain the push outbox.
//
// Reads public.push_outbox for rows that are due and unsent, resolves each
// recipient's Expo token, and posts them to Expo's push service in batches.
// Marks each row sent or failed so a push that didn't land is visible rather
// than lost.
//
// Called on a schedule (see migration 0055 — the cron is written but NOT
// scheduled) or manually with the service-role key.
//
// Three things this function will not do:
//   • send while feature_flags.server_push is false — master kill switch
//   • send to a user whose local time is inside quiet hours — send_after
//     already encodes that, and rows are only picked up once it has passed
//   • send more than one proactive push per user per day
//
// Expo's push service is free and unlimited. The cost of this function is
// Supabase invocations, nothing else.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Expo caps a request at 100 messages. */
const EXPO_BATCH = 100;
/** How many rows to drain per invocation. Bounded so one run can't stampede. */
const MAX_PER_RUN = 400;
/** A row that has failed this many times is left alone for a human. */
const MAX_ATTEMPTS = 4;
/** At most one proactive push per user per day, regardless of what queued. */
// Was 1. A single social push per day meant that with two friends who both
// ate out, you heard about one of them and the other arrived tomorrow as
// stale news. Three is still a cap, not a firehose, and it is the number at
// which a beta of fourteen people can actually see each other's activity.
const MAX_PER_USER_PER_DAY = 3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OutboxRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
  /** Broadcast news is perishable; visit confirmations are not (null). */
  expires_at: string | null;
};

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Deployed with --no-verify-jwt so pg_cron can call it with a shared secret
  // (the gateway's JWT check rejected the cron's bearer, which is how the
  // nightly featured-lists job silently 401'd for a day). The secret is the
  // whole gate: without it, anybody holding the anon key could drain the
  // outbox on demand. Fails closed when the secret is unset.
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Master kill switch. Fails CLOSED: a missing row, or any error reading
    // it, means we do not send.
    // Expire perishable rows BEFORE the switch check. With the sweep after
    // it, nothing aged out while server_push was off, and flipping it on
    // would have delivered weeks of "X joined" in one go.
    await admin
      .from("push_outbox")
      .update({ error: "expired", attempts: MAX_ATTEMPTS })
      .is("sent_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .not("expires_at", "is", null)
      .lt("expires_at", new Date().toISOString());

    const { data: flag } = await admin
      .from("feature_flags")
      .select("enabled")
      .eq("key", "server_push")
      .maybeSingle();
    if (!flag?.enabled) {
      return json({ skipped: "server_push disabled", sent: 0 });
    }

    const { data: due, error: dueErr } = await admin
      .from("push_outbox")
      .select("id, user_id, title, body, data, attempts, expires_at")
      .is("sent_at", null)
      .lte("send_after", new Date().toISOString())
      .lt("attempts", MAX_ATTEMPTS)
      .order("send_after", { ascending: true })
      .limit(MAX_PER_RUN);
    if (dueErr) throw dueErr;

    const rows = (due ?? []) as OutboxRow[];
    if (rows.length === 0) return json({ sent: 0, pending: 0 });

    // Drop perishable rows rather than sending stale news. Without this, the
    // one-per-day cap would defer a rate-limited user's broadcasts and they
    // would receive "someone joined" a week late, one per day, forever.
    const now = Date.now();
    const expiredIds = new Set(
      rows
        .filter((r) => r.expires_at !== null && new Date(r.expires_at).getTime() < now)
        .map((r) => r.id),
    );
    if (expiredIds.size) {
      // Retired by exhausting attempts, NOT by setting sent_at. Marking them
      // sent would count against the recipient's one-per-day quota for a push
      // they never received — silently suppressing the next real one.
      await admin
        .from("push_outbox")
        .update({ error: "expired", attempts: MAX_ATTEMPTS })
        .in("id", [...expiredIds]);
    }
    const live = rows.filter((r) => !expiredIds.has(r.id));

    // One proactive push per user per day. Enforced here rather than at
    // enqueue time, because what matters is what a person actually receives,
    // not what we intended to send them.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await admin
      .from("push_outbox")
      .select("user_id")
      .not("sent_at", "is", null)
      .gte("sent_at", since);
    const sentToday = new Map<string, number>();
    for (const r of (recent ?? []) as { user_id: string }[]) {
      sentToday.set(r.user_id, (sentToday.get(r.user_id) ?? 0) + 1);
    }

    const eligible: OutboxRow[] = [];
    const deferred: string[] = [];
    const seenThisRun = new Set<string>();
    for (const r of live) {
      const already = (sentToday.get(r.user_id) ?? 0) + (seenThisRun.has(r.user_id) ? 1 : 0);
      if (already >= MAX_PER_USER_PER_DAY) {
        deferred.push(r.id);
        continue;
      }
      seenThisRun.add(r.user_id);
      eligible.push(r);
    }

    // Push a deferred row into tomorrow rather than dropping it.
    if (deferred.length) {
      await admin
        .from("push_outbox")
        .update({ send_after: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })
        .in("id", deferred);
    }
    if (eligible.length === 0) return json({ sent: 0, deferred: deferred.length });

    // Resolve tokens.
    const userIds = [...new Set(eligible.map((r) => r.user_id))];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, push_token")
      .in("id", userIds);
    const tokenByUser = new Map<string, string>();
    for (const p of (profiles ?? []) as { id: string; push_token: string | null }[]) {
      if (p.push_token) tokenByUser.set(p.id, p.push_token);
    }

    const sendable = eligible.filter((r) => tokenByUser.has(r.user_id));
    const tokenless = eligible.filter((r) => !tokenByUser.has(r.user_id)).map((r) => r.id);
    if (tokenless.length) {
      await admin
        .from("push_outbox")
        .update({ error: "no push token", attempts: MAX_ATTEMPTS })
        .in("id", tokenless);
    }
    if (sendable.length === 0) return json({ sent: 0, tokenless: tokenless.length });

    let sent = 0;
    const failed: { id: string; error: string; attempts: number }[] = [];
    const staleTokens: string[] = [];

    for (let i = 0; i < sendable.length; i += EXPO_BATCH) {
      const slice = sendable.slice(i, i + EXPO_BATCH);
      const messages = slice.map((r) => ({
        to: tokenByUser.get(r.user_id),
        title: r.title,
        body: r.body,
        data: r.data,
        sound: "default",
      }));

      let tickets: { status?: string; message?: string; details?: { error?: string } }[] = [];
      try {
        const resp = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(messages),
        });
        const payload = await resp.json();
        tickets = payload?.data ?? [];
      } catch (e) {
        // Network failure: leave the rows unsent, bump attempts, try next run.
        for (const r of slice) {
          failed.push({ id: r.id, error: String(e), attempts: r.attempts + 1 });
        }
        continue;
      }

      for (let j = 0; j < slice.length; j++) {
        const row = slice[j];
        const ticket = tickets[j];
        if (ticket?.status === "ok") {
          sent++;
          await admin
            .from("push_outbox")
            .update({ sent_at: new Date().toISOString(), error: null })
            .eq("id", row.id);
        } else {
          const err = ticket?.details?.error ?? ticket?.message ?? "unknown";
          failed.push({ id: row.id, error: err, attempts: row.attempts + 1 });
          // The device uninstalled or the token rotated. Clear it so we stop
          // trying, rather than accumulating permanent failures.
          if (err === "DeviceNotRegistered") {
            staleTokens.push(row.user_id);
          }
        }
      }
    }

    for (const f of failed) {
      await admin
        .from("push_outbox")
        .update({ error: f.error, attempts: f.attempts })
        .eq("id", f.id);
    }
    if (staleTokens.length) {
      await admin
        .from("profiles")
        .update({ push_token: null })
        .in("id", [...new Set(staleTokens)]);
    }

    return json({
      sent,
      failed: failed.length,
      deferred: deferred.length,
      expired: expiredIds.size,
      tokenless: tokenless.length,
      cleared_tokens: staleTokens.length,
    });
  } catch (e) {
    console.error("send-push failed", e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
