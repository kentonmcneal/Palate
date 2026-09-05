import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Button, Spacer } from "../components/Button";
import { track } from "../lib/analytics";
import { getInbox, removeFromInbox } from "../lib/passive-confirm";
import { confirmDigest } from "../lib/digest-confirm";
import { buildDigest, type Digest, type DigestEntry } from "../lib/passive-digest";
import { saveVisit, recordPromptDecision } from "../lib/visits";
import { loadVisitPayoff } from "../lib/visit-payoff";
import type { Restaurant } from "../lib/places";

// The nightly digest. Confirmation is far cheaper cognitively than input, so
// everything here is pre-filled and declarative — "Chipotle, 12:40pm", never
// "Did you eat at Chipotle?".
//
// Ordering is band first, chronological within band. Chronology is how people
// reconstruct a day, and scrambling it to rank by confidence would place each
// row better while making the day as a whole harder to verify. Someone who only
// ever touches the top section still ends up with an accurate ledger.

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function DigestScreen() {
  const router = useRouter();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** Entry id -> the venue the user picked, when the top guess was wrong. */
  const [resolvedChoice, setResolvedChoice] = useState<Record<string, Restaurant>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showLow, setShowLow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payoff, setPayoff] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    const d = buildDigest(await getInbox());
    setDigest(d);
    // Everything the digest presents as a likely visit arrives ticked, so the
    // common case — "yes, all of these" — is one tap. Driven off preChecked
    // rather than the band, so the rule lives in one place.
    setChecked(new Set(
      [...d.high, ...d.medium, ...d.low].filter((e) => e.preChecked).map((e) => e.id),
    ));
    void track("digest_opened", {
      high: d.high.length, medium: d.medium.length, low: d.low.length,
    });
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function choose(entry: DigestEntry, place: Restaurant) {
    setResolvedChoice((prev) => ({ ...prev, [entry.id]: place }));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });
    setChecked((prev) => new Set(prev).add(entry.id));
  }

  async function confirmAll() {
    if (!digest) return;
    setSaving(true);
    const all = [...digest.high, ...digest.medium, ...digest.low];
    const confirmed = all.filter((e) => checked.has(e.id));
    const skipped = all.filter((e) => !checked.has(e.id));

    try {
      // The ordering that keeps a failed save from silently deleting the entry
      // lives in lib/digest-confirm.ts, where it can be tested.
      const { savedIds, failed } = await confirmDigest(
        confirmed as never,
        skipped as never,
        resolvedChoice as never,
        { saveVisit, removeFromInbox, recordPromptDecision, track },
      );

      track("digest_confirmed", {
        confirmed: confirmed.length,
        skipped: skipped.length,
        failed: failed.length,
      });

      if (failed.length) {
        // Still in the inbox, still actionable. Saying so beats a silent
        // partial success the user only discovers via a missing visit.
        Alert.alert(
          failed.length === 1 ? "One visit didn't save" : `${failed.length} visits didn't save`,
          `${failed.map((f) => f.name).join(", ")} still needs saving. Try again in a moment.`,
        );
      }

      if (savedIds[0]) setPayoff(await loadVisitPayoff(savedIds[0]));
      setDone(failed.length === 0);
    } finally {
      setSaving(false);
    }
  }

  if (!digest) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.emoji}>🍽️</Text>
          <Text style={styles.h1}>Logged</Text>
          {/* The give-back. A digest that only ever asks for a chore will not
              sustain, so it returns something the day earned. */}
          {!!payoff && <Text style={styles.payoff}>{payoff}</Text>}
        </View>
        <View style={styles.footer}>
          <Button title="Done" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const nothing = digest.total === 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>Your day</Text>
        <Text style={styles.sub}>Tap to untick anything you didn't eat.</Text>

        {nothing && (
          <View style={styles.card}>
            <Text style={type.small}>Nothing captured today.</Text>
          </View>
        )}

        {digest.high.length > 0 && (
          <Section>
            {digest.high.map((e) => (
              <Row key={e.id} entry={e} checked={checked.has(e.id)} chosen={resolvedChoice[e.id]}
                   onToggle={() => toggle(e.id)}
                   expanded={expanded.has(e.id)}
                   onExpand={() => setExpanded((p) => new Set(p).add(e.id))}
                   onChoose={(pl) => choose(e, pl)} />
            ))}
          </Section>
        )}

        {digest.medium.length > 0 && (
          <Section title="Also nearby today?">
            {digest.medium.map((e) => (
              <Row key={e.id} entry={e} checked={checked.has(e.id)} chosen={resolvedChoice[e.id]}
                   onToggle={() => toggle(e.id)}
                   expanded={expanded.has(e.id)}
                   onExpand={() => setExpanded((p) => new Set(p).add(e.id))}
                   onChoose={(pl) => choose(e, pl)} />
            ))}
          </Section>
        )}

        {digest.low.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Pressable onPress={() => setShowLow((v) => !v)} hitSlop={8}>
              <Text style={styles.link}>{showLow ? "Hide" : `Anything else? (${digest.low.length})`}</Text>
            </Pressable>
            {showLow && (
              <Section>
                {digest.low.map((e) => (
                  <Row key={e.id} entry={e} checked={checked.has(e.id)} chosen={resolvedChoice[e.id]}
                       onToggle={() => toggle(e.id)}
                       expanded={expanded.has(e.id)}
                       onExpand={() => setExpanded((p) => new Set(p).add(e.id))}
                       onChoose={(pl) => choose(e, pl)} />
                ))}
              </Section>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={nothing ? "Close" : `Confirm ${checked.size}`}
          onPress={nothing ? () => router.back() : confirmAll}
          loading={saving}
        />
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      {!!title && <Text style={type.micro}>{title.toUpperCase()}</Text>}
      <View style={{ marginTop: title ? 8 : 0 }}>{children}</View>
    </View>
  );
}

function Row({
  entry, checked, chosen, onToggle, expanded, onExpand, onChoose,
}: {
  entry: DigestEntry;
  checked: boolean;
  chosen?: Restaurant;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  onChoose: (p: Restaurant) => void;
}) {
  const name = chosen?.name ?? entry.name;
  return (
    <View style={styles.row}>
      <Pressable onPress={onToggle} style={styles.rowMain} hitSlop={6}>
        <View style={[styles.box, checked && styles.boxOn]}>
          {checked && <Text style={styles.tick}>✓</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.meta}>{timeOf(entry.detectedAt)}</Text>
        </View>
      </Pressable>

      {/* Several plausible venues: "which one?" is the honest question, not a
          yes/no about our best guess. */}
      {entry.ambiguous && !chosen && !expanded && entry.alternates.length > 0 && (
        <Pressable onPress={onExpand} hitSlop={6}>
          <Text style={styles.which}>Which one?</Text>
        </Pressable>
      )}
      {expanded && (
        <View style={styles.picker}>
          {[{ google_place_id: entry.place_id, name: entry.name } as Restaurant, ...entry.alternates]
            .map((p) => (
              <Pressable key={p.google_place_id} onPress={() => onChoose(p)} style={styles.pick}>
                <Text style={styles.pickText}>{p.name}</Text>
              </Pressable>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line },
  emoji: { fontSize: 40, marginBottom: spacing.md },
  h1: { ...type.display, color: colors.ink },
  sub: { ...type.body, color: colors.mute, marginTop: 6 },
  payoff: { ...type.body, color: colors.mute, marginTop: spacing.md, textAlign: "center" },
  card: {
    borderColor: colors.line, borderWidth: 1, borderRadius: 18,
    padding: spacing.lg, backgroundColor: colors.faint, marginTop: spacing.lg,
  },
  row: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 14 },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 12 },
  box: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 1.5,
    borderColor: colors.line, alignItems: "center", justifyContent: "center",
  },
  boxOn: { backgroundColor: colors.red, borderColor: colors.red },
  tick: { color: "#fff", fontSize: 14, fontWeight: "800" },
  name: { ...type.subtitle, color: colors.ink },
  meta: { ...type.small, color: colors.mute, marginTop: 2 },
  which: { ...type.small, color: colors.red, marginTop: 6, marginLeft: 36 },
  picker: { marginTop: 8, marginLeft: 36, gap: 6 },
  pick: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  pickText: { ...type.body, color: colors.ink },
  link: { ...type.body, color: colors.red },
});
