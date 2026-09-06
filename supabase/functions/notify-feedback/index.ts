// ============================================================================
// notify-feedback — tell the founder a tester filed something.
// ----------------------------------------------------------------------------
// lib/feedback.ts writes a real row and a screenshot to a private bucket, and
// then the report sits in a table somebody has to remember to query. Bug
// reports that nobody reads are worse than no bug reports, because the tester
// believes they were heard.
//
// Delivery is the same Expo push places-proxy already uses for budget alerts,
// to the same ALERT_PUSH_TOKEN — the founder's own device. That matters for
// two reasons: no new credential and no new service, and it is INDEPENDENT of
// feature_flags.server_push, which gates user-facing notifications and is
// deliberately off. An operational alert to one device is not a product push.
//
// Called by an after-insert trigger on public.feedback via pg_net, carrying
// x-cron-secret from Vault. Never called by a client.
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALERT_PUSH_TOKEN = Deno.env.get("ALERT_PUSH_TOKEN") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Only the trigger may call this. Without the check, any signed-in account
  // could spam the founder's lock screen.
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { feedback_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const id = body.feedback_id;
  if (!id) return json({ error: "missing feedback_id" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: row, error } = await admin
    .from("feedback")
    .select("id, category, message, app_version, platform, device, screenshot_path, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!row) return json({ skipped: "no such row" });

  if (!ALERT_PUSH_TOKEN) {
    // Say so rather than returning a quiet 200 that reads as success. The row
    // is safely stored either way; only the alert is lost.
    return json({ ok: false, skipped: "ALERT_PUSH_TOKEN not set" });
  }

  // How many are still untriaged, so the founder knows whether this is the
  // first one or the ninth without opening anything.
  const { count } = await admin
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");

  const kind = String(row.category ?? "other");
  const title = kind === "bug" ? "🐞 Bug report" : kind === "idea" ? "💡 Idea" : "Feedback";
  const outstanding = count && count > 1 ? `  ·  ${count} unread` : "";
  const message = String(row.message ?? "").replace(/\s+/g, " ").trim();
  const excerpt = message.length > 140 ? message.slice(0, 139) + "…" : message;

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        to: ALERT_PUSH_TOKEN,
        title: `${title}${outstanding}`,
        body: excerpt || "(no message)",
        subtitle: [row.platform, row.device, row.app_version].filter(Boolean).join(" · ") || undefined,
        priority: "high",
        sound: "default",
        data: { type: "feedback", feedback_id: row.id, has_screenshot: !!row.screenshot_path },
      }),
    });
  } catch (_) {
    return json({ ok: false, skipped: "expo push failed" });
  }

  return json({ ok: true, unread: count ?? null });
});
