import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type, radius } from "../theme";
import { saveVisit, recordPromptDecision } from "../lib/visits";
import { track } from "../lib/analytics";
import { removeFromInbox } from "../lib/passive-confirm";
import { triggerHapticSelection, triggerHapticSuccess } from "../lib/haptics";
import { VisitCelebration } from "../components/VisitCelebration";
import type { Restaurant } from "../lib/places";

// ============================================================================
// confirm-multi — one prompt for a cluster of venues.
// ----------------------------------------------------------------------------
// In a food hall, a strip mall, or a dense block, the phone genuinely cannot
// tell which counter you ate at. The old behaviour was to pick the closest
// candidate and ask about it alone, which is wrong twice over: it gets the
// venue wrong, and it burns the one prompt we're allowed on a wrong guess.
//
// So: ask once, list everything in range, let the user check off what's true.
// Zero checked is a real answer too — "None of these" records a dismissal for
// every candidate so the whole cluster goes quiet.
// ============================================================================

export default function ConfirmMulti() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    place_id: string;
    name: string;
    address?: string;
    alternates?: string;
    inbox_id?: string;
    dwell_min?: string;
    accuracy_m?: string;
    detect_source?: string;
    candidate_count?: string;
  }>();

  const options: Restaurant[] = useMemo(() => {
    let alts: Restaurant[] = [];
    try {
      alts = params.alternates ? (JSON.parse(params.alternates as string) as Restaurant[]) : [];
    } catch {
      alts = [];
    }
    const top: Restaurant = {
      google_place_id: params.place_id as string,
      name: params.name as string,
      address: (params.address as string) || null,
    };
    return [top, ...alts];
  }, [params.alternates, params.place_id, params.name, params.address]);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);

  const detectionProps = {
    dwell_min: params.dwell_min ? Number(params.dwell_min) : null,
    accuracy_m: params.accuracy_m ? Number(params.accuracy_m) : null,
    detect_source: (params.detect_source as string) || null,
    candidate_count: params.candidate_count ? Number(params.candidate_count) : null,
  };

  function toggle(id: string) {
    void triggerHapticSelection();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function clearInbox() {
    if (params.inbox_id) await removeFromInbox(params.inbox_id as string).catch(() => {});
  }

  async function save() {
    if (checked.size === 0) return;
    setBusy(true);
    try {
      // Each checked place is its own visit — a food-hall trip really is two
      // visits when you ate at two counters.
      for (const id of checked) {
        await saveVisit({ googlePlaceId: id, source: "auto" });
        await recordPromptDecision(id, "confirmed").catch(() => {});
      }
      // Everything offered and not checked is an explicit "not this one", so
      // the cluster doesn't come back asking again.
      for (const o of options) {
        if (!checked.has(o.google_place_id)) {
          await recordPromptDecision(o.google_place_id, "dismissed").catch(() => {});
        }
      }
      void track("confirm_multi_saved", {
        place_id: params.place_id,
        selected_count: checked.size,
        offered_count: options.length,
        ...detectionProps,
      });
      await clearInbox();
      void triggerHapticSuccess();
      setBurst((k) => k + 1);
      setTimeout(() => router.back(), 900);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again");
      setBusy(false);
    }
  }

  async function noneOfThese() {
    setBusy(true);
    for (const o of options) {
      await recordPromptDecision(o.google_place_id, "dismissed").catch(() => {});
    }
    void track("confirm_multi_none", {
      place_id: params.place_id,
      offered_count: options.length,
      ...detectionProps,
    });
    await clearInbox();
    router.back();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={type.micro}>SEVERAL SPOTS IN RANGE</Text>
        <Spacer size={6} />
        <Text style={styles.h1}>Where'd you eat?</Text>
        <Text style={[type.body, { color: colors.mute, marginTop: 8, lineHeight: 21 }]}>
          Check every place you ate at — more than one is fine.
        </Text>

        <Spacer size={24} />

        {options.map((o) => {
          const on = checked.has(o.google_place_id);
          return (
            <Pressable
              key={o.google_place_id}
              onPress={() => toggle(o.google_place_id)}
              style={[styles.row, on && styles.rowOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.name}
            >
              <View style={[styles.box, on && styles.boxOn]}>
                {on && <Text style={styles.check}>✓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowName, on && styles.rowNameOn]} numberOfLines={2}>{o.name}</Text>
                {!!o.address && <Text style={type.small} numberOfLines={1}>{o.address}</Text>}
              </View>
            </Pressable>
          );
        })}

        <Spacer size={24} />
        <Button
          title={checked.size > 1 ? `Log ${checked.size} visits` : "Log visit"}
          onPress={save}
          loading={busy}
          disabled={checked.size === 0}
        />
        <Spacer />
        <Button
          title="Add another place"
          variant="ghost"
          onPress={() => router.replace("/(tabs)/add")}
        />
        <Spacer />
        <Button title="None of these" variant="ghost" onPress={noneOfThese} />
      </ScrollView>
      <VisitCelebration fire={burst} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { padding: spacing.lg, paddingTop: spacing.xl },
  h1: { ...type.display },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
    marginBottom: 10,
  },
  rowOn: { borderColor: colors.red, backgroundColor: colors.redTint },
  box: {
    width: 24, height: 24, borderRadius: 7,
    borderWidth: 2, borderColor: colors.line,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff",
  },
  boxOn: { backgroundColor: colors.red, borderColor: colors.red },
  check: { color: "#fff", fontSize: 14, fontWeight: "900" },
  rowName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  rowNameOn: { color: colors.ink },
});
