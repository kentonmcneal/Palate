import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable, Share, Alert } from "react-native";
import { Text } from "./Text";
import { TextInput } from "./TextInput";
import { colors, spacing, type, card, shadow, categoryColors } from "../theme";
import { FONT_CAP } from "../lib/a11y";
import { track } from "../lib/analytics";
import { triggerHapticSelection, triggerHapticSuccess } from "../lib/haptics";
import { followUser } from "../lib/friends";
import {
  inviteSummary, redeemInvite, shareText, joinedLine,
  type InviteSummary,
} from "../lib/invite";

// ============================================================================
// InviteCard — the loop the app never had.
// ----------------------------------------------------------------------------
// Palate ranks partly on the people you follow, and it has never once asked
// anybody to bring a friend. There was a share sheet for a Wrapped image and
// that was the whole of it, which means the graph could only grow by the
// founder texting people individually.
//
// Two halves, because a referral has two ends. Your code and a Share button,
// and a place to type somebody else's. Redeeming is not a gate and buys no
// access: it records who brought you and offers you their profile to follow,
// so a brand-new account has a feed on day one instead of a blank screen.
// ============================================================================

export function InviteCard({ displayName }: { displayName?: string | null }) {
  const [summary, setSummary] = useState<InviteSummary | null>(null);
  const [entering, setEntering] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Somebody who already used a code should not be shown the box again: the
  // referral is set once and the field would only ever fail for them.
  const [redeemed, setRedeemed] = useState(false);

  const load = useCallback(() => {
    void inviteSummary().then(setSummary);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function share() {
    if (!summary) return;
    void triggerHapticSelection();
    void track("invite_shared", { joined: summary.joined });
    try {
      await Share.share({ message: shareText(summary.code, displayName) });
    } catch {
      // The sheet was dismissed. Not an error, and not worth a dialog.
    }
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const inviter = await redeemInvite(code);
      if (!inviter) {
        Alert.alert(
          "That code did not match",
          "Check it against the one they sent you. A code is six characters and is not needed to use Palate.",
        );
        return;
      }
      void triggerHapticSuccess();
      setRedeemed(true);
      setEntering(false);
      setCode("");
      const who = inviter.displayName?.trim()
        || (inviter.username ? `@${inviter.username}` : "them");
      // Following is offered, never done for you. Somebody else's code should
      // not be able to add a follow to your account without you saying yes.
      Alert.alert(
        `${who} invited you`,
        "Follow them so their visits show up in your feed?",
        [
          { text: "Not now", style: "cancel" },
          {
            text: "Follow",
            onPress: () => {
              void followUser(inviter.id)
                .then(() => track("invite_follow_accepted"))
                .catch(() => Alert.alert("Couldn't follow", "Try again from their profile."));
            },
          },
        ],
      );
    } finally {
      setBusy(false);
    }
  }

  if (!summary) return null;
  const joined = joinedLine(summary.joined);

  return (
    <View style={styles.card}>
      {/* Shadow outside, clip inside: iOS drops a view's own shadow when that
          view clips its children, so one view cannot both cast the card
          shadow and cut the rail to the rounded corners. Every other card in
          the app is built this way. */}
      <View style={styles.clip}>
      <View style={styles.rail} />
      <View style={styles.body}>
        <Text style={styles.eyebrow} maxFontSizeMultiplier={FONT_CAP.eyebrow}>BRING SOMEONE</Text>
        <Text style={styles.title}>Palate is better with your people</Text>
        <Text style={styles.sub}>
          Recommendations lean on the places your friends actually go. Send them your code.
        </Text>

        <Pressable
          onPress={share}
          style={styles.codeRow}
          accessibilityRole="button"
          accessibilityLabel={`Share your invite code, ${summary.code.split("").join(" ")}`}
        >
          <Text style={styles.code}>{summary.code}</Text>
          <View style={styles.shareBtn}>
            <Text style={styles.shareText} maxFontSizeMultiplier={FONT_CAP.chrome}>Share</Text>
          </View>
        </Pressable>

        {!!joined && <Text style={styles.joined}>{joined}</Text>}

        {!redeemed && !entering && (
          <Pressable onPress={() => setEntering(true)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>Someone invite you? Enter their code</Text>
          </Pressable>
        )}

        {entering && (
          <View style={styles.enterRow}>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="Their code"
              placeholderTextColor={colors.mute}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel="Invite code"
            />
            <Pressable
              onPress={submit}
              disabled={busy || code.trim().length === 0}
              style={[styles.enterBtn, (busy || code.trim().length === 0) && styles.enterBtnOff]}
              accessibilityRole="button"
            >
              <Text style={styles.enterText} maxFontSizeMultiplier={FONT_CAP.chrome}>
                {busy ? "…" : "Use"}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // No horizontal margin: this renders inside ProfileBody's ScrollView,
    // which already pads to spacing.lg, and a margin here would inset it
    // further than every other card on the screen.
    marginTop: spacing.lg,
    borderRadius: card.radius, backgroundColor: colors.faint,
    ...shadow.card,
  },
  clip: { borderRadius: card.radius, overflow: "hidden" },
  // The same rail every card in the app wears, in the one hue that is not a
  // cuisine: this card is about people.
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: categoryColors.plum },
  body: { padding: card.padding },
  eyebrow: { ...type.micro, color: categoryColors.plum },
  title: { ...type.cardTitle, color: colors.ink, marginTop: 6 },
  sub: { ...type.small, marginTop: 4, lineHeight: 18 },

  codeRow: {
    flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14,
    backgroundColor: colors.wash, borderRadius: 12, paddingLeft: 14, padding: 6,
  },
  code: { flex: 1, fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: 3 },
  shareBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.red },
  shareText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  joined: { ...type.small, marginTop: 10, color: categoryColors.pine, fontWeight: "700" },
  link: { fontSize: 13, fontWeight: "700", color: colors.redText, marginTop: 12 },

  enterRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  input: {
    flex: 1, backgroundColor: colors.wash, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, letterSpacing: 2, color: colors.ink,
  },
  enterBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 999, backgroundColor: colors.ink },
  enterBtnOff: { opacity: 0.4 },
  enterText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});
