import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { Text } from "../../components/Text";
import { TextInput } from "../../components/TextInput";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { colors, spacing, type } from "../../theme";
import {
  listMessages, listThreads, sendMessage, markRead, subscribeToThread,
  applyIncoming, reconcileSent, dropOptimistic, PENDING_PREFIX,
  listMessagesSince, newestServerTimestamp, mergeCatchUp, type DmMessage,
} from "../../lib/messages";
import { supabase } from "../../lib/supabase";
import { reportContent, blockUser, REPORT_REASONS } from "../../lib/moderation";

// ============================================================================
// thread — one conversation.
// ----------------------------------------------------------------------------
// Sending is optimistic: the message appears immediately and is reconciled
// when the insert returns, because a chat that waits on a round trip before
// showing your own words feels broken on a bad connection. A failure puts the
// text back in the box rather than losing it.
// ============================================================================

export default function ThreadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; other: string; name: string }>();
  // "new" until the first message creates the thread. Everything that needs a
  // real id — history, realtime, read receipts — waits for one rather than
  // subscribing to a channel that can never deliver.
  const [threadId, setThreadId] = useState(String(params.id ?? ""));
  const isNew = threadId === "new" || !threadId;
  const otherId = String(params.other ?? "");
  const otherName = String(params.name ?? "") || "Conversation";

  const [messages, setMessages] = useState<DmMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  // Also a ref: the realtime effect below closes over the viewer id, and its
  // deps are [threadId, isNew]. Reading state there would pin whatever `me` was
  // when the channel opened — null, if getUser() had not resolved — and the
  // echo-matching in applyIncoming would never fire. Re-subscribing on `me`
  // instead would tear down a live socket for no reason.
  const meRef = useRef<string | null>(null);
  // The catch-up handler below is created once per [threadId, isNew]. Reading
  // `messages` from state inside it would pin the list as it was when the
  // channel opened, so the boundary it computes would be stale and the gap it
  // fetched would be wrong.
  const messagesRef = useRef<DmMessage[] | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.id ?? null;
      meRef.current = id;
      setMe(id);
    });
  }, []);

  /** The viewer id, resolved on demand. A fast sender can beat getUser(). */
  const whoAmI = useCallback(async (): Promise<string | null> => {
    if (meRef.current) return meRef.current;
    const { data } = await supabase.auth.getUser();
    const id = data.user?.id ?? null;
    meRef.current = id;
    setMe(id);
    return id;
  }, []);

  const load = useCallback(async () => {
    if (isNew) { setMessages([]); return; }
    try {
      setMessages(await listMessages(threadId));
      void markRead(threadId);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load this conversation.");
      setMessages([]);
    }
  }, [threadId, isNew]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Live. RLS on dm_messages is participant-only, so a subscription cannot
  // deliver somebody else's conversation even if this filter were wrong.
  useEffect(() => {
    if (isNew) return;
    // Fill the hole a dropped subscription leaves. postgres_changes delivers
    // only what happens while connected, so messages inserted between a drop
    // and a reconnect were never pushed and nothing refetched them — they were
    // simply lost until the screen was left and re-entered.
    const catchUp = async () => {
      try {
        const since = newestServerTimestamp(messagesRef.current);
        if (since === null) {
          // Nothing server-confirmed to anchor on; refetch the window rather
          // than invent a boundary from a local clock.
          await load();
          return;
        }
        const missed = await listMessagesSince(threadId, since);
        if (missed.length === 0) return;
        setMessages((prev) => mergeCatchUp(prev, missed, meRef.current));
        void markRead(threadId);
      } catch {
        // A failed catch-up must not break a live thread. The next reconnect
        // tries again, and leaving the screen reloads from scratch.
      }
    };

    const off = subscribeToThread(
      threadId,
      (m) => {
        setMessages((prev) => applyIncoming(prev, m, meRef.current));
        void markRead(threadId);
      },
      () => { void catchUp(); },
    );
    return off;
  }, [threadId, isNew]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    // Resolved before the optimistic row is built, not after. sender_id drives
    // both the mine-or-theirs styling and the echo match, and `me ?? ""`
    // silently broke each of them for anyone who sent before getUser() landed.
    const mine = await whoAmI();
    // Optimistic. Reconciled by reconcileSent when dm_send answers, or by
    // applyIncoming if the realtime echo gets here first — either order.
    const optimistic: DmMessage = {
      id: `${PENDING_PREFIX}${Date.now()}`,
      thread_id: threadId,
      sender_id: mine ?? "",
      body,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    try {
      const realId = await sendMessage(otherId, body);
      setMessages((prev) => reconcileSent(prev, optimistic.id, realId));
      // The first message is what creates the thread, so this is where a
      // conversation opened from a profile learns its own id — and where the
      // realtime subscription becomes possible.
      if (isNew) {
        const mine = await listThreads().catch(() => []);
        const found = mine.find((t) => t.other_id === otherId);
        if (found) setThreadId(found.thread_id);
      }
    } catch (e: any) {
      // Put the words back rather than losing them.
      setMessages((prev) => dropOptimistic(prev, optimistic.id));
      setDraft(body);
      setError(e?.message ?? "That didn't send.");
    } finally {
      setSending(false);
    }
  }

  function openThreadMenu() {
    if (!otherId) return;
    Alert.alert(otherName, undefined, [
      {
        text: "Report this conversation",
        onPress: () => Alert.alert("Report", "Why are you reporting this?", [
          ...REPORT_REASONS.map((r) => ({
            text: r.label,
            onPress: async () => {
              try {
                await reportContent({
                  targetType: "dm_thread",
                  targetId: threadId || otherId,
                  targetUserId: otherId,
                  reason: r.key,
                });
                Alert.alert("Thanks", "We'll take a look.");
              } catch (e: any) {
                Alert.alert("Couldn't report", e?.message ?? "Try again.");
              }
            },
          })),
          { text: "Cancel", style: "cancel" },
        ]),
      },
      {
        text: "Block this person",
        style: "destructive",
        onPress: () => Alert.alert(
          `Block ${otherName}?`,
          "You won't see each other anywhere on Palate, and they can't message you.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Block",
              style: "destructive",
              onPress: async () => {
                try {
                  await blockUser(otherId);
                  // Out of the conversation, not just back to it: staying in a
                  // thread with somebody you have just blocked is the one
                  // screen this should never leave you on.
                  router.replace("/messages");
                } catch (e: any) {
                  Alert.alert("Couldn't block", e?.message ?? "Try again.");
                }
              },
            },
          ],
        ),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* Report and block, in the header.
          Apple Guideline 1.2 requires a way to report objectionable content
          and block the person producing it, on EVERY user-generated surface.
          The feed has both; this screen had neither, and a private message is
          where harassment actually happens — there is no audience to shame
          somebody out of it and nobody else can flag it for you. */}
      <Stack.Screen
        options={{
          title: otherName,
          headerRight: () => (
            <Pressable onPress={openThreadMenu} hitSlop={12} accessibilityLabel="Conversation options">
              <Text style={styles.menuDots}>•••</Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages === null && <ActivityIndicator color={colors.mute} style={{ marginTop: spacing.xl }} />}
          {messages?.length === 0 && !error && (
            <Text style={styles.empty}>Say something.</Text>
          )}
          {messages?.map((m) => {
            const mine = m.sender_id === me;
            return (
              <View key={m.id} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.body}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {!!error && (
          <Pressable onPress={() => setError(null)}>
            <Text style={styles.error}>{error}</Text>
          </Pressable>
        )}

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={colors.mute}
            style={styles.input}
            multiline
            maxLength={2000}
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
            accessibilityRole="button"
          >
            <Text style={styles.sendText}>{sending ? "…" : "Send"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  menuDots: { color: colors.mute, fontSize: 15, letterSpacing: 1, paddingHorizontal: 4 },
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { padding: spacing.lg, gap: 8 },
  empty: { ...type.small, textAlign: "center", marginTop: spacing.xl },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "78%", paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18 },
  bubbleTheirs: { backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line },
  bubbleMine: { backgroundColor: colors.red },
  bubbleText: { fontSize: 15, color: colors.ink, lineHeight: 20 },
  bubbleTextMine: { color: "#fff" },
  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.line,
    backgroundColor: colors.faint,
  },
  input: {
    flex: 1, maxHeight: 120, borderWidth: 1, borderColor: colors.line, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.ink,
    backgroundColor: colors.paper,
  },
  sendBtn: {
    paddingHorizontal: 16, height: 40, borderRadius: 20,
    backgroundColor: colors.red, alignItems: "center", justifyContent: "center",
  },
  sendBtnOff: { opacity: 0.4 },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  error: { ...type.small, color: colors.redText, paddingHorizontal: spacing.lg, paddingBottom: 6 },
});
