import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { colors, spacing, type, card } from "../theme";
import { Spacer } from "./Button";
import * as Google from "expo-auth-session/providers/google";
import {
  getGmailStatus, exchangeGmailCode, disconnectGmail, GMAIL_SCOPES,
  type GmailStatus,
} from "../lib/gmail";
import { triggerHapticSuccess } from "../lib/haptics";
import { useRouter } from "expo-router";

// ============================================================================
// GmailImportCard — Settings card for connecting + managing Gmail import.
// Shows: connection status, connected email, last scan time, imported count,
// + Connect / Rescan / Disconnect actions.
// ============================================================================

export function GmailImportCard() {
  const router = useRouter();
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    try { setStatus(await getGmailStatus()); } catch { /* ignore */ }
  }

  // Authorization goes through expo's Google provider rather than a
  // hand-built request. Two hand-rolled redirect URIs were rejected by Google
  // with "Error 400: invalid_request" — a plain app scheme, then the reversed
  // client id with the wrong slash count. Google SIGN-IN has worked the whole
  // time using this provider, which knows Google's iOS redirect convention and
  // never exposes it. Copying what works beats reasoning about URI shapes.
  const [gRequest, gResponse, gPromptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    scopes: GMAIL_SCOPES,
    // Needed for a refresh token, so scans keep working after the access token
    // expires without asking the user again.
    extraParams: { access_type: "offline", prompt: "consent" },
  });

  useEffect(() => {
    if (!gResponse) return;
    if (gResponse.type !== "success") {
      setBusy(false);
      if (gResponse.type === "error") {
        Alert.alert("Couldn't connect", "Google declined the request. Please try again.");
      }
      return;
    }
    void (async () => {
      try {
        const code = gResponse.params.code;
        // The token endpoint requires the IDENTICAL redirect the provider used,
        // so it is read back off the request rather than reconstructed.
        const redirectUri = (gRequest as { redirectUri?: string } | null)?.redirectUri ?? "";
        if (!code || !redirectUri) {
          Alert.alert("Couldn't connect", "Google didn't return an authorization code.");
          return;
        }
        const r = await exchangeGmailCode(code, gRequest?.codeVerifier, redirectUri);
        if (!r.ok) {
          Alert.alert("Couldn't connect", r.error ?? "Try again");
          return;
        }
        void triggerHapticSuccess();
        await load();
        router.push("/import-review");
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gResponse]);

  async function handleConnect() {
    if (!gRequest) return; // provider still building the request
    setBusy(true);
    const result = await gPromptAsync();
    // Cancel and dismiss resolve rather than throwing, so clear the spinner
    // here for every non-success outcome — the effect only runs on success.
    if (result.type !== "success") setBusy(false);
  }


  function reviewReceipts() {
    router.push("/import-review");
  }

  function handleDisconnect() {
    Alert.alert(
      "Disconnect Gmail?",
      "Your already-imported visits will stay. We just stop scanning.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect", style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              const r = await disconnectGmail();
              if (!r.ok) Alert.alert("Couldn't disconnect", r.error ?? "Try again");
              await load();
            } finally { setBusy(false); }
          },
        },
      ],
    );
  }

  if (!status) return null;

  if (!status.connected) {
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>BRING IN YOUR HISTORY</Text>
        <Text style={styles.title}>Connect Gmail</Text>
        <Text style={styles.body}>
          Palate can turn recent reservations and delivery orders into visits.
          Read-only access. Disconnect anytime.
        </Text>
        <Pressable
          onPress={handleConnect}
          disabled={busy}
          style={[styles.btnPrimary, busy && { opacity: 0.6 }]}
        >
          <Text style={styles.btnPrimaryText}>{busy ? "Connecting…" : "Connect Gmail"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>GMAIL CONNECTED</Text>
      <Text style={styles.title}>{status.email ?? "Connected"}</Text>
      <Text style={styles.body}>
        {status.imported_count} visit{status.imported_count === 1 ? "" : "s"} imported.
        {status.last_scanned_at
          ? ` Last scan ${new Date(status.last_scanned_at).toLocaleDateString()}.`
          : ""}
      </Text>
      <View style={styles.actions}>
        {/* "Refresh" went straight to a scan that wrote visits and spent a
            lookup each. It now opens the review, which previews for free. */}
        <Pressable onPress={reviewReceipts} disabled={busy} style={[styles.btnPrimary, busy && { opacity: 0.6 }]}>
          <Text style={styles.btnPrimaryText}>Review receipts</Text>
        </Pressable>
        <Pressable onPress={handleDisconnect} disabled={busy} style={styles.btnGhost}>
          <Text style={styles.btnGhostText}>Disconnect</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: card.radius,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  eyebrow: { ...type.micro, color: colors.mute },
  title: { fontSize: 18, fontWeight: "800", color: colors.ink, letterSpacing: -0.3, marginTop: 6 },
  body: { fontSize: 13, color: colors.ink, lineHeight: 19, marginTop: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  btnPrimary: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
    backgroundColor: colors.red,
  },
  btnPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  btnGhost: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  btnGhostText: { color: colors.mute, fontSize: 13, fontWeight: "700" },
});
