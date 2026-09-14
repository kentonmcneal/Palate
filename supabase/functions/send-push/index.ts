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

// Per-class daily ceilings and the admission rules live in _shared/push-quota
// so they can be tested. See that file for why announcements are rationed
// separately from the ambient feed — production evidence, not taste.
import {
  admit,
  classOf,
  type PushClass,
  type QuotaRow,
} from "../_shared/push-quota.ts";
import { errText } from "../_shared/err-text.ts";
import { retryRead } from "../_shared/retry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Expo caps a request at 100 messages. */
const EXPO_BATCH = 100;
/** How many rows to drain per invocation. Bounded so one run can't stampede. */
const MAX_PER_RUN = 400;
/** A row that has failed this many times is left alone for a human. */
const MAX_ATTEMPTS = 4;
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
    // .update() RESOLVES with { error }; it does not throw. Discarding that
    // error means a sweep that never ran looks identical to one that did.
    const { error: sweepErr } = await admin
      .from("push_outbox")
      .update({ error: "expired", attempts: MAX_ATTEMPTS })
      .is("sent_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .not("expires_at", "is", null)
      .lt("expires_at", new Date().toISOString());
    if (sweepErr) console.error("send-push: expiry sweep failed", sweepErr);

    // Still fails CLOSED, but says WHICH closed state it is. The error was
    // being discarded here, so a failed read produced flag === null and the
    // function reported "server_push disabled" — with the flag demonstrably
    // enabled in the database. Twenty-seven runs in six hours said the switch
    // was off while it was on, and nothing anywhere contradicted them.
    const { data: flag, error: flagErr } = await retryRead(() =>
      admin.from("feature_flags").select("enabled").eq("key", "server_push").maybeSingle()
    );
    if (flagErr) {
      console.error("send-push: cannot read server_push flag", flagErr);
      return json({ error: "server_push unreadable", detail: errText(flagErr) }, 500);
    }
    if (!flag) {
      return json({ error: "server_push flag missing", sent: 0 }, 500);
    }
    if (!flag.enabled) {
      return json({ skipped: "server_push disabled", sent: 0 });
    }

    const { data: due, error: dueErr } = await retryRead(() =>
      admin
        .from("push_outbox")
        .select("id, user_id, title, body, data, attempts, expires_at")
        .is("sent_at", null)
        .lte("send_after", new Date().toISOString())
        .lt("attempts", MAX_ATTEMPTS)
        .order("send_after", { ascending: true })
        .limit(MAX_PER_RUN)
    );
    if (dueErr) return json({ error: "due query failed", detail: errText(dueErr) }, 500);

    const rows = due ?? [];
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
    // Guarded: on a failed read every count is zero, so every ceiling silently
    // stops applying and a rate-limited user gets the firehose the caps exist
    // to prevent. Abort and retry next tick rather than over-send.
    const { data: recent, error: recentErr } = await retryRead(() =>
      admin
        .from("push_outbox")
        .select("user_id, data")
        .not("sent_at", "is", null)
        .gte("sent_at", since)
    );
    if (recentErr) return json({ error: "quota tally failed", detail: errText(recentErr) }, 500);
    // Counted in separate buckets per class. One shared counter would mean a
    // busy day of correspondence silently suppressing the ambient feed, and a
    // burst of signups suppressing both — each class starving the others for
    // reasons that have nothing to do with the other.
    const sentByClass: Record<PushClass, Map<string, number>> = {
      direct: new Map(),
      announce: new Map(),
      ambient: new Map(),
    };
    for (const r of recent ?? []) {
      const m = sentByClass[classOf(r)];
      m.set(r.user_id, (m.get(r.user_id) ?? 0) + 1);
    }

    const verdict = admit(live as QuotaRow[], sentByClass, Date.now());
    const eligible = verdict.admit as OutboxRow[];
    const deferred = verdict.defer;
    const expireNow = verdict.expire;

    if (deferred.length) {
      await admin
        .from("push_outbox")
        .update({ send_after: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })
        .in("id", deferred);
    }
    if (expireNow.length) {
      await admin.from("push_outbox").update({ error: "expired", attempts: MAX_ATTEMPTS }).in("id", expireNow);
    }
    if (eligible.length === 0) return json({ sent: 0, deferred: deferred.length });

    // Resolve tokens.
    const userIds = [...new Set(eligible.map((r) => r.user_id))];
    // Guarded, because the failure mode here DESTROYS DATA rather than merely
    // logging badly: a failed read yields profiles === null, every row then
    // looks tokenless, and the tokenless branch retires them permanently with
    // attempts = MAX_ATTEMPTS and error "no push token". Real pushes to people
    // who do have a token would be thrown away, and the outbox would record a
    // confident, wrong reason. Better to abort the run and retry next tick.
    const { data: profiles, error: profErr } = await retryRead(
      () => admin.from("profiles").select("id, push_token").in("id", userIds)
    );
    if (profErr) return json({ error: "profile read failed", detail: errText(profErr) }, 500);
    const tokenByUser = new Map<string, string>();
    for (const p of profiles ?? []) {
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
          failed.push({ id: r.id, error: errText(e), attempts: r.attempts + 1 });
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
    return json({ error: "unhandled", detail: errText(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
