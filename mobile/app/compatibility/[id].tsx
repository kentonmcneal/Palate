import { useCallback, useEffect, useState } from "react";
import { LoadError } from "../../components/LoadError";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share } from "react-native";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, spacing, type } from "../../theme";
import { getEffectiveLocation } from "../../lib/browsing-location";
import { getFriendProfileSnapshot } from "../../lib/profile";
import { computePairCompatibility, type PairResult } from "../../lib/palate/pairCompatibility";
import { captureError } from "../../lib/observability";
import { generateInviteLink, inviteShareMessage } from "../../lib/referrals";

export default function CompatibilityScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const targetId = id as string;

  const [result, setResult] = useState<PairResult | null>(null);
  const [friendName, setFriendName] = useState<string>("your friend");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const here = await getEffectiveLocation().catch(() => null);
      const [res, snap] = await Promise.all([
        computePairCompatibility(targetId, here),
        getFriendProfileSnapshot(targetId).catch(() => null),
      ]);
      setResult(res);
      if (snap?.display_name) setFriendName(snap.display_name);
      else if (snap?.email) setFriendName(snap.email.split("@")[0]);
    } catch (e) {
      void captureError(e, { at: "compatibility:load" });
      setLoadError(e);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInvite() {
    try {
      const link = await generateInviteLink();
      await Share.share({ message: inviteShareMessage(link) });
    } catch (e) {
      void captureError(e, { at: "compatibility:invite" });
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Compatibility</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.red} />
          </View>
        )}

        {!loading && !result && (
          <LoadError error={loadError} onRetry={() => { setLoading(true); void load(); }} />
        )}

        {!loading && result && !result.ready && !result.authorized && (
          <View style={styles.card}>
            <Text style={type.subtitle}>Add each other first.</Text>
            <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
              You can only see palate compatibility with accepted friends.
            </Text>
          </View>
        )}

        {!loading && result && !result.ready && result.authorized && (
          <View style={styles.card}>
            <Text style={styles.lockEyebrow}>ALMOST THERE</Text>
            <Text style={styles.lockTitle}>Keep logging to unlock</Text>
            <Text style={[type.small, { marginTop: 8, lineHeight: 20 }]}>
              Compatibility needs a few logged visits from both of you, so the read
              is real instead of noise.
            </Text>
            <View style={styles.progressRow}>
              <Progress label="You" have={result.yourVisits} need={result.threshold} />
              <Progress label={friendName} have={result.theirVisits} need={result.threshold} />
            </View>
          </View>
        )}

        {!loading && result && result.ready && (
          <>
            <View style={styles.resultCard}>
              <Text style={styles.resultEyebrow}>YOU + {friendName.toUpperCase()}</Text>
              <Text style={styles.resultType}>{result.compat.type}</Text>
              <Text style={styles.resultSummary}>{result.compat.summary}</Text>
              {result.compat.sharedSocialTags.length > 0 && (
                <View style={styles.tagRow}>
                  {result.compat.sharedSocialTags.map((t) => (
                    <View key={t} style={styles.tag}>
                      <Text style={styles.tagText}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <Text style={[type.micro, { marginTop: spacing.xl, marginBottom: 10 }]}>
              WHERE YOU TWO SHOULD EAT
            </Text>
            {result.picks.length === 0 ? (
              <View style={styles.card}>
                <Text style={[type.small, { lineHeight: 20 }]}>
                  Turn on location to get spots you'd both like nearby.
                </Text>
              </View>
            ) : (
              result.picks.map((p) => (
                <Pressable
                  key={p.google_place_id}
                  style={styles.pick}
                  onPress={() => router.push(`/restaurant/${p.google_place_id}` as never)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickName} numberOfLines={1}>{p.name}</Text>
                    {p.cuisine && (
                      <Text style={styles.pickSub} numberOfLines={1}>{cap(p.cuisine)}</Text>
                    )}
                  </View>
                  <View style={styles.pickScore}>
                    <Text style={styles.pickScoreNum}>{p.jointScore}</Text>
                    <Text style={styles.pickScoreLabel}>match</Text>
                  </View>
                </Pressable>
              ))
            )}
          </>
        )}

        {/* Growth hook: turn compatibility into a reason to invite more friends. */}
        {!loading && (
          <Pressable style={styles.inviteCard} onPress={handleInvite}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inviteTitle}>Compare palates with more friends</Text>
              <Text style={styles.inviteSub}>Invite someone and see how your tastes line up.</Text>
            </View>
            <Text style={styles.inviteArrow}>→</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Progress({ label, have, need }: { label: string; have: number; need: number }) {
  const pct = Math.min(1, need > 0 ? have / need : 0);
  return (
    <View style={styles.progress}>
      <Text style={styles.progressLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={styles.progressCount}>{Math.min(have, need)}/{need}</Text>
    </View>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
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
  center: { padding: 60, alignItems: "center" },

  card: {
    padding: spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },

  // Locked / not-ready state
  lockEyebrow: { ...type.micro, color: colors.mute },
  lockTitle: { fontSize: 22, fontWeight: "800", color: colors.ink, marginTop: 8, letterSpacing: -0.4 },
  progressRow: { flexDirection: "row", gap: 16, marginTop: 18 },
  progress: { flex: 1 },
  progressLabel: { ...type.small, fontWeight: "700", color: colors.ink, marginBottom: 6 },
  progressBar: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.faint,
    overflow: "hidden",
  },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: colors.red },
  progressCount: { ...type.small, marginTop: 6, fontWeight: "700" },

  // Result
  resultCard: {
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  resultEyebrow: { ...type.micro, color: colors.mute },
  resultType: {
    fontFamily: type.display.fontFamily,
    fontSize: 30,
    color: colors.ink,
    letterSpacing: -0.6,
    marginTop: 10,
  },
  resultSummary: { ...type.body, color: colors.inkDim, marginTop: 10, lineHeight: 22 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.redTint,
    borderWidth: 1,
    borderColor: colors.redTintBorder,
  },
  tagText: { color: colors.redText, fontSize: 13, fontWeight: "700" },

  // Joint picks
  pick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    marginBottom: 10,
  },
  pickName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  pickSub: { ...type.small, marginTop: 2 },
  pickScore: { alignItems: "center", minWidth: 48 },
  pickScoreNum: { fontSize: 22, fontWeight: "800", color: colors.red, letterSpacing: -0.5 },
  pickScoreLabel: { ...type.micro, color: colors.mute, marginTop: 0 },

  inviteCard: {
    marginTop: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.lg,
    borderRadius: 18,
    backgroundColor: colors.redTint,
    borderWidth: 1,
    borderColor: colors.redTintBorder,
  },
  inviteTitle: { fontSize: 16, fontWeight: "800", color: colors.ink },
  inviteSub: { ...type.small, marginTop: 3, lineHeight: 18 },
  inviteArrow: { fontSize: 20, fontWeight: "800", color: colors.red },
});
