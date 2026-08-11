import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Button } from "../components/Button";
import { isVisitMonitorAvailable } from "../modules/palate-visit-monitor";
import {
  PASSIVE_CAPTURE_FLAG,
  authorizationStatus,
  drainNativeVisits,
  clearQueuedVisits,
  startPassiveCaptureIfEnabled,
  stopPassiveCapture,
  simulateVisit,
  type RawVisit,
} from "../lib/passive-capture";
import { isFlagEnabled } from "../lib/flags";

// A plausible Atlanta coordinate for injected test visits (downtown).
const TEST_LAT = 33.749;
const TEST_LNG = -84.388;

function fmt(ms: number | null): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  return d.toLocaleString();
}

export default function DebugVisitsScreen() {
  const router = useRouter();
  const [visits, setVisits] = useState<RawVisit[]>([]);
  const [auth, setAuth] = useState<string>("…");
  const [flagOn, setFlagOn] = useState<boolean | null>(null);
  const [monitoring, setMonitoring] = useState<string>("");

  const refresh = useCallback(async () => {
    setAuth(authorizationStatus());
    setFlagOn(await isFlagEnabled(PASSIVE_CAPTURE_FLAG));
    setVisits(await drainNativeVisits());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onStart() {
    const r = await startPassiveCaptureIfEnabled();
    setMonitoring(r.started ? "monitoring started" : `not started: ${r.reason}`);
    await refresh();
  }

  function onStop() {
    stopPassiveCapture();
    setMonitoring("monitoring stopped");
  }

  async function onSimulate() {
    const v = simulateVisit(TEST_LAT, TEST_LNG, 45);
    if (!v) {
      Alert.alert("Native module unavailable", "Simulated visits require a dev/production build (not Expo Go).");
      return;
    }
    await refresh();
  }

  async function onClear() {
    await clearQueuedVisits();
    await refresh();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Passive capture</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {!isVisitMonitorAvailable && (
          <View style={[styles.card, styles.warn]}>
            <Text style={styles.warnText}>
              Native visit monitor not in this binary. Detection + simulated visits need a dev/production
              build that includes the module. The queue below still renders.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Row label="Native module" value={isVisitMonitorAvailable ? "available" : "unavailable"} />
          <Row label="Location auth" value={auth} />
          <Row label="Kill switch" value={flagOn == null ? "…" : flagOn ? "ON" : "OFF (killed)"} />
          {!!monitoring && <Row label="Last action" value={monitoring} />}
        </View>

        <View style={{ gap: 10, marginBottom: spacing.lg }}>
          <Button title="Start monitoring" onPress={onStart} />
          <Button title="Stop monitoring" variant="ghost" onPress={onStop} />
          <Button title="Inject simulated visit" variant="secondary" onPress={onSimulate} />
        </View>

        <View style={styles.listHead}>
          <Text style={type.subtitle}>Detections ({visits.length})</Text>
          <Pressable onPress={refresh} hitSlop={8}>
            <Text style={styles.link}>Refresh</Text>
          </Pressable>
        </View>

        {visits.length === 0 && (
          <View style={styles.card}>
            <Text style={type.small}>No raw visits captured yet.</Text>
          </View>
        )}

        {visits
          .slice()
          .reverse()
          .map((v) => (
            <View key={v.id} style={styles.row}>
              <Text style={styles.mono}>
                {v.lat.toFixed(5)}, {v.lng.toFixed(5)}  ±{Math.round(v.horizontalAccuracy)}m
                {v.simulated ? "  (sim)" : ""}
              </Text>
              <Text style={styles.sub}>arrive: {fmt(v.arrivalAt)}</Text>
              <Text style={styles.sub}>depart: {fmt(v.departureAt)}</Text>
              <Text style={styles.sub}>captured: {fmt(v.capturedAt)}</Text>
            </View>
          ))}

        {visits.length > 0 && (
          <Pressable onPress={onClear} style={{ marginTop: spacing.md }}>
            <Text style={[styles.link, { color: colors.red }]}>Clear queue</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 80 },
  card: {
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    marginBottom: spacing.lg,
  },
  warn: { backgroundColor: colors.faint, borderColor: colors.line },
  warnText: { ...type.small, color: colors.ink },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  kvLabel: { ...type.small, color: colors.mute },
  kvValue: { ...type.small, color: colors.ink, fontWeight: "700" },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  link: { ...type.small, color: colors.red, fontWeight: "700" },
  row: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    marginBottom: 10,
  },
  mono: { fontSize: 13, fontWeight: "700", color: colors.ink },
  sub: { ...type.small, marginTop: 2 },
});
