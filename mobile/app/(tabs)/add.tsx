import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { View, StyleSheet, FlatList, Pressable, Alert } from "react-native";
import { TextInput } from "../../components/TextInput";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { searchRestaurantsDetailed, searchRestaurantsLocal, type Restaurant } from "../../lib/places";
import { useSuggestions } from "../../lib/use-suggestions";
import { saveVisit, rewardCopy } from "../../lib/visits";
import { getCurrentLocation } from "../../lib/location";
import { FirstVisitCelebration } from "../../components/FirstVisitCelebration";
import { VisitCelebration } from "../../components/VisitCelebration";

import { accountWriteSession, isAccountWriteSession, type AccountWriteSession } from "../../lib/account-write";

type SearchAnswer = Awaited<ReturnType<typeof searchRestaurantsDetailed>>;
type SearchRequest = {
  life: object;
  promise: Promise<SearchAnswer | null>;
};
type SearchInput = { text: string };
type SearchTicket = { input: SearchInput; request: SearchRequest };

export default function AddTab() {
  const account = accountWriteSession();
  return <AddSession key={account.generation} account={account} />;
}

function AddSession({ account }: { account: AccountWriteSession }) {
  const router = useRouter();
  const [input, setInput] = useState<SearchInput>({ text: "" });
  const query = input.text;
  const inputRef = useRef(input);
  const lifeRef = useRef<object | null>(null);
  const activeSearch = useRef<SearchTicket | null>(null);
  const pendingSearches = useRef(new Map<string, SearchRequest>());
  useLayoutEffect(() => {
    const life = {};
    lifeRef.current = life;
    return () => {
      lifeRef.current = null;
      activeSearch.current = null;
      pendingSearches.current.clear();
    };
  }, []);
  const [results, setResults] = useState<Restaurant[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [celebration, setCelebration] = useState<{ name: string } | null>(null);
  const [burst, setBurst] = useState(0);
  const [saving, setSaving] = useState(false);
  // Synchronous guard: React state updates aren't immediate, so a fast
  // double-tap could pass an `if (saving)` check twice. A ref flips now.
  const savingRef = useRef(false);
  // Where the user is, resolved once, so suggestions can be ordered by
  // distance. Absent is fine — the lookup falls back to a plain name search.
  const [near, setNear] = useState<{ lat: number; lng: number } | undefined>();
  useEffect(() => {
    const life = lifeRef.current;
    void getCurrentLocation()
      .then((l) => {
        if (lifeRef.current === life && isAccountWriteSession(account)) {
          setNear({ lat: l.lat, lng: l.lng });
        }
      })
      .catch(() => {});
  }, []);

  // Suggestions as you type, from the catalogue we already hold. FREE.
  // The Google search below stays on the explicit submit, because it bills
  // per call and a keystroke is not a decision to spend money.
  const suggest = useCallback(
    (q: string) => searchRestaurantsLocal(q, near, 8),
    [near?.lat, near?.lng],
  );
  const { suggestions, loading: suggesting } = useSuggestions<Restaurant>(query, suggest);
  // Once a paid search has run, its results are the better answer and stay put
  // until the query changes again.
  const showing = results.length > 0 ? results : suggestions;

  function changeQuery(text: string) {
    if (!lifeRef.current || !isAccountWriteSession(account)) return;
    // Update now, before a saved submit callback or an awaited location resumes.
    const next = { text };
    inputRef.current = next;
    activeSearch.current = null;
    setInput(next);
    setResults([]);
    setDegraded(false);
    setLoading(false);
  }

  async function handleSearch() {
    const q = input.text.trim();
    const life = lifeRef.current;
    if (!q || !life || inputRef.current !== input || !isAccountWriteSession(account)) return;
    // Keyboard and button can submit within the same React update batch.
    if (activeSearch.current?.input === input) return;

    let request = pendingSearches.current.get(q);
    const fresh = !request || request.life !== life;
    if (fresh) {
      request = { life, promise: Promise.resolve(null) };
      pendingSearches.current.set(q, request);
    }
    const ownedRequest = request!;
    const ticket: SearchTicket = { input, request: ownedRequest };
    activeSearch.current = ticket;
    setLoading(true);

    const alive = () => lifeRef.current === life && isAccountWriteSession(account);
    const current = () => alive() && activeSearch.current === ticket && inputRef.current === input;
    if (fresh) {
      ownedRequest.promise = (async () => {
        let bias: { lat: number; lng: number } | undefined;
        try {
          const loc = await getCurrentLocation();
          bias = { lat: loc.lat, lng: loc.lng };
        } catch {
          // Location denied/unavailable: a still-current explicit search is allowed.
        }
        // A new explicit submit for the same pending query may join this request.
        // Typing alone never authorizes the paid boundary.
        const active = activeSearch.current;
        if (!alive() || active?.request !== ownedRequest || active.input !== inputRef.current) return null;
        return searchRestaurantsDetailed(q, bias);
      })().finally(() => {
        if (pendingSearches.current.get(q) === ownedRequest) pendingSearches.current.delete(q);
      });
    }
    try {
      const answer = await ownedRequest.promise;
      if (!current() || !answer) return;
      setDegraded(answer.degraded && answer.places.length === 0);
      setResults(answer.places);
    } catch (e: any) {
      if (current()) Alert.alert("Search failed", typeof e?.message === "string" && e.message.trim() ? e.message : "Try again");
    } finally {
      if (current()) {
        activeSearch.current = null;
        setLoading(false);
      }
    }
  }

  async function pickPlace(p: Restaurant) {
    // Guard against a rapid double-tap logging the same visit twice —
    // saveVisit's dedup is a non-atomic select-then-insert, so two concurrent
    // calls can both slip through and corrupt visit counts.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await saveVisit({ googlePlaceId: p.google_place_id, source: "manual" });
      if (result.isFirstVisit) {
        setCelebration({ name: p.name });
      } else {
        // Lightweight celebration on every visit. Auto-dismisses, then we
        // route home so the user sees the new entry in Recent.
        setBurst((k) => k + 1);
        setTimeout(() => router.replace("/(tabs)"), 1100);
      }
    } catch (e: any) {
      Alert.alert("Couldn't save", typeof e?.message === "string" && e.message.trim() ? e.message : "Try again");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={type.title}>Add a visit</Text>
        <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
          Search for a place. We'll save it as today's visit.
        </Text>
        <Spacer size={20} />
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={changeQuery}
            placeholder="Search restaurants, cafés…"
            autoCorrect={false}
            placeholderTextColor={colors.mute}
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
            autoCapitalize="words"
          />
        </View>
        <Spacer />
        {/* The button now means "look further than we already know", because
            the list below fills in as you type. It is also the only thing on
            this screen that spends money. */}
        <Button
          title={loading ? "Searching…" : showing.length > 0 ? "Search everywhere" : "Search"}
          onPress={handleSearch}
          loading={loading}
        />
        <Spacer size={20} />
        {suggesting && showing.length === 0 && (
          <Text style={type.small}>Looking…</Text>
        )}
        {!suggesting && !loading && query.trim().length >= 2 && showing.length === 0 && (
          <Text style={type.small}>
            {degraded
              ? "Wider search is resting until tomorrow. You can still add it by name from Search later."
              : "Nothing by that name in our list yet. Tap Search to look it up."}
          </Text>
        )}
        <FlatList
          data={showing}
          keyExtractor={(item) => item.google_place_id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => pickPlace(item)}
              disabled={saving}
              style={[styles.row, saving && { opacity: 0.5 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                {item.address && <Text style={type.small}>{item.address}</Text>}
              </View>
              <Text style={styles.add}>+</Text>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line }} />}
        />
      </View>
      <FirstVisitCelebration
        visible={!!celebration}
        restaurantName={celebration?.name ?? ""}
        onDismiss={() => { setCelebration(null); router.replace("/(tabs)"); }}
      />
      <VisitCelebration fire={burst} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: spacing.lg },
  searchRow: { flexDirection: "row" },
  input: {
    flex: 1,
    minHeight: 52, paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.ink,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  name: { ...type.subtitle },
  add: { fontSize: 28, color: colors.red, fontWeight: "700", marginLeft: 12 },
});
