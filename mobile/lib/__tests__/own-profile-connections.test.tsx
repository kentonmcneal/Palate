import React from "react";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
const { create, act } = require("react-test-renderer");
import { useRouter } from "expo-router";
import { supabase } from "../supabase";
import { ProfileBody } from "../../components/ProfileBody";
import { OwnProfileConnections } from "../../components/OwnProfileConnections";
import MyProfileScreen from "../../app/(tabs)/me";

// Mount the real owner screen and connections component; isolate services,
// native capture and the shared profile body (its contract has separate tests).
jest.mock("expo-router", () => ({ useRouter: jest.fn() }));
jest.mock("../supabase", () => ({ supabase: { auth: { getUser: jest.fn() } } }));
jest.mock("../../components/ProfileBody", () => ({ ProfileBody: () => null }));
jest.mock("../../components/CaptureWarning", () => ({
  useCaptureStatus: () => null,
  useCaptureFix: () => jest.fn(),
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

let tree: ReactTestRenderer | null = null;
const push = jest.fn();
const ownerId = "fixture-owner";
const getUser = supabase.auth.getUser as jest.Mock;

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : textOf(child)).join("");
}

// RN memo-wraps Pressable; query its semantic role and actionable handler,
// rather than depending on that internal component identity.
function controls(role: "button" | "tab") {
  return tree!.root.findAll((node) =>
    node.props.accessibilityRole === role && typeof node.props.onPress === "function",
  );
}

function buttonNamed(name: string, role: "button" | "tab" = "button"): ReactTestInstance {
  const found = controls(role).filter((node) =>
    (node.props.accessibilityLabel === name || textOf(node).includes(name)),
  );
  expect(found).toHaveLength(1);
  return found[0];
}

async function mount(element: React.ReactElement) {
  await act(async () => { tree = create(element); });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ push });
  getUser.mockResolvedValue({ data: { user: { id: ownerId } }, error: null });
  // Unexpected fetches fail the test instead of touching a real service.
  jest.spyOn(global, "fetch").mockImplementation(() => {
    throw new Error("Network is forbidden in owner-profile navigation tests");
  });
});

afterEach(async () => {
  try {
    if (tree) await act(async () => { tree!.unmount(); });
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {
    tree = null;
    jest.restoreAllMocks();
  }
});

const destinations = [
  ["Find people", "/people"],
  ["Friends", { pathname: "/follows", params: { tab: "friends" } }],
  ["Following", { pathname: "/follows", params: { tab: "following" } }],
  ["Followers", { pathname: "/follows", params: { tab: "followers" } }],
  ["Choose profile content", "/curate-profile"],
  ["Review profile visibility", "/edit-profile"],
] as const;

test.each(destinations)("%s opens its existing destination without a data request", async (label, destination) => {
  await mount(<OwnProfileConnections />);
  expect(controls("button")).toHaveLength(6);
  await act(async () => { buttonNamed(label).props.onPress(); });
  expect(push).toHaveBeenCalledTimes(1);
  // Exact comparison also prevents accidentally adding another user's ID.
  expect(push).toHaveBeenCalledWith(destination);
  expect(getUser).not.toHaveBeenCalled();
});

test("the mounted owner switches to Connections and back, preserving owner identity", async () => {
  await mount(<MyProfileScreen />);
  expect(getUser).toHaveBeenCalledTimes(1);
  expect(tree!.root.findByType(ProfileBody).props.targetId).toBe(ownerId);
  expect(tree!.root.findAllByType(OwnProfileConnections)).toHaveLength(0);
  expect(buttonNamed("My profile", "tab").props.accessibilityState.selected).toBe(true);
  expect(buttonNamed("Connections", "tab").props.accessibilityState.selected).toBe(false);

  await act(async () => { buttonNamed("Connections", "tab").props.onPress(); });
  expect(tree!.root.findAllByType(ProfileBody)).toHaveLength(0);
  expect(tree!.root.findAllByType(OwnProfileConnections)).toHaveLength(1);
  expect(buttonNamed("My profile", "tab").props.accessibilityState.selected).toBe(false);
  expect(buttonNamed("Connections", "tab").props.accessibilityState.selected).toBe(true);
  await act(async () => { buttonNamed("Find people").props.onPress(); });
  expect(push).toHaveBeenCalledWith("/people");

  await act(async () => { buttonNamed("My profile", "tab").props.onPress(); });
  expect(tree!.root.findAllByType(OwnProfileConnections)).toHaveLength(0);
  expect(tree!.root.findByType(ProfileBody).props.targetId).toBe(ownerId);
  expect(buttonNamed("My profile", "tab").props.accessibilityState.selected).toBe(true);
  expect(buttonNamed("Connections", "tab").props.accessibilityState.selected).toBe(false);
  expect(getUser).toHaveBeenCalledTimes(1);
  // Local tab changes must not add router entries.
  expect(push).toHaveBeenCalledTimes(1);
});

test("pending authentication does not expose owner profile or connection actions", async () => {
  let resolve!: (value: { data: { user: { id: string } }; error: null }) => void;
  getUser.mockReturnValue(new Promise((done) => { resolve = done; }));
  await mount(<MyProfileScreen />);
  expect(tree!.root.findAllByType(ProfileBody)).toHaveLength(0);
  expect(tree!.root.findAllByType(OwnProfileConnections)).toHaveLength(0);
  expect(controls("tab")).toHaveLength(0);
  await act(async () => { resolve({ data: { user: { id: ownerId } }, error: null }); });
  expect(tree!.root.findByType(ProfileBody).props.targetId).toBe(ownerId);
});

test("signed-out users have no owner tabs or connection actions", async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  await mount(<MyProfileScreen />);
  expect(tree!.root.findAllByType(ProfileBody)).toHaveLength(0);
  expect(tree!.root.findAllByType(OwnProfileConnections)).toHaveLength(0);
  expect(controls("tab")).toHaveLength(0);
  expect(textOf(tree!.root)).toContain("Sign in to see your profile.");
  expect(push).not.toHaveBeenCalled();
});
