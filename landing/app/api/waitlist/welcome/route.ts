// ============================================================================
// /api/waitlist/welcome — server-side welcome email send.
// ----------------------------------------------------------------------------
// Called fire-and-forget by joinWaitlist() after a successful insert.
// Returns 202 immediately whether the email actually goes out — analytics
// and sender-side errors live in server logs, never the client.
// ============================================================================

import { NextResponse } from "next/server";
import { sendEmail, welcomeEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      referralCode?: string;
      position?: number;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
    }

    void sendEmail(
      welcomeEmail({
        email,
        referralCode: body.referralCode,
        position: body.position,
      }),
    );

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    console.warn("[welcome] route failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
