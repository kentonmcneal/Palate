import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type, card, radius, shadow } from "../theme";
import {
  previewGmailImport, commitGmailImport, describePreview,
  type ImportPreview, type PreviewReceipt,
} from "../lib/gmail";
import { triggerHapticSelection, triggerHapticSuccess } from "../lib/haptics";
import { captureError } from "../lib/observability";

// ============================================================================
// import-review — the app proposes, the person decides.
// ----------------------------------------------------------------------------
// The import used to write visits straight out of the scan, on connect, before
// anyone had seen what it found. That was wrong twice over: a parser mistake
// reached the taste graph silently — and everything the app recommends is
// computed from that graph, so the error would surface later as bad taste
// rather than as a bug — and the Google lookups were spent before the user had
// agreed to anything.
//
// Now: connect, preview (free, no lookups, no writes), review, commit. Only
// ticked rows are written, so the cost is proportional to what someone accepts.
// ============================================================================

export default function ImportReviewScreen() {
  const router = useRouter();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const p = await previewGmailImport(90);
      setPreview(p);
      // Default to everything on: the common case is that the parse is right,
      // and making someone tick twenty boxes to accept their own history is a
      // worse ask than making them untick the one that's wrong.
      setChecked(new Set(p.receipts.map((r) => r.message_id)));
    } catch (e: unknown) {
      void captureError(e, { at: "importReview:preview" });
      setError("Couldn't read your receipts. Check that Gmail is still connected.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggle(id: string) {
    void triggerHapticSelection();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function commit() {
    if (checked.size === 0) return;
    setBusy(true);
    try {
      const res = await commitGmailImport([...checked]);
      void triggerHapticSuccess();
      Alert.alert(
        "Imported",
        `${res.imported} visit${res.imported === 1 ? "" : "s"} added${res.skipped ? `, ${res.skipped} skipped` : ""}.`,
      );
      router.back();
    } catch (e: unknown) {
      void captureError(e, { at: "importReview:commit" });
      Alert.alert("Couldn't import", "Nothing was added. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Your receipts</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {preview === null && !error && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.red} />
            <Text style={[type.small, { marginTop: 10 }]}>Reading the last 90 days…</Text>
          </View>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {preview && (
          <>
            <Text style={styles.lead}>{describePreview(preview)}</Text>
            <Text style={styles.sub}>
              Untick anything that wasn&apos;t you. Only what you keep gets added.
            </Text>

            {preview.receipts.length === 0 && (
              <View style={styles.empty}>
                <Text style={styles.emptyGlyph}>◎</Text>
                <Text style={styles.emptyLine}>
                  Nothing we could read. Reservation and delivery confirmations work best.
                </Text>
              </View>
            )}

            {preview.receipts.map((r) => (
              <Row key={r.message_id} receipt={r} on={checked.has(r.message_id)} onToggle={() => toggle(r.message_id)} />
            ))}

            {preview.receipts.length > 0 && (
              <>
                <Spacer size={20} />
                <Button
                  title={busy ? "Adding…" : `Add ${checked.size} visit${checked.size === 1 ? "" : "s"}`}
                  onPress={commit}
                  loading={busy}
                  disabled={checked.size === 0}
                />
                <Spacer size={10} />
                <Text style={styles.footnote}>
                  Imported visits are marked as such, so they never masquerade as
                  places you were recorded walking into.
                </Text>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ receipt, on, onToggle }: { receipt: PreviewReceipt; on: boolean; onToggle: () => void }) {
  const when = new Date(receipt.visited_at);
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.row, on && styles.rowOn]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={receipt.name}
    >
      <View style={[styles.box, on && styles.boxOn]}>{on && <Text style={styles.check}>✓</Text>}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={2}>{receipt.name}</Text>
        <Text style={styles.meta}>
          {when.toLocaleDateString([], { month: "short", day: "numeric" })} · {sourceLabel(receipt.source)}
        </Text>
      </View>
    </Pressable>
  );
}

function sourceLabel(s: PreviewReceipt["source"]): string {
  return s === "reservation" ? "Reservation" : s === "delivery" ? "Delivery" : "Receipt";
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 20, color: colors.ink },
  body: { padding: spacing.lg, paddingTop: 0 },
  lead: { fontSize: 16, fontWeight: "800", color: colors.ink },
  sub: { ...type.small, marginTop: 4, marginBottom: spacing.md },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  error: { ...type.small, color: colors.redText },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: 8 },
  emptyGlyph: { fontSize: 22, color: colors.line },
  emptyLine: { ...type.small, textAlign: "center", maxWidth: 280, lineHeight: 19 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: card.padding, borderRadius: card.radius,
    backgroundColor: colors.faint, marginBottom: 8, ...shadow.card,
  },
  rowOn: {},
  box: {
    width: 24, height: 24, borderRadius: 7,
    borderWidth: 2, borderColor: colors.line,
    alignItems: "center", justifyContent: "center", backgroundColor: "#fff",
  },
  boxOn: { backgroundColor: colors.red, borderColor: colors.red },
  check: { color: "#fff", fontSize: 14, fontWeight: "900" },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { ...type.small, marginTop: 2 },
  footnote: { ...type.small, textAlign: "center", lineHeight: 18 },
});
