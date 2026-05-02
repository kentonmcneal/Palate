import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { colors, spacing, type } from "../theme";
import { Spacer } from "./Button";
import {
  getGmailStatus, connectGmail, rescanGmail, disconnectGmail,
  type GmailStatus,
} from "../lib/gmail";
import { triggerHapticSuccess } from "../lib/haptics";

// ============================================================================
// GmailImportCard — Settings card for connecting + managing Gmail import.
// Shows: connection status, connected email, last scan time, imported count,
// + Connect / Rescan / Disconnect actions.
// ============================================================================

export function GmailImportCard() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    try { setStatus(await getGmailStatus()); } catch { /* ignore */ }
  }

  async function handleConnect() {
    setBusy(true);
    try {
      const r = await connectGmail();
      if (!r.ok) {
        if (r.error !== "cancelled") {
          Alert.alert("Couldn't connect", r.error ?? "Try again");
        }
      } else {
        void triggerHapticSuccess();
        Alert.alert(
          "Gmail connected",
          `Imported ${r.imported ?? 0} visit${r.imported === 1 ? "" : "s"} from your inbox.`,
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleRescan() {
    setBusy(true);
    try {
      const r = await rescanGmail(30);
      if (!r.ok) {
        Alert.alert("Couldn't refresh", r.error ?? "Try again");
      } else {
        void triggerHapticSuccess();
        Alert.alert(
          "Refreshed",
          r.imported && r.imported > 0
            ? `Found ${r.imported} new visit${r.imported === 1 ? "" : "s"} from the last 30 days.`
            : "No new visits found.",
        );
      }
      await load();
    } finally { setBusy(false); }
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
          Pulls in your reservations and delivery orders from the last 90 days
          (OpenTable, Resy, DoorDash, Uber Eats, and 6 more) and turns them
          into Palate visits. Read-only access. Disconnect anytime.
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
        <Pressable onPress={handleRescan} disabled={busy} style={[styles.btnPrimary, busy && { opacity: 0.6 }]}>
          <Text style={styles.btnPrimaryText}>{busy ? "Scanning…" : "Refresh"}</Text>
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
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  eyebrow: { ...type.micro, color: colors.red },
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
