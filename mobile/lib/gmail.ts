// ============================================================================
// gmail.ts — Gmail OAuth flow + import status helpers.
// ----------------------------------------------------------------------------
// Flow:
//   1. User taps "Connect Gmail" in Settings
//   2. We open Google's OAuth consent in the system browser
//   3. Google redirects back to our deep link with ?code=...
//   4. We POST that code to the gmail-import edge function (action=connect)
//   5. The edge function exchanges code → tokens, stores them server-side,
//      and runs an initial 90-day scan
//
// The refresh_token never touches the device. The mobile app only ever sees
// the user-facing import status (count + last scanned timestamp).
// ============================================================================

import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

// Read-only Gmail scope — minimum needed to scan for receipts.
const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

// Set this to your iOS OAuth client ID from Google Cloud Console.
// (See gmail-google-cloud-setup.md)
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

export type GmailStatus = {
  connected: boolean;
  email: string | null;
  last_scanned_at: string | null;
  imported_count: number;
};

export async function getGmailStatus(): Promise<GmailStatus> {
  const { data, error } = await supabase.rpc("gmail_connection_status");
  if (error || !data) {
    return { connected: false, email: null, last_scanned_at: null, imported_count: 0 };
  }
  const row = (data as any[])[0] ?? {};
  return {
    connected: !!row.connected,
    email: row.email ?? null,
    last_scanned_at: row.last_scanned_at ?? null,
    imported_count: row.imported_count ?? 0,
  };
}

export type ConnectResult = {
  ok: boolean;
  imported?: number;
  skipped?: number;
  total_found?: number;
  email?: string;
  error?: string;
};

/**
 * Run the full Gmail connect flow. Opens the OAuth consent in the system
 * browser, captures the redirect, exchanges the code server-side, and
 * triggers an initial 90-day scan.
 */
export async function connectGmail(): Promise<ConnectResult> {
  if (!GOOGLE_IOS_CLIENT_ID) {
    return { ok: false, error: "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID not configured" };
  }

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "palate",
    path: "auth/google",
  });

  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_IOS_CLIENT_ID,
    scopes: GMAIL_SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: "offline",   // required to get refresh_token
      prompt: "consent",        // force consent screen so we always get refresh_token
    },
  });

  await request.makeAuthUrlAsync(GOOGLE_DISCOVERY);
  const result = await request.promptAsync(GOOGLE_DISCOVERY);

  if (result.type !== "success") {
    return { ok: false, error: result.type === "cancel" ? "cancelled" : "auth_failed" };
  }

  const code = result.params.code;
  if (!code) return { ok: false, error: "no_code" };

  const { data, error } = await supabase.functions.invoke("gmail-import", {
    body: {
      action: "connect",
      code,
      redirect_uri: redirectUri,
      code_verifier: request.codeVerifier,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data as any) };
}

/** Manually trigger a scan (e.g. user pulled to refresh in Settings). */
export async function rescanGmail(sinceDays = 30): Promise<ConnectResult> {
  const { data, error } = await supabase.functions.invoke("gmail-import", {
    body: { action: "scan", since_days: sinceDays },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data as any) };
}

export async function disconnectGmail(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("gmail-import", {
    body: { action: "disconnect" },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
