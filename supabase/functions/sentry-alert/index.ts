// ============================================================================
// sentry-alert — a crash reaches a phone, not a dashboard nobody has open.
// ----------------------------------------------------------------------------
// Sentry has received every crash for weeks and told nobody. A crash at 8pm on
// a Friday should buzz, because the fix is usually an OTA and an OTA is ten
// minutes; a crash discovered on Monday has already cost a weekend of installs.
//
// Sentry's own alert rules can email, and email is what a person stops reading
// after the third one. This pushes to the same device that already gets the
// Google-budget and feedback alerts, so operational noise arrives in one place
// and in one voice.
//
// Auth is a shared secret in the path, because Sentry's legacy webhooks do not
// sign their payloads. The secret is the whole of the authentication, so it
// must be long and it must not be the cron secret reused.
//
// It always answers 200. A webhook receiver that returns errors gets disabled
// by the sender, and a disabled alerting path is worse than a noisy one.
// ============================================================================

const ALERT_PUSH_TOKEN = Deno.env.get("ALERT_PUSH_TOKEN") ?? "";
const SENTRY_WEBHOOK_SECRET = Deno.env.get("SENTRY_WEBHOOK_SECRET") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Sentry sends several shapes. Take the first thing that reads like a title. */
function describe(payload: Record<string, unknown>): { title: string; body: string; url?: string } {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const issue = (data.issue ?? payload.issue ?? {}) as Record<string, unknown>;
  const event = (data.event ?? payload.event ?? {}) as Record<string, unknown>;

  const title =
    (typeof issue.title === "string" && issue.title) ||
    (typeof event.title === "string" && event.title) ||
    (typeof payload.message === "string" && payload.message) ||
    "Sentry alert";

  const culprit =
    (typeof issue.culprit === "string" && issue.culprit) ||
    (typeof event.culprit === "string" && event.culprit) ||
    (typeof event.culprit === "string" && event.culprit) || "";

  const level =
    (typeof event.level === "string" && event.level) ||
    (typeof issue.level === "string" && issue.level) || "";

  const count = typeof issue.count === "string" || typeof issue.count === "number"
    ? String(issue.count) : "";

  const url =
    (typeof payload.url === "string" && payload.url) ||
    (typeof issue.permalink === "string" && issue.permalink) ||
    (typeof event.web_url === "string" && event.web_url) || undefined;

  const bits = [culprit, count ? `seen ${count}×` : "", level].filter(Boolean);
  return { title: String(title).slice(0, 120), body: bits.join(" · ") || "Open Sentry for detail", url };
}

Deno.serve(async (req) => {
  // The secret lives in the path: .../sentry-alert/<secret>. Fails closed when
  // unset, so a misconfigured deploy cannot become an open push endpoint.
  const secret = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  if (!SENTRY_WEBHOOK_SECRET || secret !== SENTRY_WEBHOOK_SECRET) {
    return json({ ok: false, skipped: "unauthorized" });
  }
  if (!ALERT_PUSH_TOKEN) {
    return json({ ok: false, skipped: "ALERT_PUSH_TOKEN not set" });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json() as Record<string, unknown>;
  } catch {
    // A body we cannot parse is still worth a buzz: something fired.
  }

  const { title, body, url } = describe(payload);

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        to: ALERT_PUSH_TOKEN,
        title: `💥 ${title}`,
        body,
        priority: "high",
        sound: "default",
        data: { type: "sentry", url },
      }),
    });
  } catch (_) {
    // Never surface a failure to Sentry; it disables endpoints that error.
    return json({ ok: false, skipped: "expo push failed" });
  }

  return json({ ok: true });
});
