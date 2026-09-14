// ============================================================================
// ForwardReceiptsCard — the import path that shows nobody a security warning.
// ----------------------------------------------------------------------------
// Stands where "Connect Gmail" used to. That button asked for gmail.readonly, a
// RESTRICTED Google scope, so every person who tapped it met a full-page
// "Google hasn't verified this app / BACK TO SAFETY" screen — see
// lib/gmail-gate.ts. Forwarding needs no Google review at all, and works for
// people who are not on Gmail, which the old path never did.
//
// The address is the whole product here, so it is the largest thing on the
// card and it is selectable as well as copyable: the copy button silently
// fails on some devices, and an address you cannot select is an address you
// cannot use.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator, Alert, Share } from "react-native";
import { useFocusEffect } from "expo-router";
import { Text } from "./Text";
import { colors, spacing, type, radius } from "../theme";
import { FONT_CAP } from "../lib/a11y";
import { triggerHapticSuccess, triggerHapticSelection } from "../lib/haptics";
import {
  forwardingAddress, pendingReceipts, acceptReceipt, rejectReceipt,
  FORWARDING_LIVE, type PendingReceipt,
} from "../lib/receipt-forwarding";

export function ForwardReceiptsCard() {
  // Nothing is listening at the domain yet — see FORWARDING_LIVE. Showing the
  // address now would hand people a bounce.
  if (!FORWARDING_LIVE) return null;
  return <ForwardReceiptsCardBody />;
}

function ForwardReceiptsCardBody() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReceipt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [addr, rows] = await Promise.all([
        forwardingAddress(),
        pendingReceipts().catch(() => [] as PendingReceipt[]),
      ]);
      setAddress(addr);
      setPending(rows);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load your forwarding address.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Mail arrives while the app is closed. Coming back to a stale list is the
  // difference between "it works" and "nothing happened".
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Share, not a clipboard call. expo-clipboard is a native module and adding
  // one costs a full rebuild, which would strand this behind a store release
  // instead of shipping over the air. The iOS share sheet offers Copy anyway,
  // plus Mail — and mailing yourself the address is how you get it onto the
  // desktop where the Gmail filter actually gets made.
  async function copy() {
    if (!address) return;
    void triggerHapticSuccess();
    try { await Share.share({ message: address }); } catch (_) { /* dismissed */ }
  }

  async function accept(r: PendingReceipt) {
    setBusy(r.id);
    try {
      const res = await acceptReceipt(r);
      if (res.ok) {
        void triggerHapticSuccess();
        setPending((c) => c.filter((x) => x.id !== r.id));
      } else {
        // Deliberately not resolved for them: turning a name into a place is a
        // paid Google lookup, and spending on somebody's behalf without them
        // asking is not this card's call.
        Alert.alert(
          r.restaurantName,
          "We don't have this one on file yet. Add it from Search and it'll match next time.",
        );
      }
    } catch (e: any) {
      Alert.alert("Couldn't add it", e?.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function reject(r: PendingReceipt) {
    setBusy(r.id);
    try {
      await rejectReceipt(r.id);
      void triggerHapticSelection();
      setPending((c) => c.filter((x) => x.id !== r.id));
    } catch (e: any) {
      Alert.alert("Couldn't dismiss", e?.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title} maxFontSizeMultiplier={FONT_CAP.chrome}>
        Forward your receipts
      </Text>
      <Text style={styles.body}>
        Send any reservation or delivery confirmation to your private address and
        it becomes a visit you can confirm. One Gmail filter and it happens on
        its own.
      </Text>

      {error ? (
        <Pressable onPress={() => void load()} style={styles.retry}>
          <Text style={styles.retryText}>{error} Tap to retry.</Text>
        </Pressable>
      ) : !address ? (
        <View style={styles.loading}><ActivityIndicator color={colors.mute} /></View>
      ) : (
        <>
          <View style={styles.addressBox}>
            <Text style={styles.address} selectable>{address}</Text>
          </View>
          <Pressable onPress={copy} style={styles.copy} accessibilityRole="button">
            <Text style={styles.copyText}>Send me this address</Text>
          </Pressable>
          <Text style={styles.hint}>
            To do it automatically: Gmail → Settings → Filters → Create a filter →
            From: opentable.com OR resy.com OR doordash.com → Forward to this
            address.
          </Text>
        </>
      )}

      {pending.length > 0 && (
        <View style={styles.pending}>
          <Text style={styles.pendingHead} maxFontSizeMultiplier={FONT_CAP.eyebrow}>
            {pending.length} WAITING
          </Text>
          {pending.map((r) => (
            <View key={r.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{r.restaurantName}</Text>
                <Text style={styles.meta}>
                  {new Date(r.visitedAt).toLocaleDateString()}
                  {r.senderDomain ? ` · ${r.senderDomain}` : ""}
                </Text>
              </View>
              <Pressable
                onPress={() => void reject(r)}
                disabled={busy === r.id}
                style={styles.no}
                accessibilityLabel={`Dismiss ${r.restaurantName}`}
              >
                <Text style={styles.noText}>Not me</Text>
              </Pressable>
              <Pressable
                onPress={() => void accept(r)}
                disabled={busy === r.id}
                style={[styles.yes, busy === r.id && { opacity: 0.5 }]}
                accessibilityLabel={`Add ${r.restaurantName}`}
              >
                <Text style={styles.yesText}>Add</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.faint, borderRadius: radius.md,
    padding: spacing.lg, gap: 10,
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink },
  body: { fontSize: 14, color: colors.mute, lineHeight: 20 },
  loading: { paddingVertical: 16, alignItems: "center" },
  retry: { paddingVertical: 12 },
  retryText: { fontSize: 13, color: colors.redText, fontWeight: "600" },
  addressBox: {
    backgroundColor: colors.wash, borderRadius: radius.md,
    paddingVertical: 12, paddingHorizontal: 14, marginTop: 4,
  },
  address: { fontSize: 15, fontWeight: "700", color: colors.ink },
  copy: {
    alignSelf: "flex-start", backgroundColor: colors.primaryFill,
    paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999,
  },
  copyText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  hint: { fontSize: 12, color: colors.mute, lineHeight: 18 },
  pending: { marginTop: 14, gap: 10 },
  pendingHead: { fontSize: 11, fontWeight: "800", color: colors.mute, letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 15, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 12, color: colors.mute, marginTop: 2 },
  no: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.wash },
  noText: { fontSize: 13, fontWeight: "600", color: colors.mute },
  yes: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.primaryFill },
  yesText: { fontSize: 13, fontWeight: "700", color: "#fff" },
});
