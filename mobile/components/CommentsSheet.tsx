// ----------------------------------------------------------------------------
// CommentsSheet — the replies under one feed post.
// ----------------------------------------------------------------------------
// A bottom sheet rather than a route: a comment is a glance and a sentence, and
// pushing a screen loses your place in the feed for both. It keeps the post
// visible behind it, which is the whole reason you are typing.
//
// Moderation is not optional here. Comments are user-generated content under
// Apple Guideline 1.2, so every comment that is not yours carries report and
// block, reusing the same content_reports / block_user path the posts use.
// ----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal, View, StyleSheet, Pressable, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { Text } from "./Text";
import { FeedAvatar } from "./FeedAvatar";
import { colors, radius, spacing, type } from "../theme";
import { FONT_CAP } from "../lib/a11y";
import {
  listComments, addComment, deleteComment,
  COMMENT_MAX_LENGTH, type FeedComment,
} from "../lib/feed-comments";
import { reportContent, blockUser, REPORT_REASONS } from "../lib/moderation";
import { triggerHapticSuccess } from "../lib/haptics";

export function CommentsSheet({
  eventId, visible, onClose, onCountChange, onBlockedUser,
}: {
  eventId: string;
  visible: boolean;
  onClose: () => void;
  /** Fires with the live count so the card's label stays honest. */
  onCountChange: (n: number) => void;
  onBlockedUser: (userId: string) => void;
}) {
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await listComments(eventId);
      setComments(rows);
      onCountChange(rows.length);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load comments.");
    } finally {
      setLoading(false);
    }
  }, [eventId, onCountChange]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    load();
  }, [visible, load]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const created = await addComment(eventId, body);
      setDraft("");
      setComments((curr) => {
        const next = [...curr, created];
        onCountChange(next.length);
        return next;
      });
      triggerHapticSuccess();
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      Alert.alert("Couldn't post", e?.message ?? "Try again.");
    } finally {
      setSending(false);
    }
  }

  function confirmDelete(c: FeedComment) {
    Alert.alert("Delete comment?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            const gone = await deleteComment(c.id);
            if (!gone) { Alert.alert("Couldn't delete", "You can only delete your own comments, or comments on your post."); return; }
            setComments((curr) => {
              const next = curr.filter((x) => x.id !== c.id);
              onCountChange(next.length);
              return next;
            });
          } catch (e: any) {
            Alert.alert("Couldn't delete", e?.message ?? "Try again.");
          }
        },
      },
    ]);
  }

  function openMenu(c: FeedComment) {
    const options: any[] = [];
    if (c.canDelete) options.push({ text: "Delete", style: "destructive", onPress: () => confirmDelete(c) });
    options.push({ text: "Report", onPress: () => openReport(c) });
    options.push({
      text: "Block this person", style: "destructive",
      onPress: () => Alert.alert("Block?", "You won't see each other anywhere on Palate.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block", style: "destructive",
          onPress: async () => {
            try {
              await blockUser(c.userId);
              setComments((curr) => {
                const next = curr.filter((x) => x.userId !== c.userId);
                onCountChange(next.length);
                return next;
              });
              onBlockedUser(c.userId);
            } catch (e: any) {
              Alert.alert("Couldn't block", e?.message ?? "Try again.");
            }
          },
        },
      ]),
    });
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert("Comment", undefined, options);
  }

  function openReport(c: FeedComment) {
    Alert.alert("Report comment", "Why are you reporting this?", [
      ...REPORT_REASONS.map((r) => ({
        text: r.label,
        onPress: async () => {
          try {
            await reportContent({
              targetType: "comment",
              targetId: c.id,
              targetUserId: c.userId,
              reason: r.key,
            });
            Alert.alert("Thanks", "We'll take a look.");
          } catch (e: any) {
            Alert.alert("Couldn't report", e?.message ?? "Try again.");
          }
        },
      })),
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const over = draft.trim().length > COMMENT_MAX_LENGTH;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close comments" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.lift}
      >
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={[type.cardTitle, styles.heading]} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {comments.length === 0 ? "Comments" : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}
          </Text>

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.mute} /></View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={[type.body, { color: colors.mute, textAlign: "center" }]}>{error}</Text>
              <Pressable onPress={() => { setLoading(true); load(); }} hitSlop={10}>
                <Text style={[type.body, { color: colors.red, fontWeight: "700", marginTop: 8 }]}>Try again</Text>
              </Pressable>
            </View>
          ) : comments.length === 0 ? (
            <View style={styles.center}>
              <Text style={[type.body, { color: colors.mute, textAlign: "center" }]}>
                No comments yet. Ask them how it was.
              </Text>
            </View>
          ) : (
            <ScrollView ref={scroller} style={styles.list} contentContainerStyle={styles.listInner}>
              {comments.map((c) => (
                <Pressable key={c.id} onLongPress={() => openMenu(c)} delayLongPress={300} style={styles.row}>
                  <FeedAvatar
                    name={c.author.displayName ?? c.author.username ?? "?"}
                    uri={c.author.avatarUrl}
                    size={32}
                  />
                  <View style={styles.bubble}>
                    <Text style={styles.who}>
                      {c.author.displayName ?? c.author.username ?? "Someone"}
                    </Text>
                    <Text style={[type.body, styles.body]}>{c.body}</Text>
                  </View>
                  <Pressable onPress={() => openMenu(c)} hitSlop={12} accessibilityLabel="Comment options">
                    <Text style={styles.dots}>•••</Text>
                  </Pressable>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.composer}>
            <TextInput
              style={[styles.input, over && styles.inputOver]}
              placeholder="Add a comment"
              placeholderTextColor={colors.mute}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={COMMENT_MAX_LENGTH + 40}
              editable={!sending}
            />
            <Pressable
              onPress={send}
              disabled={sending || !draft.trim() || over}
              style={[styles.send, (sending || !draft.trim() || over) && styles.sendOff]}
              accessibilityRole="button"
            >
              <Text style={styles.sendText}>{sending ? "…" : "Post"}</Text>
            </Pressable>
          </View>
          {over && (
            <Text style={styles.overText}>
              {draft.trim().length - COMMENT_MAX_LENGTH} characters too long
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  lift: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.faint,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: 28,
    maxHeight: "82%",
  },
  grabber: {
    alignSelf: "center", width: 38, height: 4, borderRadius: 2,
    backgroundColor: colors.wash, marginBottom: 10,
  },
  heading: { marginBottom: 12 },
  center: { paddingVertical: 32, alignItems: "center" },
  list: { flexGrow: 0 },
  listInner: { paddingBottom: 8, gap: 14 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bubble: { flex: 1 },
  who: { fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 2 },
  body: { color: colors.ink },
  dots: { color: colors.mute, fontSize: 14, letterSpacing: 1 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 14 },
  input: {
    flex: 1, minHeight: 42, maxHeight: 120,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.md, backgroundColor: colors.wash,
    color: colors.ink, fontSize: 15,
  },
  inputOver: { borderWidth: 1, borderColor: colors.red },
  send: {
    paddingHorizontal: 16, paddingVertical: 11,
    borderRadius: 999, backgroundColor: colors.red,
  },
  sendOff: { opacity: 0.4 },
  sendText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  overText: { color: colors.red, fontSize: 12, marginTop: 6, textAlign: "right" },
});
