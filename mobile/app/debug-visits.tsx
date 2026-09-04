import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { seedDigestFixtures } from "../lib/passive-confirm";
import {
  getStopState, clearStopLog, parseStopLog,
  type NativeStopState,
} from "../modules/palate-visit-monitor";
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
import { listMisses, clearMisses, describeMiss, type PassiveMiss } from "../lib/passive-misses";
import { loadFunnel, type Funnel } from "../lib/activation-funnel";

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
  const [stopState, setStopState] = useState<NativeStopState | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  // Distinct from `funnel === null`, which means "still loading". A failed
  // read that renders as a spinner forever is the debug screen lying to you.
  const [funnelError, setFunnelError] = useState(false);
  const [flags, setFlags] = useState<{ detect: boolean; resolve: boolean; confirm: boolean } | null>(null);
  const [cache, setCache] = useState<{ hits: number; total: number; rate: number }>({ hits: 0, total: 0, rate: 0 });
  const [outcomes, setOutcomes] = useState<VisitOutcome[]>([]);
  const [note, setNote] = useState("");
  const [misses, setMisses] = useState<PassiveMiss[]>([]);

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
    setStopState(getStopState());
    setVisits(await drainNativeVisits());
    setMisses(await listMisses());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // One query, on mount only. It reads up to 2000 of your own analytics rows,
  // so it stays off the 3s poll below.
  useEffect(() => {
    void loadFunnel()
      .then((f) => { setFunnel(f); setFunnelError(false); })
      .catch(() => setFunnelError(true));
  }, []);

  // Live-poll only the cheap native read. drainNativeVisits() hits disk and
  // AsyncStorage, so it stays on the manual Refresh.
  useEffect(() => {
    const id = setInterval(() => setStopState(getStopState()), 3000);
    return () => clearInterval(id);
  }, []);

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

        {/* THE question this screen exists to answer: where does the pipeline
            actually stop? Reconstructing it took four hand-written SQL queries,
            which is why nobody had looked at it in weeks. */}
        <View style={styles.card}>
          <View style={styles.listHead}>
            <Text style={styles.mono}>Activation funnel · 30 days</Text>
            <Pressable onPress={() => {
              setFunnel(null);
              setFunnelError(false);
              void loadFunnel()
                .then(setFunnel)
                .catch(() => setFunnelError(true));
            }}>
              <Text style={styles.link}>Refresh</Text>
            </Pressable>
          </View>

          {funnelError ? (
            <Text style={styles.sub}>Couldn&apos;t read your events. Tap Refresh.</Text>
          ) : funnel === null ? (
            <Text style={styles.sub}>Loading…</Text>
          ) : funnel.stages[0].count === 0 ? (
            <Text style={styles.sub}>
              No detections in 30 days. Either passive capture is off, or the
              native module is not in this binary.
            </Text>
          ) : (
            <>
              {funnel.stages.map((st) => (
                <Row
                  key={st.key}
                  label={st.label}
                  value={st.keptPct === null ? `${st.count}` : `${st.count}  (${st.keptPct}% kept)`}
                />
              ))}
              {!!funnel.worstDrop && (
                <Text style={[styles.sub, { marginTop: 8 }]}>
                  Biggest drop: {funnel.worstDrop.from} → {funnel.worstDrop.to},
                  losing {funnel.worstDrop.lostPct}%.
                </Text>
              )}
            </>
          )}

          {/* Suppressions, always broken out. A suppressed detection is
              indistinguishable from one that never happened if you only read
              the stage totals — which is exactly how the confirm-multi bug
              stayed invisible while it ate four prompts in one afternoon. */}
          {!!funnel?.suppressions.length && (
            <>
              <Text style={[styles.mono, { marginTop: 14, marginBottom: 6 }]}>Suppressed, by reason</Text>
              {funnel.suppressions.map((sup) => (
                <Row key={sup.reason} label={sup.label} value={`${sup.count}`} />
              ))}
            </>
          )}
        </View>

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

        <View style={styles.card}>
          <Text style={[type.subtitle, { marginBottom: 6 }]}>Detector (live)</Text>
          {!stopState ? (
            <Text style={type.small}>Native module unavailable.</Text>
          ) : !stopState.candidate ? (
            <>
              <Row label="Current stop" value="none yet" />
              <Text style={styles.sub}>
                Waiting for a location fix. A candidate appears on the first fix after
                monitoring starts.
              </Text>
            </>
          ) : (
            <>
              <Row
                label="Dwell so far"
                value={`${Math.round(stopState.candidate.dwellSec)}s / ${Math.round(stopState.minDwellSec)}s`}
              />
              <Row label="Emitted" value={stopState.candidate.emitted ? "yes" : "not yet"} />
              <Row
                label="Fires in"
                value={
                  stopState.candidate.emitted
                    ? "—"
                    : `${Math.round(stopState.candidate.secUntilDwellCheck)}s`
                }
              />
              <Row label="Accuracy" value={`±${Math.round(stopState.candidate.accuracy)}m`} />
              {/* A large value here means iOS stopped delivering fixes — the
                  case the scheduled timer exists to cover. */}
              <Row
                label="Since last fix"
                value={`${Math.round(stopState.candidate.sinceLastFixSec)}s`}
              />
              <Text style={styles.mono}>
                {stopState.candidate.lat.toFixed(5)}, {stopState.candidate.lng.toFixed(5)}
              </Text>
            </>
          )}
          {!!stopState && (
            <Row
              label="Power profile"
              value={`${stopState.powerProfile}${
                stopState.batteryLevel >= 0 ? ` · ${Math.round(stopState.batteryLevel * 100)}%` : ""
              }`}
            />
          )}
          {!!stopState?.awaitingPreciseFix && (
            <Text style={styles.sub}>Awaiting high-accuracy fix…</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.listHead}>
            <Text style={type.subtitle}>Detector log</Text>
            <Pressable onPress={() => { clearStopLog(); void refresh(); }} hitSlop={8}>
              <Text style={[styles.link, { color: colors.red }]}>Clear</Text>
            </Pressable>
          </View>
          {!stopState?.log?.length ? (
            <Text style={type.small}>No detector events yet.</Text>
          ) : (
            parseStopLog(stopState.log).slice().reverse().map((e, i) => (
              <Text key={`${e.at}-${i}`} style={styles.mono}>
                {new Date(e.at).toLocaleTimeString()}  {e.kind}
                {e.detail ? `  ${e.detail}` : ""}
              </Text>
            ))
          )}
        </View>

        {/* Silent misses — detections that produced no prompt. "It never fires
            at this place" was unfalsifiable until these were recorded. */}
        <View style={styles.card}>
          <View style={styles.listHead}>
            <Text style={type.subtitle}>Silent misses ({misses.length})</Text>
            <Pressable onPress={() => { void clearMisses().then(refresh); }} hitSlop={8}>
              <Text style={[styles.link, { color: colors.red }]}>Clear</Text>
            </Pressable>
          </View>
          {misses.length === 0 ? (
            <Text style={type.small}>No misses recorded — every detection produced a prompt.</Text>
          ) : (
            misses.map((m, i) => (
              <View key={`${m.at}-${i}`} style={{ marginBottom: 8 }}>
                <Text style={styles.mono}>
                  {new Date(m.at).toLocaleTimeString()}  {m.reason}
                </Text>
                <Text style={styles.sub}>{describeMiss(m)}</Text>
                {m.rejectedSample.length > 0 && (
                  <Text style={styles.sub} numberOfLines={2}>
                    rejected: {m.rejectedSample.join(", ")}
                  </Text>
                )}
              </View>
            ))
          )}
        </View>

        <View style={{ gap: 8, marginBottom: spacing.lg }}>
          <Button title="Pre-permission screen" variant="ghost" onPress={() => router.push("/passive-capture-intro")} />
          <Button title="Request Always" variant="ghost" onPress={onRequestAlways} />
          <Button title="Start monitoring" onPress={onStart} />
          <Button title="Stop monitoring" variant="ghost" onPress={() => { stopPassiveCapture(); setNote("monitoring stopped"); }} />
          <Button title="Inject simulated visit" variant="secondary" onPress={onSimulate} />
          <Button title="Run pipeline now" onPress={onRun} />
          <Button title="Open inbox" variant="ghost" onPress={() => router.push("/passive-inbox")} />
          {/* The digest is the only confirmation surface now, and it had never
              once rendered — it needs a same-day capture AND 8:30pm to appear.
              These two open it on demand so banding, pre-check state, the
              which-one picker and confirm-all are verifiable in seconds. The
              real scheduling path is untouched. */}
          <Button
            title="Preview digest"
            variant="ghost"
            onPress={() => router.push("/digest")}
          />
          <Button
            title="Seed digest fixtures"
            variant="ghost"
            onPress={async () => {
              const n = await seedDigestFixtures();
              setNote(`seeded ${n} inbox entries (high/medium/low)`);
              await refresh();
            }}
          />
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
              {v.lat.toFixed(5)}, {v.lng.toFixed(5)}  ±{Math.round(v.horizontalAccuracy)}m  [{v.source ?? "visit"}]{v.simulated ? "  (sim)" : ""}
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
