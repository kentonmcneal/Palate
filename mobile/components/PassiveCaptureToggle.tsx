import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Linking, StyleSheet, Switch, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Text } from "./Text";
import { Button, Spacer } from "./Button";
import { colors, type } from "../theme";
import { accountWriteSession, isAccountWriteSession, type AccountWriteSession } from "../lib/account-write";
import { onPersonalSignalInvalidate } from "../lib/personal-signal";
import { readFlag } from "../lib/flags";
import { readPermissionStateForStatus } from "../lib/passive-permissions";
import { readPassiveOptInForStatus, optOutOfPassiveCapture, setPassiveOptIn, startPassiveCaptureIfEnabled, PASSIVE_CAPTURE_FLAG, type StartResult } from "../lib/passive-capture";

type Snapshot = { opted: boolean | null; always: boolean | null; flag: boolean | null };
type State = Snapshot & { phase: "loading" | "ready" | "saving" };
const initial: State = { opted: null, always: null, flag: null, phase: "loading" };
function startMessage(result: StartResult): string {
  if (result.started) return "Your choice is saved. Background checks were requested; some stops may still be missed.";
  switch (result.reason) {
    case "flag-off": return "Your choice is saved. Background checks did not start because they were paused.";
    case "no-always-permission": return "Your choice is saved. Background checks did not start because Always location access was unavailable.";
    case "native-module-unavailable": return "Your choice is saved. Background checks did not start because they are not available in this version of Palate.";
    case "not-opted-in": return "Background checks did not start. Check your saved choice again.";
  }
}

export function PassiveCaptureToggle() {
  // RootLayout advances this clock before notifying personal-signal listeners.
  const token = useSyncExternalStore(onPersonalSignalInvalidate, accountWriteSession, accountWriteSession);
  return <CapturePreference key={token.generation} token={token} />;
}
function CapturePreference({ token }: { token: AccountWriteSession }) {
  const router = useRouter();
  const [state, setState] = useState<State>(initial);
  const current = useRef(state);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryOff, setRetryOff] = useState(false);
  const life = useRef<object | null>(null);
  const focus = useRef<object | null>(null);
  const readTicket = useRef<object | null>(null);
  const writing = useRef(false);
  const navigating = useRef<object | null>(null);
  const commit = (next: State) => { current.current = next; setState(next); };
  const valid = () => life.current !== null && focus.current !== null && isAccountWriteSession(token);
  useLayoutEffect(() => {
    life.current = {};
    return () => { life.current = null; focus.current = null; readTicket.current = null; };
  }, []);

  const reload = useCallback(async () => {
    if (!life.current || !focus.current || !isAccountWriteSession(token) || writing.current) return;
    const owner = life.current, focused = focus.current, ticket = {};
    readTicket.current = ticket;
    commit({ ...current.current, phase: "loading" });
    const result = await Promise.allSettled([
      readPassiveOptInForStatus(), readPermissionStateForStatus(), readFlag(PASSIVE_CAPTURE_FLAG),
    ]);
    if (life.current !== owner || focus.current !== focused || readTicket.current !== ticket || !isAccountWriteSession(token)) return;
    const [opted, permission, flag] = result;
    commit({
      opted: opted.status === "fulfilled" ? opted.value : null,
      always: permission.status === "fulfilled" ? permission.value.always : null,
      flag: flag.status === "fulfilled" && typeof flag.value === "boolean" ? flag.value : null,
      phase: "ready",
    });
  }, [token]);

  useFocusEffect(useCallback(() => {
    focus.current = {};
    navigating.current = null;
    if (token.accountId === null) commit({ ...initial, phase: "ready" });
    else void reload();
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") void reload();
    });
    return () => { focus.current = null; readTicket.current = null; listener.remove(); };
  }, [reload, token]));

  function owns(expected: State) {
    return valid() && !writing.current && !navigating.current && current.current === expected && expected.phase === "ready";
  }
  async function change(next: boolean, expected: State, retryStopping = false) {
    if (!owns(expected) || (!retryStopping && (expected.opted === null || expected.opted === next))) return;
    if (next && (expected.flag !== true || expected.always === null)) return;
    if (next && !expected.always) {
      navigating.current = {};
      router.push("/passive-capture-intro" as never);
      return;
    }
    writing.current = true; // before any await or disabled-switch render
    readTicket.current = null;
    const owner = life.current, focused = focus.current;
    const stillOwnsAction = () => life.current === owner && focus.current === focused && isAccountWriteSession(token);
    commit({ ...expected, phase: "saving" });
    setNotice(null); setRetryOff(false);
    try {
      if (!next) {
        await optOutOfPassiveCapture();
        if (stillOwnsAction()) setNotice("Your preference is off. You can still add visits yourself.");
      } else {
        await setPassiveOptIn(true);
        if (!stillOwnsAction()) return;
        const result = await startPassiveCaptureIfEnabled();
        if (stillOwnsAction()) setNotice(startMessage(result));
      }
    } catch {
      if (life.current === owner && isAccountWriteSession(token)) {
        setNotice(next
          ? "We couldn’t finish turning this on. Your choice may have been saved; check the setting below."
          : "We couldn’t confirm background checks stopped. Your choice may have been saved. Try turning it off again.");
        setRetryOff(!next);
      }
    } finally {
      writing.current = false;
      // Re-read after partial writes, including an opt-in timestamp failure.
      // Focus return while a write is pending does not admit a second write.
      if (life.current === owner && isAccountWriteSession(token) && focus.current) void reload();
    }
  }
  async function repair(expected: State) {
    if (!owns(expected)) return;
    const navigation = {};
    navigating.current = navigation;
    try { await Linking.openSettings(); }
    catch {
      if (valid() && current.current === expected) setNotice("Couldn’t open phone settings. Try again.");
    } finally { if (navigating.current === navigation) navigating.current = null; }
  }

  const unknown = state.opted === null || state.always === null || state.flag === null;
  const disabled = state.phase !== "ready" || state.opted === null ||
    (!state.opted && (state.flag !== true || state.always === null));
  // A remote pause must not hide a previously saved opt-in or its opt-out.
  if (state.phase === "ready" && state.flag === false && state.opted === false && !notice) return null;
  return <>
    <Spacer />
    <View style={styles.row}>
      <Text style={[type.body, { flex: 1, paddingRight: 12 }]}>Find possible food or drink stops</Text>
      {state.opted === null
        ? <Text accessibilityValue={{ text: state.phase === "loading" ? "Loading" : "Unknown" }}>{state.phase === "loading" ? "Loading…" : "Unknown"}</Text>
        : <Switch accessibilityLabel="Allow background visit suggestions" value={state.opted} disabled={disabled}
            onValueChange={value => { void change(value, state); }}
            thumbColor={state.opted ? colors.red : "#fff"} trackColor={{ true: colors.redTintBorder, false: colors.line }} />}
    </View>
    <Text style={styles.note}>This switch saves your choice. Location permission is separate. You review suggested stops before adding them to your diary.</Text>
    {state.phase === "loading" && <Text style={styles.note}>Checking your saved choice and location access…</Text>}
    {state.phase === "saving" && <Text style={styles.note}>Saving your choice…</Text>}
    {token.accountId === null ? <Text style={styles.note}>Return when your account is ready to check this setting.</Text> : state.phase === "ready" && <>
      {state.opted === null && <Text style={styles.note}>We couldn’t read your saved choice. Try again before changing it.</Text>}
      {state.opted === false && <Text style={styles.note}>Your preference is off. Turn it on to review location access.</Text>}
      {state.opted === true && <Text style={styles.note}>Your preference is on. You can turn it off even if location access is unavailable.</Text>}
      {state.flag === false && <Text style={styles.note}>Background checks are currently paused. Your saved choice is unchanged.</Text>}
      {state.flag === null && <Text style={styles.note}>We couldn’t check whether background checks are available.</Text>}
      {state.always === null && <Text style={styles.note}>We couldn’t check location access.</Text>}
      {state.opted === true && state.always === false && <Text style={styles.note}>Always location access is needed for background suggestions. Choose it in your phone settings, or turn this preference off.</Text>}
      {state.opted === true && state.always === true && <Text style={styles.note}>Location access is allowed. Some stops may be missed; you can always add a visit yourself.</Text>}
      {state.opted === true && state.always === false && <Button title="Review phone location settings" variant="ghost" onPress={() => { void repair(state); }} />}
      {(unknown || notice !== null) && <Button title="Check again" variant="ghost" onPress={() => { if (owns(state)) void reload(); }} />}
      {retryOff && <Button title="Try turning off again" variant="ghost" onPress={() => { void change(false, state, true); }} />}
    </>}
    {notice && <Text style={styles.note}>{notice}</Text>}
  </>;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  note: { ...type.small, marginTop: 8 },
});
