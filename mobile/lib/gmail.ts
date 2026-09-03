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

import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

// Read-only Gmail scope — minimum needed to scan for receipts.
export const GMAIL_SCOPES = [
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
/**
 * Exchange an authorization code for tokens, server-side.
 *
 * The AUTHORIZATION half deliberately does not live here any more. Two
 * hand-built redirect URIs were rejected by Google with
 * "Error 400: invalid_request" — first a plain app scheme, then the reversed
 * client id with the wrong number of slashes. Meanwhile Google sign-in has
 * worked all along using expo's Google provider, which knows Google's iOS
 * redirect convention and never exposes it.
 *
 * So the prompt is now raised by that same provider (see GmailImportCard) and
 * this function only handles the exchange. Whatever redirect the provider used
 * is passed through, because the token endpoint requires the identical value.
 */
export async function exchangeGmailCode(
  code: string,
  codeVerifier: string | undefined,
  redirectUri: string,
): Promise<ConnectResult> {
  const { data, error } = await supabase.functions.invoke("gmail-import", {
    body: {
      action: "connect",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data as any) };
}

/** Manually trigger a scan (e.g. user pulled to refresh in Settings). */
/**
 * DIRECT scan — parses AND writes AND pays for lookups in one step, with no
 * review. No longer reachable from the UI: the flow is preview -> review ->
 * commit, so a parser mistake cannot reach the taste graph unseen. Kept only
 * because the scheduled scan_all path shares the same server handler; do not
 * wire a button to this.
 */
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

// ----------------------------------------------------------------------------
// Preview — what an import WOULD do
// ----------------------------------------------------------------------------
// Email import is the only path in the product with a real per-user marginal
// cost. This is how that cost gets priced without being incurred: the same
// Gmail query, the same parser, resolved against our own restaurants table, and
// then it stops. No Google calls, no writes.

export type PreviewReceipt = {
  message_id: string;
  name: string;
  visited_at: string;
  source: "reservation" | "delivery" | "pos";
};

export type ImportPreview = {
  since_days: number;
  messages_matched: number;
  already_imported: number;
  receipts_parsed: number;
  unparseable: number;
  unique_restaurants: number;
  resolved_locally: number;
  /** The number that decides whether an import is worth running. */
  would_cost_lookups: number;
  unresolved_names: string[];
  receipts: PreviewReceipt[];
};

export async function previewGmailImport(sinceDays = 90): Promise<ImportPreview> {
  const { data, error } = await supabase.functions.invoke("gmail-import", {
    body: { action: "preview", since_days: sinceDays },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as ImportPreview;
}

/** One line a person can act on, from the preview numbers. */
export function describePreview(p: ImportPreview): string {
  if (p.receipts_parsed === 0) {
    return `No readable receipts in the last ${p.since_days} days.`;
  }
  const places = p.unique_restaurants === 1 ? "1 restaurant" : `${p.unique_restaurants} restaurants`;
  return `Found ${p.receipts_parsed} receipts across ${places}.`;
}

/**
 * Write only the receipts the person confirmed.
 *
 * Cost is proportional to what they accept, not to what we parsed — someone who
 * ticks three of twenty pays for three lookups. The server re-parses each
 * message rather than trusting the name sent back; a client is not a source of
 * truth about what an email said.
 */
export async function commitGmailImport(messageIds: string[]): Promise<{ imported: number; skipped: number }> {
  const { data, error } = await supabase.functions.invoke("gmail-import", {
    body: { action: "commit", message_ids: messageIds },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as { imported: number; skipped: number };
}
