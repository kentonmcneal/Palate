// ============================================================================
// email.ts — single integration point for transactional email.
// ----------------------------------------------------------------------------
// Defaults to Resend (https://resend.com — generous free tier, clean SDK).
// If RESEND_API_KEY is unset, sendEmail() logs a warning and no-ops so the
// rest of the app keeps working in dev / preview environments without keys.
// ============================================================================

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
};

export async function sendEmail(msg: EmailMessage): Promise<{ ok: true } | { ok: false; reason: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping send to", msg.to);
    return { ok: false, reason: "no_key" };
  }

  const from = msg.from ?? process.env.EMAIL_FROM ?? "Palate <hello@palate.app>";

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.warn("[email] Resend rejected:", resp.status, text);
      return { ok: false, reason: `http_${resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[email] send failed:", err);
    return { ok: false, reason: "exception" };
  }
}

// ============================================================================
// Welcome email — sent on waitlist signup.
// ============================================================================

export function welcomeEmail(opts: {
  email: string;
  position?: number;
  referralCode?: string;
}): EmailMessage {
  const positionLine = opts.position
    ? `Your spot in line: <strong>#${opts.position}</strong>.`
    : "You're on the list.";

  const referralLine = opts.referralCode
    ? `Want to skip 50 spots? Share this link with friends:<br><a href="https://palate.app/?ref=${opts.referralCode}">https://palate.app/?ref=${opts.referralCode}</a>`
    : "";

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;background:#fafafa;margin:0;padding:0;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:40px 32px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:36px;height:36px;border-radius:10px;background:#FF3008;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;">p</div>
      <span style="font-size:18px;font-weight:600;letter-spacing:-0.5px;">palate</span>
    </div>

    <h1 style="margin:32px 0 0 0;font-size:28px;line-height:1.2;letter-spacing:-1px;color:#111;">You're in.</h1>
    <p style="margin:16px 0 0 0;color:#444;line-height:1.6;">Thanks for joining the Palate waitlist — we'll email you when iOS testing opens up. ${positionLine}</p>

    <div style="margin:32px 0;padding:20px;background:#f6f6f6;border-radius:14px;color:#444;line-height:1.6;font-size:15px;">
      <strong style="color:#111;">What to expect:</strong><br>
      One email when TestFlight is ready. <em>That's the only email you'll get.</em> No newsletter, no upsells.
    </div>

    ${referralLine ? `<p style="margin:24px 0 0 0;color:#444;line-height:1.6;">${referralLine}</p>` : ""}

    <p style="margin:32px 0 0 0;color:#999;font-size:13px;line-height:1.5;">
      Curious what your Palate looks like? <a href="https://palate.app/#quiz" style="color:#FF3008;text-decoration:none;">Take the 30-second quiz</a> — no signup needed.
    </p>

    <p style="margin:48px 0 0 0;color:#bbb;font-size:12px;line-height:1.5;">
      Palate · A weekly Wrapped of your real eating life.<br>
      Reply to this email if you have questions or want to chat.
    </p>
  </div>
</body></html>`;

  const text = `You're in.

Thanks for joining the Palate waitlist — we'll email you when iOS testing opens up. ${opts.position ? `Your spot in line: #${opts.position}.` : "You're on the list."}

What to expect:
One email when TestFlight is ready. That's the only email you'll get. No newsletter, no upsells.

${opts.referralCode ? `Want to skip 50 spots? Share this link: https://palate.app/?ref=${opts.referralCode}\n\n` : ""}Curious what your Palate looks like? Take the 30-second quiz at https://palate.app/#quiz — no signup needed.

— Palate
A weekly Wrapped of your real eating life.`;

  return {
    to: opts.email,
    subject: "You're on the Palate waitlist 🌶️",
    html,
    text,
  };
}
