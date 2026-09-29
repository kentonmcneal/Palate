// ============================================================================
// CommentsSheet — the thread under one post.
// ----------------------------------------------------------------------------
// Rebuilt. The first version had two faults that together made it visibly
// glitch, and both are worth naming because neither is obvious from reading it:
//
//   1. ONE SHEET PER ROW. Every FeedRow rendered its own <Modal>. Fifty posts
//      meant fifty modals mounted behind the feed. It is now rendered ONCE, by
//      the screen, for whichever post is open.
//
//   2. AN INFINITE RENDER LOOP. `load` was a useCallback depending on
//      `onCountChange`, the screen passed `onCountChange={(n) => ...}` as an
//      inline arrow, and the effect depended on `load`. So: effect runs ->
//      parent setState -> re-render -> brand new arrow -> new `load` -> effect
//      runs again, forever, for as long as the sheet was open. The count
//      callback is now held in a ref, so it can change identity as often as it
//      likes without being a dependency of anything.
//
// The list itself is Instagram's shape: top-level comments with their replies
// indented underneath, a heart on every one, and replying targets a specific
// comment rather than shouting into the post.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal, View, StyleSheet, Pressable, ScrollView, type TextInput as NativeTextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { Text } from "./Text";
import { TextInput } from "./TextInput";
import { FeedAvatar } from "./FeedAvatar";
import { HeartButton } from "./HeartButton";
import { applyLike, restoreLike, createLikeGate } from "../lib/optimistic-like";
import { colors, radius, spacing, type } from "../theme";
import { FONT_CAP } from "../lib/a11y";
import {
  listComments, addComment, deleteComment, toggleCommentLike, threadComments,
  COMMENT_MAX_LENGTH, type FeedComment,
} from "../lib/feed-comments";
import { reportContent, blockUser, REPORT_REASONS } from "../lib/moderation";
import { triggerHapticSuccess } from "../lib/haptics";

export function CommentsSheet({
  eventId, visible, onClose, onCountChange, onBlockedUser,
}: {
  /** Null when nothing is open. The sheet holds no state for a closed post. */
  eventId: string | null;
  visible: boolean;
  onClose: () => void;
  onCountChange: (eventId: string, n: number) => void;
  onBlockedUser: (userId: string) => void;
}) {
  const likeGate = useRef(createLikeGate()).current;
  const [pendingLikes, setPendingLikes] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null);
  const scroller = useRef<ScrollView | null>(null);
  const input = useRef<NativeTextInput | null>(null);
  const activeEvent = useRef<string | null>(null);
  const session = useRef({ key: null as string | null, version: 0 });
  const nextEvent = visible ? eventId : null;
  if (session.current.key !== nextEvent) session.current = { key: nextEvent, version: session.current.version + 1 };
  activeEvent.current = nextEvent;
  const sendToken = useRef<object | null>(null);
  const loadSequence = useRef(0);
  const commentsRef = useRef(comments);
  // Mutations and list responses share this synchronous source of truth.
  const mutationRevision = useRef(0);
  const mutations = useRef<Array<{
    revision: number;
    event: string | null; // null applies to every post (a blocked author).
    apply: (rows: FeedComment[]) => FeedComment[];
  }>>([]);

  function publish(id: string, rows: FeedComment[]) {
    commentsRef.current = rows;
    setComments(rows);
    countCb.current(id, rows.length);
  }

  function completeMutation(id: string | null, apply: (rows: FeedComment[]) => FeedComment[]) {
    mutations.current.push({ revision: ++mutationRevision.current, event: id, apply });
    const active = activeEvent.current;
    if (active && (id === null || active === id)) publish(active, apply(commentsRef.current));
  }

  // The escape hatch from the render loop: the callback is READ at call time
  // and never observed, so its identity cannot invalidate anything.
  const countCb = useRef(onCountChange);
  countCb.current = onCountChange;

  const load = useCallback(async (id: string) => {
    const sequence = ++loadSequence.current;
    const revision = mutationRevision.current;
    const version = session.current.version;
    const current = () => activeEvent.current === id && session.current.version === version && loadSequence.current === sequence;
    setLoading(true);
    setError(null);
    try {
      const rows = await listComments(id);
      if (!current()) return;
      const merged = mutations.current
        .filter(m => m.revision > revision && (m.event === null || m.event === id))
        .reduce((currentRows, m) => m.apply(currentRows), rows);
      publish(id, merged);
      // Older operations are already represented by this request's snapshot.
      mutations.current = mutations.current.filter(m => m.revision > revision);
    } catch (e: any) {
      if (current()) setError(e?.message ?? "Couldn't load comments.");
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible || !eventId) { loadSequence.current++; return; }
    setLoading(true);
    sendToken.current = null;
    setSending(false);
    setComments([]);
    commentsRef.current = [];
    setReplyTo(null);
    setDraft("");
    void load(eventId);
    return () => { loadSequence.current++; };
  }, [visible, eventId, load]);

  const threads = useMemo(() => threadComments(comments), [comments]);

  async function send() {
    const body = draft.trim();
    if (!body || sendToken.current || loading || error || !eventId) return;
    setSending(true);
    const targetEvent = eventId;
    const version = session.current.version;
    const token = {};
    sendToken.current = token;
    const current = () => activeEvent.current === targetEvent && session.current.version === version && sendToken.current === token;
    try {
      const created = await addComment(targetEvent, body, replyTo?.id ?? null);
      // Data belongs to the post; draft and busy state belong to this session.
      completeMutation(targetEvent, rows => rows.some(c => c.id === created.id)
        ? rows : [...rows, created]);
      if (!current()) return;
      setDraft("");
      setReplyTo(null);
      void triggerHapticSuccess();
      requestAnimationFrame(() => {
        if (activeEvent.current === targetEvent && session.current.version === version) scroller.current?.scrollToEnd({ animated: true });
      });
    } catch (e: any) {
      if (current()) Alert.alert("Couldn't post", e?.message ?? "Try again.");
    } finally {
      if (current()) { sendToken.current = null; setSending(false); }
    }
  }

  function heart(c: FeedComment) {
    if (!likeGate.acquire(c.id)) return;
    const targetEvent = eventId;
    const version = session.current.version;
    setPendingLikes(curr => new Set(curr).add(c.id));
    if (targetEvent) publish(targetEvent, applyLike(commentsRef.current, c.id, !c.iLiked));
    void toggleCommentLike(c.id, c.iLiked).then(() => {
      if (targetEvent) completeMutation(targetEvent, rows => applyLike(rows, c.id, !c.iLiked));
    }).catch((e: any) => {
      if (targetEvent && activeEvent.current === targetEvent && session.current.version === version) {
        publish(targetEvent, restoreLike(commentsRef.current, c));
        Alert.alert("Couldn't update", e?.message ?? "Try again.");
      }
    }).finally(() => {
      likeGate.release(c.id);
      setPendingLikes(curr => { const next = new Set(curr); next.delete(c.id); return next; });
    });
  }

  function startReply(c: FeedComment) {
    // Replies attach to the TOP-LEVEL comment, never to another reply: 0148
    // stores one level deep on purpose, so a thread can never become a tree
    // with no way to draw it.
    const root = c.parentId ? comments.find((x) => x.id === c.parentId) ?? c : c;
    setReplyTo(root);
    input.current?.focus();
  }

  function confirmDelete(c: FeedComment) {
    const targetEvent = eventId;
    const version = session.current.version;
    const current = () => activeEvent.current === targetEvent && session.current.version === version;
    Alert.alert("Delete comment?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            const gone = await deleteComment(c.id);
            if (!gone) {
              if (current()) Alert.alert("Couldn't delete", "You can only delete your own comments, or comments on your post.");
              return;
            }
            // A deleted parent takes its replies with it (ON DELETE CASCADE),
            // so the local list has to drop them too or they linger as orphans
            // until the next load.
            if (targetEvent) completeMutation(targetEvent, rows => rows.filter(x => x.id !== c.id && x.parentId !== c.id));
            if (activeEvent.current === targetEvent) setReplyTo(reply => reply?.id === c.id ? null : reply);
          } catch (e: any) {
            if (current()) Alert.alert("Couldn't delete", e?.message ?? "Try again.");
          }
        },
      },
    ]);
  }

  function openMenu(c: FeedComment) {
    const targetEvent = eventId;
    const version = session.current.version;
    const current = () => activeEvent.current === targetEvent && session.current.version === version;
    const options: any[] = [{ text: "Reply", onPress: () => startReply(c) }];
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
              completeMutation(null, rows => rows.filter(x => x.userId !== c.userId));
              setReplyTo(reply => reply?.userId === c.userId ? null : reply);
              onBlockedUser(c.userId);
            } catch (e: any) {
              if (current()) Alert.alert("Couldn't block", e?.message ?? "Try again.");
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
              targetType: "comment", targetId: c.id,
              targetUserId: c.userId, reason: r.key,
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
              <Pressable onPress={() => { if (eventId) { setLoading(true); void load(eventId); } }} hitSlop={10}>
                <Text style={[type.body, { color: colors.redText, fontWeight: "700", marginTop: 8 }]}>Try again</Text>
              </Pressable>
            </View>
          ) : comments.length === 0 ? (
            <View style={styles.center}>
              <Text style={[type.body, { color: colors.mute, textAlign: "center" }]}>
                No comments yet. Ask them how it was.
              </Text>
            </View>
          ) : (
            <ScrollView
              ref={scroller}
              style={styles.list}
              contentContainerStyle={styles.listInner}
              keyboardShouldPersistTaps="handled"
            >
              {threads.map(({ comment, replies }) => (
                <View key={comment.id} style={styles.thread}>
                  <Row likePending={pendingLikes.has(comment.id)} c={comment} onHeart={heart} onMenu={openMenu} onReply={startReply} />
                  {replies.map((r) => (
                    <View key={r.id} style={styles.replyIndent}>
                      <Row likePending={pendingLikes.has(r.id)} c={r} onHeart={heart} onMenu={openMenu} onReply={startReply} small />
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}

          {replyTo && (
            <View style={styles.replyBar}>
              <Text style={styles.replyBarText} numberOfLines={1}>
                Replying to {replyTo.author.displayName ?? replyTo.author.username ?? "someone"}
              </Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={10}>
                <Text style={styles.replyBarX}>✕</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.composer}>
            <TextInput
              ref={input}
              style={[styles.input, over && styles.inputOver]}
              placeholder={replyTo ? "Write a reply" : "Add a comment"}
              placeholderTextColor={colors.mute}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={COMMENT_MAX_LENGTH + 40}
              editable={!sending && !loading && !error}
            />
            <Pressable
              onPress={send}
              accessibilityLabel="Post comment"
              disabled={sending || loading || !!error || !draft.trim() || over}
              style={[styles.send, (sending || loading || !!error || !draft.trim() || over) && styles.sendOff]}
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

function Row({
  c, onHeart, onMenu, onReply, small, likePending = false,
}: {
  c: FeedComment;
  onHeart: (c: FeedComment) => void;
  onMenu: (c: FeedComment) => void;
  onReply: (c: FeedComment) => void;
  small?: boolean;
  likePending?: boolean;
}) {
  return (
    <Pressable onLongPress={() => onMenu(c)} delayLongPress={300} style={styles.row}>
      <FeedAvatar
        name={c.author.displayName ?? c.author.username ?? "?"}
        uri={c.author.avatarUrl}
        size={small ? 26 : 32}
      />
      <View style={styles.bubble}>
        <Text style={styles.who}>
          {c.author.displayName ?? c.author.username ?? "Someone"}
        </Text>
        <Text style={[type.body, styles.body]}>{c.body}</Text>
        <Pressable onPress={() => onReply(c)} hitSlop={8} style={styles.replyBtn}>
          <Text style={styles.replyText}>Reply</Text>
        </Pressable>
      </View>
      <HeartButton disabled={likePending} liked={c.iLiked} count={c.likeCount} onToggle={() => onHeart(c)} size={18} />
    </Pressable>
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
    maxHeight: "86%",
  },
  grabber: {
    alignSelf: "center", width: 38, height: 4, borderRadius: 2,
    backgroundColor: colors.wash, marginBottom: 10,
  },
  heading: { marginBottom: 12 },
  center: { paddingVertical: 32, alignItems: "center" },
  list: { flexGrow: 0 },
  listInner: { paddingBottom: 8, gap: 16 },
  thread: { gap: 12 },
  replyIndent: { paddingLeft: 34 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bubble: { flex: 1 },
  who: { ...type.small, fontWeight: "700", color: colors.ink, marginBottom: 2 },
  body: { color: colors.ink },
  replyBtn: { marginTop: 4, alignSelf: "flex-start" },
  replyText: { ...type.micro, fontWeight: "700", color: colors.mute },
  replyBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.wash, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 10,
  },
  replyBarText: { flex: 1, ...type.small, color: colors.mute, fontWeight: "600" },
  replyBarX: { fontSize: 14, color: colors.mute, paddingHorizontal: 4 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 10 },
  input: {
    flex: 1, minHeight: 42, maxHeight: 120,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.md, backgroundColor: colors.wash,
    color: colors.ink, fontSize: 15,
  },
  inputOver: { borderWidth: 1, borderColor: colors.red },
  send: {
    paddingHorizontal: 16, paddingVertical: 11,
    borderRadius: 999, backgroundColor: colors.primaryFill,
  },
  sendOff: { opacity: 0.4 },
  sendText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  overText: { color: colors.redText, fontSize: 12, marginTop: 6, textAlign: "right" },
});
