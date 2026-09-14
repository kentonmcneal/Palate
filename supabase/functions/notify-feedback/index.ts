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
// Called by an after-insert trigger via pg_net, carrying x-cron-secret from
// Vault. Never called by a client.
//
// Handles TWO tables, because they want the same delivery and differ only in
// what the alert says: public.feedback (feedback_id) and
// public.content_reports (report_id). Moderation reports sat behind a
// published 24-hour SLA with no mechanism at all — no trigger, no admin
// screen, no reader but a local script — so a report nobody read looked
// identical to one nobody filed.
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

  let body: { feedback_id?: string; report_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const id = body.feedback_id ?? body.report_id;
  if (!id) return json({ error: "missing feedback_id or report_id" }, 400);
  const isReport = !body.feedback_id && !!body.report_id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (isReport) return await notifyReport(admin, id);

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

/**
 * A moderation report. Deliberately says WHAT was reported and WHY, and never
 * the reporter's identity or the free-text note — the alert lands on a lock
 * screen, and the point is "go and look", not "read the case here".
 */
async function notifyReport(
  admin: ReturnType<typeof createClient>,
  id: string,
): Promise<Response> {
  const { data: row, error } = await admin
    .from("content_reports")
    .select("id, target_type, target_id, reason, status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!row) return json({ skipped: "no such report" });

  if (!ALERT_PUSH_TOKEN) {
    // Say so rather than returning a quiet 200 that reads as success. The row
    // is safely stored either way; only the alert is lost.
    return json({ ok: false, skipped: "ALERT_PUSH_TOKEN not set" });
  }

  const { count } = await admin
    .from("content_reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  const reason = String(row.reason ?? "other");
  const what = String(row.target_type ?? "content");
  const outstanding = count && count > 1 ? `  ·  ${count} open` : "";

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        to: ALERT_PUSH_TOKEN,
        // The clock in the title because the Terms promise 24 hours.
        title: `🚩 Report · ${reason}${outstanding}`,
        body: `A ${what} was reported. Terms promise review within 24 hours.`,
        priority: "high",
        sound: "default",
        data: { type: "content_report", report_id: row.id, target_type: what },
      }),
    });
  } catch (_) {
    return json({ ok: false, skipped: "expo push failed" });
  }
  return json({ ok: true, open: count ?? null });
}
