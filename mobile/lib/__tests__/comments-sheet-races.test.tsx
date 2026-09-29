import React from "react";
import { Alert } from "react-native";
const { create, act } = require("react-test-renderer");
import { blockUser } from "../moderation";
import { CommentsSheet } from "../../components/CommentsSheet";
import { listComments, addComment, deleteComment, toggleCommentLike } from "../feed-comments";

jest.mock("../../components/FeedAvatar", () => ({ FeedAvatar: () => null }));
jest.mock("../../components/HeartButton", () => ({ HeartButton: (props: any) => require("react").createElement(require("react-native").Pressable, { accessibilityLabel: "comment heart", onPress: props.onToggle, disabled: props.disabled, accessibilityState: { selected: props.liked }, accessibilityValue: { text: String(props.count) } }) }));
jest.mock("../haptics", () => ({ triggerHapticSuccess: jest.fn() }));
jest.mock("../moderation", () => ({ reportContent: jest.fn(), blockUser: jest.fn(), REPORT_REASONS: [] }));
jest.mock("../feed-comments", () => ({
  listComments: jest.fn(), addComment: jest.fn(), deleteComment: jest.fn(), toggleCommentLike: jest.fn(),
  threadComments: (rows: any[]) => rows.map(comment => ({ comment, replies: [] })),
  COMMENT_MAX_LENGTH: 500,
}));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function row(id: string, event: string) {
  return { id, feedEventId: event, parentId: null, userId: "fixture", body: id, createdAt: "2026-01-01", likeCount: 0, iLiked: false, replyCount: 0, author: { displayName: "Fixture", username: null, avatarUrl: null }, canDelete: true };
}
const props = { visible: true, onClose: jest.fn(), onCountChange: jest.fn(), onBlockedUser: jest.fn() };
const input = (tree: any) => tree.root.findAll((x: any) => x.props.placeholder === "Add a comment" && typeof x.props.onChangeText === "function")[0];
const post = (tree: any) => tree.root.findAll((x: any) => x.props.accessibilityLabel === "Post comment" && typeof x.props.onPress === "function")[0];
let tree: any;
beforeEach(() => { jest.resetAllMocks(); jest.spyOn(Alert, "alert").mockImplementation(() => {}); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; jest.restoreAllMocks(); });

test("late post A load cannot replace post B comments", async () => {
  const a = deferred<any[]>(), b = deferred<any[]>();
  (listComments as jest.Mock).mockImplementation((id: string) => id === "A" ? a.promise : b.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  await act(async () => { tree.update(<CommentsSheet {...props} eventId="B" />); });
  await act(async () => b.resolve([row("B-only", "B")]));
  await act(async () => a.resolve([row("A-stale", "A")]));
  expect(JSON.stringify(tree.toJSON())).toContain("B-only");
  expect(JSON.stringify(tree.toJSON())).not.toContain("A-stale");
  expect(props.onCountChange).toHaveBeenLastCalledWith("B", 1);
});
test("a pending send on A does not block B or show its old error", async () => {
  (listComments as jest.Mock).mockResolvedValue([]);
  const sending = deferred<any>();
  (addComment as jest.Mock).mockReturnValue(sending.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  await act(async () => input(tree).props.onChangeText("draft A"));
  await act(async () => { void post(tree).props.onPress(); });
  await act(async () => { tree.update(<CommentsSheet {...props} eventId="B" />); });
  await act(async () => input(tree).props.onChangeText("draft B"));
  expect(post(tree).props.disabled).toBe(false);
  await act(async () => sending.reject(new Error("old failure")));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(input(tree).props.value).toBe("draft B");
});
test("posting is disabled until the initial list arrives", async () => {
  const pending = deferred<any[]>();
  (listComments as jest.Mock).mockReturnValue(pending.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  await act(async () => input(tree).props.onChangeText("draft"));
  expect(post(tree).props.disabled).toBe(true);
  await act(async () => { void post(tree).props.onPress(); });
  expect(addComment).not.toHaveBeenCalled();
  await act(async () => pending.resolve([]));
  expect(post(tree).props.disabled).toBe(false);
});

test("two heart presses before rerender issue only one mutation", async () => {
  (listComments as jest.Mock).mockResolvedValue([row("comment-A", "A")]);
  const pending = deferred<void>();
  (toggleCommentLike as jest.Mock).mockReturnValue(pending.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  const heart = tree.root.findAll((x: any) => x.props.accessibilityLabel === "comment heart" && typeof x.props.onPress === "function")[0];
  await act(async () => { heart.props.onPress(); heart.props.onPress(); });
  expect(toggleCommentLike).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
});

const show = async (id: string) => act(async () => { tree.update(<CommentsSheet {...props} eventId={id} />); });
const startSend = async (body: string) => {
  await act(async () => input(tree).props.onChangeText(body));
  await act(async () => { void post(tree).props.onPress(); });
};
const contents = () => JSON.stringify(tree.toJSON());
const choose = (title: string, label: string) => {
  const call = (Alert.alert as jest.Mock).mock.calls.filter(args => args[0] === title).pop();
  call[2].find((button: any) => button.text === label).onPress();
};
async function startMenuAction(action: "Delete" | "Block this person") {
  await act(async () => {
    tree.root.findAll((x: any) => typeof x.props.onLongPress === "function")[0].props.onLongPress();
    choose("Comment", action);
    choose(action === "Delete" ? "Delete comment?" : "Block?", action === "Delete" ? "Delete" : "Block");
  });
}

test.each(["success", "failure"])("old A send %s cannot own a newer A send after A-B-A", async outcome => {
  (listComments as jest.Mock).mockResolvedValue([]);
  const old = deferred<any>(), newer = deferred<any>();
  (addComment as jest.Mock).mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  await startSend("old draft");
  await show("B"); await show("A");
  await startSend("new draft");
  await act(async () => outcome === "success" ? old.resolve(row("old-created", "A")) : old.reject(new Error("old")));
  expect(input(tree).props.value).toBe("new draft");
  expect(input(tree).props.editable).toBe(false);
  expect(post(tree).props.disabled).toBe(true);
  expect(Alert.alert).not.toHaveBeenCalled();
  if (outcome === "success") expect(contents()).toContain("old-created");
  await act(async () => newer.resolve(row("new-created", "A")));
  expect(contents()).toContain("new-created");
  expect(input(tree).props.value).toBe("");
  expect(input(tree).props.editable).toBe(true);
  expect(props.onCountChange).toHaveBeenLastCalledWith("A", outcome === "success" ? 2 : 1);
});

test("reopened like settlement preserves a concurrent send without replacing the list", async () => {
  (listComments as jest.Mock).mockResolvedValue([row("original", "A")]);
  const like = deferred<void>(), send = deferred<any>();
  (toggleCommentLike as jest.Mock).mockReturnValue(like.promise);
  (addComment as jest.Mock).mockReturnValue(send.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  await act(async () => tree.root.findAll((x: any) => x.props.accessibilityLabel === "comment heart")[0].props.onPress());
  await show("B"); await show("A");
  await startSend("new draft");
  await act(async () => like.resolve());
  await act(async () => send.resolve(row("sent", "A")));
  expect(contents()).toContain("sent");
  expect(props.onCountChange).toHaveBeenLastCalledWith("A", 2);
  expect(listComments).toHaveBeenCalledTimes(3);
  const heart = tree.root.findAll((x: any) => x.props.accessibilityLabel === "comment heart")[0];
  expect(heart.props.accessibilityState.selected).toBe(true);
  expect(heart.props.accessibilityValue.text).toBe("1");
});

test.each(["before-missing", "before-present", "after"])("old send finishes %s reopened snapshot without being lost or duplicated", async order => {
  const old = deferred<any>(), snapshot = deferred<any[]>();
  (listComments as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockReturnValueOnce(snapshot.promise);
  (addComment as jest.Mock).mockReturnValue(old.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  await startSend("old"); await show("B"); await show("A");
  if (order !== "after") {
    await act(async () => old.resolve(row("saved", "A")));
    await act(async () => snapshot.resolve(order === "before-present" ? [row("saved", "A")] : []));
  } else {
    await act(async () => snapshot.resolve([]));
    await act(async () => input(tree).props.onChangeText("keep draft"));
    await act(async () => old.resolve(row("saved", "A")));
    expect(input(tree).props.value).toBe("keep draft");
  }
  expect(contents()).toContain("saved");
  expect(props.onCountChange).toHaveBeenLastCalledWith("A", 1);
});

test.each(["before", "after"])("delete completes %s reopened stale snapshot and preserves unrelated send", async order => {
  const parent = row("remove-parent", "A");
  const reply = { ...row("remove-reply", "A"), parentId: parent.id };
  const deletion = deferred<boolean>(), snapshot = deferred<any[]>(), send = deferred<any>();
  (listComments as jest.Mock).mockResolvedValueOnce([parent, reply]).mockResolvedValueOnce([]).mockReturnValueOnce(snapshot.promise);
  (deleteComment as jest.Mock).mockReturnValue(deletion.promise);
  (addComment as jest.Mock).mockReturnValue(send.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  await startSend("unrelated"); await startMenuAction("Delete");
  await show("B"); await show("A");
  await act(async () => send.resolve(row("keep-created", "A")));
  if (order === "before") await act(async () => deletion.resolve(true));
  await act(async () => snapshot.resolve([parent, reply]));
  if (order === "after") await act(async () => deletion.resolve(true));
  expect(contents()).not.toContain("remove-parent");
  expect(contents()).not.toContain("remove-reply");
  expect(contents()).toContain("keep-created");
  expect(props.onCountChange).toHaveBeenLastCalledWith("A", 1);
});

test.each(["Delete", "Block this person"] as const)("late %s failure does not alert on B", async action => {
  const pending = deferred<any>();
  (listComments as jest.Mock).mockResolvedValue([row("original", "A")]);
  (deleteComment as jest.Mock).mockReturnValue(pending.promise);
  (blockUser as jest.Mock).mockReturnValue(pending.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  await startMenuAction(action); await show("B");
  (Alert.alert as jest.Mock).mockClear();
  await act(async () => pending.reject(new Error("old failure")));
  expect(Alert.alert).not.toHaveBeenCalled();
});

test("block completion filters a reopened stale snapshot while preserving other authors", async () => {
  const blocked = row("blocked-comment", "A"), kept = { ...row("keep-author", "A"), userId: "other" };
  const pending = deferred<void>(), snapshot = deferred<any[]>();
  (listComments as jest.Mock).mockResolvedValueOnce([blocked, kept]).mockResolvedValueOnce([]).mockReturnValueOnce(snapshot.promise);
  (blockUser as jest.Mock).mockReturnValue(pending.promise);
  await act(async () => { tree = create(<CommentsSheet {...props} eventId="A" />); });
  await startMenuAction("Block this person"); await show("B"); await show("A");
  await act(async () => pending.resolve());
  await act(async () => snapshot.resolve([blocked, kept]));
  expect(contents()).not.toContain("blocked-comment");
  expect(contents()).toContain("keep-author");
  expect(props.onCountChange).toHaveBeenLastCalledWith("A", 1);
  expect(props.onBlockedUser).toHaveBeenCalledWith("fixture");
});
