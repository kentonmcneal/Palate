import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Button, Spacer } from "../components/Button";
import { track } from "../lib/analytics";
import { getInboxReadResult, removeFromInbox } from "../lib/passive-confirm";
import { confirmDigest, type VisitRating } from "../lib/digest-confirm";
import { buildDigest, type Digest, type DigestEntry } from "../lib/passive-digest";
import { saveVisit, recordPromptDecision, rateVisit } from "../lib/visits";
import { loadVisitPayoff } from "../lib/visit-payoff";
import { Confetti } from "../components/Confetti";
import { triggerHapticSuccess } from "../lib/haptics";
import { accountWriteSession, isAccountWriteSession, type AccountWriteSession } from "../lib/account-write";
import { onPersonalSignalInvalidate } from "../lib/personal-signal";
import type { Restaurant } from "../lib/places";

// The nightly digest. Confirmation is far cheaper cognitively than input, so
// everything here is pre-filled and declarative — "Chipotle, 12:40pm", never
// "Did you eat at Chipotle?".
//
// Ordering is band first, chronological within band. Chronology is how people
// reconstruct a day, and scrambling it to rank by confidence would place each
// row better while making the day as a whole harder to verify. Someone who only
// ever touches the top section still ends up with an accurate ledger.

// Said twice on the screen, once under the title and once beside the button,
// because a full day scrolls the title away and the button is where the answer
// is given. One string so the two cannot drift.
const WHY_IT_MATTERS = "Every answer teaches Palate when and where you eat, so the next guess is better.";

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function DigestScreen() {
  const account = useSyncExternalStore(onPersonalSignalInvalidate, accountWriteSession, accountWriteSession);
  return <DigestSession key={account.generation} account={account} />;
}

function DigestSession({ account }: { account: AccountWriteSession }) {
  const router = useRouter();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** Entry id -> the venue the user picked, when the top guess was wrong. */
  const [resolvedChoice, setResolvedChoice] = useState<Record<string, Restaurant>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showLow, setShowLow] = useState(false);
  // A reaction per entry, collected on the row. Nobody is required to give
  // one: the digest exists to confirm that a meal happened, and it has to
  // keep working for a person who taps Confirm and nothing else.
  const [ratings, setRatings] = useState<Record<string, VisitRating | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [payoff, setPayoff] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [done, setDone] = useState(false);

  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [notice, setNotice] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const life = useRef<object | null>(null);
  const focus = useRef<object | null>(null);
  const request = useRef<object | null>(null);
  const busy = useRef(false);
  const verified = useRef(false);
  const committed = useRef<object | null>(null);
  const render = {};
  // Session-local acknowledgements prevent repeat writes after partial success.
  // They do not establish ownership of legacy ownerless inbox records.
  const settled = useRef(new Set<string>());
  const saved = useRef(new Map<string, NonNullable<Awaited<ReturnType<typeof saveVisit>>>>());
  const rated = useRef(new Set<string>());
  // These cache completed calls, not proof of durable optional bookkeeping.
  const decided = useRef(new Map<string, string>());
  const selections = useRef(new Map<string, boolean>());
  const summary = useRef<object | null>(null);
  useLayoutEffect(() => {
    life.current = {};
    return () => { life.current = null; focus.current = null; request.current = null; verified.current = false; };
  }, []);
  useLayoutEffect(() => {
    committed.current = render;
    return () => { if (committed.current === render) committed.current = null; };
  });
  const currentAccount = () => !!life.current && isAccountWriteSession(account);
  const canAct = () => currentAccount() && !!focus.current && !busy.current && verified.current && committed.current === render;
  function edit(action: () => void) {
    if (!canAct()) return;
    committed.current = null;
    action();
  }
  const load = useCallback(async () => {
    const owner = life.current, focused = focus.current;
    if (!owner || !focused || busy.current || request.current || !isAccountWriteSession(account)) return;
    const ticket = {};
    request.current = ticket; verified.current = false;
    summary.current = null; setDone(false); setPayoff(null); setCelebrate(false);
    setStatus("loading");
    const current = () => life.current === owner && focus.current === focused && request.current === ticket && isAccountWriteSession(account);
    try {
      const result = await getInboxReadResult();
      if (!current()) return;
      if (result.status !== "ready") { setStatus("unavailable"); return; }
      const d = buildDigest(result.entries.filter(e => !settled.current.has(e.id)), new Date(), { windowed: false });
      setDigest(d);
      setChecked(new Set([...d.high, ...d.medium, ...d.low].filter(e => saved.current.has(e.id) || (selections.current.get(e.id) ?? e.preChecked)).map(e => e.id)));
      setStatus("ready"); verified.current = true;
      try { void track("digest_opened", { high: d.high.length, medium: d.medium.length, low: d.low.length }); } catch { /* Optional telemetry is not read status. */ }
    } catch { if (current()) setStatus("unavailable"); }
    finally { if (request.current === ticket) request.current = null; }
  }, [account]);
  useFocusEffect(useCallback(() => {
    const token = {}; focus.current = token;
    void load();
    return () => { if (focus.current === token) focus.current = null; request.current = null; verified.current = false; };
  }, [load]));
  function back() {
    if (!life.current || accountWriteSession() !== account || !focus.current || busy.current) return;
    focus.current = null; verified.current = false; request.current = null;
    router.back();
  }

  function rate(id: string, r: VisitRating) {
    // Saying how it was is also saying you went. Rating a row ticks it, and
    // tapping the same answer again clears the rating without unticking:
    // undoing an opinion is not the same as undoing the visit.
    if (!canAct() || saved.current.has(id)) return;
    committed.current = null;
    selections.current.set(id, true);
    setRatings((prev) => ({ ...prev, [id]: prev[id] === r ? undefined : r }));
    setChecked((prev) => new Set(prev).add(id));
  }

  function toggle(id: string) {
    if (!canAct() || saved.current.has(id)) return;
    committed.current = null;
    selections.current.set(id, !checked.has(id));
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function choose(entry: DigestEntry, place: Restaurant) {
    if (!canAct() || saved.current.has(entry.id)) return;
    committed.current = null;
    selections.current.set(entry.id, true);
    setResolvedChoice((prev) => ({ ...prev, [entry.id]: place }));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });
    setChecked((prev) => new Set(prev).add(entry.id));
  }

  async function confirmAll() {
    if (!digest || !canAct()) return;
    busy.current = true; verified.current = false; committed.current = null;
    setSaving(true); setNotice("");
    const owner = life.current, focused = focus.current;
    const current = () => life.current === owner && focus.current === focused && isAccountWriteSession(account);
    const guard = () => { if (!current()) throw new Error("Review changed"); };
    const all = [...digest.high, ...digest.medium, ...digest.low];
    try {
      // One entry per helper call lets us guard every next entry and retain a
      // successful visit if inbox removal fails. Shared helper policy is unchanged.
      // Retain the helper's confirmed-before-skipped ordering.
      const isConfirmed = (entry: DigestEntry) => checked.has(entry.id) || saved.current.has(entry.id);
      for (const entry of [...all.filter(isConfirmed), ...all.filter(e => !isConfirmed(e))]) {
        guard();
        if (settled.current.has(entry.id)) continue;
        const confirmed = checked.has(entry.id) || saved.current.has(entry.id);
        let removed = false;
        const result = await confirmDigest(confirmed ? [entry] : [], confirmed ? [] : [entry], resolvedChoice, {
          saveVisit: async args => {
            guard();
            const existing = saved.current.get(entry.id);
            if (existing) return existing;
            const visit = await saveVisit(args);
            // Remember a completed write even if focus changed during its await.
            if (visit?.id) saved.current.set(entry.id, visit);
            guard();
            if (!visit?.id) throw new Error("Visit save was not confirmed");
            return visit;
          },
          removeFromInbox: async id => { guard(); await removeFromInbox(id); removed = true; guard(); },
          recordPromptDecision: async (...args) => {
            guard();
            const signature = JSON.stringify(args);
            if (decided.current.get(entry.id) === signature) return;
            await recordPromptDecision(...args);
            decided.current.set(entry.id, signature);
            guard();
          },
          rateVisit: async (...args) => {
            guard(); if (rated.current.has(entry.id)) return;
            await rateVisit(...args); rated.current.add(entry.id); guard();
          },
          track: (name, props) => { if (current()) void track(name, props); },
        }, ratings);
        if (removed && result.failed.length === 0) settled.current.add(entry.id);
        guard();
      }
      guard();
      const pending = all.filter(e => !settled.current.has(e.id));
      try { void track("digest_confirmed", { confirmed: all.filter(isConfirmed).length, skipped: all.filter(e => !isConfirmed(e)).length, failed: pending.length }); } catch { /* Keep acknowledged outcomes. */ }
      setSavedCount(new Set([...saved.current.values()].map(visit => visit.id)).size);
      setDigest({ ...digest, high: digest.high.filter(e => !settled.current.has(e.id)), medium: digest.medium.filter(e => !settled.current.has(e.id)), low: digest.low.filter(e => !settled.current.has(e.id)), total: pending.length });
      setChecked(new Set(pending.filter(e => checked.has(e.id) || saved.current.has(e.id)).map(e => e.id)));
      if (pending.length) {
        setNotice("Some stops still need attention. Saved visits stay in your diary; retry finishes only the remaining stops.");
      } else {
        setDone(true);
        if (saved.current.size > 0) { setCelebrate(true); void triggerHapticSuccess().catch(() => {}); }
        const first = saved.current.values().next().value;
        if (first?.id) {
          const ticket = {}; summary.current = ticket;
          // Optional payoff must not keep confirmation/navigation locked.
          void loadVisitPayoff(first.id).then(text => {
            if (current() && summary.current === ticket) setPayoff(text);
          }).catch(() => {});
        }
      }
    } catch {
      if (current()) {
        const pending = all.filter(e => !settled.current.has(e.id));
        setSavedCount(new Set([...saved.current.values()].map(visit => visit.id)).size);
        setDigest({ ...digest, high: digest.high.filter(e => !settled.current.has(e.id)), medium: digest.medium.filter(e => !settled.current.has(e.id)), low: digest.low.filter(e => !settled.current.has(e.id)), total: pending.length });
        setChecked(new Set(pending.filter(e => checked.has(e.id) || saved.current.has(e.id)).map(e => e.id)));
        setNotice("We couldn’t finish this review. Retry to continue; visits already saved will not be saved again in this review.");
      }
    } finally {
      busy.current = false;
      if (life.current === owner && isAccountWriteSession(account)) {
        setSaving(false);
        if (focus.current === focused && focused) verified.current = true;
        else if (focus.current) void load();
      }
    }
  }

  if (!digest) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}>
      {account.accountId === null ? <Text style={styles.sub}>Return when your account is ready to review visits.</Text> : status === "unavailable" ? <>
        <Text style={styles.h1}>Couldn’t load your stops</Text>
        <Text style={styles.sub}>We couldn’t check which visits need confirmation.</Text>
        <Button title="Retry loading stops" onPress={() => { void load(); }} />
      </> : <ActivityIndicator color={colors.red} />}
    </View><View style={styles.footer}><Button title="Close" onPress={back} /></View></SafeAreaView>;
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <Confetti fire={celebrate} count={80} />
        <View style={styles.center}>
          <Text style={styles.emoji}>🍽️</Text>
          <Text style={styles.h1}>{savedCount ? `${savedCount} ${savedCount === 1 ? "visit" : "visits"} saved to your diary` : "Stops reviewed"}</Text>
          {!savedCount && <Text style={styles.sub}>No visits were added to your diary.</Text>}
          {/* The give-back. A digest that only ever asks for a chore will not
              sustain, so it returns something the day earned. */}
          {!!payoff && <Text style={styles.payoff}>{payoff}</Text>}
        </View>
        <View style={styles.footer}>
          {(digest.heldBack ?? 0) > 0 && <Button title="Review more stops" onPress={() => edit(() => { setDone(false); setCelebrate(false); setPayoff(null); void load(); })} />}
          <Button title="Done" onPress={back} />
        </View>
      </SafeAreaView>
    );
  }

  const nothing = digest.total === 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>Your day</Text>
        <Text style={styles.sub}>Select the places where you got food or a drink. Leave the others unchecked.</Text>
        <Text style={styles.why}>{WHY_IT_MATTERS}</Text>

        {status !== "ready" && <View style={styles.card}>
          <Text style={styles.sub}>{status === "loading" ? "Checking your stops…" : "Couldn’t refresh your stops. Previously loaded stops are shown; retry before confirming."}</Text>
          {status === "unavailable" && <Button title="Retry loading stops" onPress={() => { void load(); }} />}
        </View>}
        {!!notice && <Text accessibilityRole="alert" style={styles.sub}>{notice}</Text>}
        {nothing && status === "ready" && (
          <View style={styles.card}>
            <Text style={type.small}>No stops waiting for confirmation.</Text>
          </View>
        )}

        {digest.high.length > 0 && (
          <Section>
            {digest.high.map((e) => (
              <Row disabled={saving || status !== "ready" || saved.current.has(e.id)} key={e.id} entry={e} checked={checked.has(e.id)} chosen={resolvedChoice[e.id]}
                   rating={ratings[e.id]} onRate={(r) => rate(e.id, r)}
                   onToggle={() => toggle(e.id)}
                   expanded={expanded.has(e.id)}
                   onExpand={() => { if (!saved.current.has(e.id)) edit(() => setExpanded((p) => new Set(p).add(e.id))); }}
                   onChoose={(pl) => choose(e, pl)} />
            ))}
          </Section>
        )}

        {digest.medium.length > 0 && (
          <Section title="Also nearby today?">
            {digest.medium.map((e) => (
              <Row disabled={saving || status !== "ready" || saved.current.has(e.id)} key={e.id} entry={e} checked={checked.has(e.id)} chosen={resolvedChoice[e.id]}
                   rating={ratings[e.id]} onRate={(r) => rate(e.id, r)}
                   onToggle={() => toggle(e.id)}
                   expanded={expanded.has(e.id)}
                   onExpand={() => { if (!saved.current.has(e.id)) edit(() => setExpanded((p) => new Set(p).add(e.id))); }}
                   onChoose={(pl) => choose(e, pl)} />
            ))}
          </Section>
        )}

        {digest.low.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Pressable disabled={saving || status !== "ready"} onPress={() => edit(() => setShowLow((v) => !v))} hitSlop={8}>
              <Text style={styles.link}>{showLow ? "Hide" : `Anything else? (${digest.low.length})`}</Text>
            </Pressable>
            {showLow && (
              <Section>
                {digest.low.map((e) => (
                  <Row disabled={saving || status !== "ready" || saved.current.has(e.id)} key={e.id} entry={e} checked={checked.has(e.id)} chosen={resolvedChoice[e.id]}
                       rating={ratings[e.id]} onRate={(r) => rate(e.id, r)}
                       onToggle={() => toggle(e.id)}
                       expanded={expanded.has(e.id)}
                       onExpand={() => { if (!saved.current.has(e.id)) edit(() => setExpanded((p) => new Set(p).add(e.id))); }}
                       onChoose={(pl) => choose(e, pl)} />
                ))}
              </Section>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {/* Skipped when nothing was captured: the title then sits right above
            this button and the sentence is already on screen. */}
        {!nothing && <Text style={styles.footerWhy}>{WHY_IT_MATTERS}</Text>}
        <Button
          title={nothing ? "Close" : `Confirm ${checked.size}`}
          onPress={nothing ? back : confirmAll}
          disabled={saving || status !== "ready"}
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

const RATINGS: { key: VisitRating; label: string }[] = [
  { key: "loved", label: "Loved it" },
  { key: "ok", label: "Fine" },
  { key: "not_for_me", label: "Not for me" },
];

function Row({
  entry, checked, chosen, rating, onRate, onToggle, expanded, onExpand, onChoose, disabled,
}: {
  disabled: boolean;
  entry: DigestEntry;
  checked: boolean;
  chosen?: Restaurant;
  rating?: VisitRating;
  onRate: (r: VisitRating) => void;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  onChoose: (p: Restaurant) => void;
}) {
  const name = chosen?.name ?? entry.name;
  return (
    <View style={styles.row}>
      <Pressable disabled={disabled} onPress={onToggle} style={styles.rowMain} hitSlop={6}>
        <View style={[styles.box, checked && styles.boxOn]}>
          {checked && <Text style={styles.tick}>✓</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.meta}>{timeOf(entry.detectedAt)}</Text>
        </View>
      </Pressable>

      {/* Three taps, on the row, only once you have said you went.
          Two of fifty-five visits carried a rating before this, because the
          only way to give one was to open the visit afterwards and nobody
          does. The reaction is what the ranker needs most and the confirm is
          the one moment somebody is already thinking about the meal. Skipping
          it stays free: Confirm works untouched. */}
      {checked && (
        <View style={styles.rateRow}>
          {RATINGS.map((r) => {
            const on = rating === r.key;
            return (
              <Pressable
                disabled={disabled}
                key={r.key}
                onPress={() => onRate(r.key)}
                style={[styles.rateChip, on && styles.rateChipOn]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${r.label} at ${name}`}
              >
                <Text style={[styles.rateText, on && styles.rateTextOn]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Several plausible venues: "which one?" is the honest question, not a
          yes/no about our best guess. */}
      {entry.ambiguous && !chosen && !expanded && entry.alternates.length > 0 && (
        <Pressable disabled={disabled} onPress={onExpand} hitSlop={6}>
          <Text style={styles.which}>Which one?</Text>
        </Pressable>
      )}
      {expanded && (
        <View style={styles.picker}>
          {[{ google_place_id: entry.place_id, name: entry.name } as Restaurant, ...entry.alternates]
            .map((p) => (
              <Pressable disabled={disabled} key={p.google_place_id} onPress={() => onChoose(p)} style={styles.pick}>
                <Text style={styles.pickText}>{p.name}</Text>
              </Pressable>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rateRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, marginLeft: 34 },
  rateChip: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999,
    backgroundColor: colors.wash, borderWidth: 1, borderColor: colors.line,
  },
  rateChipOn: { backgroundColor: colors.redTint, borderColor: colors.redTintBorder },
  rateText: { fontSize: 13, fontWeight: "700", color: colors.mute },
  rateTextOn: { color: colors.redText },
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line },
  emoji: { fontSize: 40, marginBottom: spacing.md },
  h1: { ...type.display, color: colors.ink },
  sub: { ...type.body, color: colors.mute, marginTop: 6 },
  why: { ...type.small, color: colors.mute, marginTop: 4 },
  footerWhy: { ...type.small, color: colors.mute, textAlign: "center", marginBottom: 12 },
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
