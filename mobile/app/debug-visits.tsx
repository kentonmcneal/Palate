import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
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
import { processPendingVisits, RESOLVE_FLAG, CONFIRM_FLAG, type VisitOutcome } from "../lib/passive-runner";
import { currentPermissionState, requestAlways } from "../lib/passive-permissions";
import { getCacheHitRate } from "../lib/passive-pipeline";

// Downtown Atlanta — Places returns real food venues here, so an injected visit
// exercises the whole qualify → resolve → confirm path end to end.
const TEST_LAT = 33.749;
const TEST_LNG = -84.388;

function fmt(ms: number | null): string {
  return ms == null ? "—" : new Date(ms).toLocaleString();
}

export default function DebugVisitsScreen() {
  const router = useRouter();
  const [visits, setVisits] = useState<RawVisit[]>([]);
  const [auth, setAuth] = useState("…");
  const [perm, setPerm] = useState<{ whenInUse: boolean; always: boolean }>({ whenInUse: false, always: false });
  const [expoAlways, setExpoAlways] = useState("…");
  const [flags, setFlags] = useState<{ detect: boolean; resolve: boolean; confirm: boolean } | null>(null);
  const [cache, setCache] = useState<{ hits: number; total: number; rate: number }>({ hits: 0, total: 0, rate: 0 });
  const [outcomes, setOutcomes] = useState<VisitOutcome[]>([]);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    setAuth(authorizationStatus());
    setPerm(await currentPermissionState());
    // Expo's own read, kept side by side with the native one on purpose: under a
    // PROVISIONAL Always grant these two disagree (native "always" vs Expo
    // "denied"), and that disagreement is the only way to see provisional from
    // the outside. If they disagree here, provisional is working.
    setExpoAlways(
      (await Location.getBackgroundPermissionsAsync().catch(() => null))?.status ?? "error",
    );
    setFlags({
      detect: await isFlagEnabled(PASSIVE_CAPTURE_FLAG),
      resolve: await isFlagEnabled(RESOLVE_FLAG),
      confirm: await isFlagEnabled(CONFIRM_FLAG),
    });
    setCache(await getCacheHitRate());
    setVisits(await drainNativeVisits());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onStart() {
    const r = await startPassiveCaptureIfEnabled();
    setNote(r.started ? "monitoring started" : `not started: ${r.reason}`);
    await refresh();
  }

  async function onSimulate() {
    const v = simulateVisit(TEST_LAT, TEST_LNG, 45);
    if (!v) {
      Alert.alert("Native module unavailable", "Simulated visits need a dev/production build (not Expo Go).");
      return;
    }
    setNote("injected simulated visit (45 min dwell)");
    await refresh();
  }

  async function onRun() {
    const summary = await processPendingVisits();
    setOutcomes(summary.outcomes);
    setNote(summary.ran ? `processed ${summary.detected} new` : "pipeline off (detection kill switch)");
    await refresh();
  }

  async function onRequestAlways() {
    const r = await requestAlways();
    setNote(`Always → ${r}`);
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
              Native visit monitor not in this binary — needs a dev/production build. The queue + pipeline
              still render.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Row label="Native module" value={isVisitMonitorAvailable ? "available" : "unavailable"} />
          <Row label="Location auth (native)" value={auth} />
          <Row label="When-In-Use" value={perm.whenInUse ? "granted" : "no"} />
          <Row label="Always (CoreLocation)" value={perm.always ? "granted" : "no"} />
          <Row label="Always (expo-location)" value={expoAlways} />
          <Row label="Kill switch (detect)" value={flags ? (flags.detect ? "ON" : "OFF") : "…"} />
          <Row label="Resolve flag" value={flags ? (flags.resolve ? "ON" : "OFF") : "…"} />
          <Row label="Confirm flag" value={flags ? (flags.confirm ? "ON" : "OFF") : "…"} />
          <Row label="Cache hit rate" value={`${Math.round(cache.rate * 100)}% (${cache.hits}/${cache.total})`} />
          {!!note && <Row label="Last action" value={note} />}
        </View>

        <View style={{ gap: 8, marginBottom: spacing.lg }}>
          <Button title="Pre-permission screen" variant="ghost" onPress={() => router.push("/passive-capture-intro")} />
          <Button title="Request Always" variant="ghost" onPress={onRequestAlways} />
          <Button title="Start monitoring" onPress={onStart} />
          <Button title="Stop monitoring" variant="ghost" onPress={() => { stopPassiveCapture(); setNote("monitoring stopped"); }} />
          <Button title="Inject simulated visit" variant="secondary" onPress={onSimulate} />
          <Button title="Run pipeline now" onPress={onRun} />
          <Button title="Open inbox" variant="ghost" onPress={() => router.push("/passive-inbox")} />
        </View>

        {outcomes.length > 0 && (
          <View style={styles.card}>
            <Text style={[type.subtitle, { marginBottom: 6 }]}>Last run</Text>
            {outcomes.map((o) => (
              <Text key={o.id} style={styles.outcome}>• {o.stage}: {o.detail}</Text>
            ))}
          </View>
        )}

        <View style={styles.listHead}>
          <Text style={type.subtitle}>Raw detections ({visits.length})</Text>
          <Pressable onPress={refresh} hitSlop={8}>
            <Text style={styles.link}>Refresh</Text>
          </Pressable>
        </View>

        {visits.length === 0 && (
          <View style={styles.card}>
            <Text style={type.small}>No raw visits captured yet.</Text>
          </View>
        )}

        {visits.slice().reverse().map((v) => (
          <View key={v.id} style={styles.row}>
            <Text style={styles.mono}>
              {v.lat.toFixed(5)}, {v.lng.toFixed(5)}  ±{Math.round(v.horizontalAccuracy)}m{v.simulated ? "  (sim)" : ""}
            </Text>
            <Text style={styles.sub}>arrive: {fmt(v.arrivalAt)}</Text>
            <Text style={styles.sub}>depart: {fmt(v.departureAt)}</Text>
          </View>
        ))}

        {visits.length > 0 && (
          <Pressable onPress={async () => { await clearQueuedVisits(); await refresh(); }} style={{ marginTop: spacing.md }}>
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 80 },
  card: {
    padding: spacing.lg, borderRadius: 16, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.paper, marginBottom: spacing.lg,
  },
  warn: { backgroundColor: colors.faint },
  warnText: { ...type.small, color: colors.ink },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  kvLabel: { ...type.small, color: colors.mute },
  kvValue: { ...type.small, color: colors.ink, fontWeight: "700" },
  listHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  link: { ...type.small, color: colors.red, fontWeight: "700" },
  outcome: { ...type.small, color: colors.ink, marginTop: 2 },
  row: {
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.paper, marginBottom: 10,
  },
  mono: { fontSize: 13, fontWeight: "700", color: colors.ink },
  sub: { ...type.small, marginTop: 2 },
});
