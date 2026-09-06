import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { Text } from "../../components/Text";
import { TextInput } from "../../components/TextInput";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { colors, spacing, type } from "../../theme";
import {
  listMessages, listThreads, sendMessage, markRead, subscribeToThread, type DmMessage,
} from "../../lib/messages";
import { supabase } from "../../lib/supabase";

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

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
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

  // Live. RLS on dm_messages is participant-only, so a subscription cannot
  // deliver somebody else's conversation even if this filter were wrong.
  useEffect(() => {
    if (isNew) return;
    const off = subscribeToThread(threadId, (m) => {
      setMessages((prev) => {
        if (!prev) return [m];
        if (prev.some((x) => x.id === m.id)) return prev; // our own echo
        return [...prev, m];
      });
      void markRead(threadId);
    });
    return off;
  }, [threadId, isNew]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    // Optimistic. The id is replaced when the server answers; the realtime
    // echo dedupes on it.
    const optimistic: DmMessage = {
      id: `pending-${Date.now()}`,
      thread_id: threadId,
      sender_id: me ?? "",
      body,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    try {
      const realId = await sendMessage(otherId, body);
      setMessages((prev) =>
        (prev ?? []).map((m) => (m.id === optimistic.id ? { ...m, id: realId } : m)),
      );
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
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimistic.id));
      setDraft(body);
      setError(e?.message ?? "That didn't send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: otherName }} />
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
