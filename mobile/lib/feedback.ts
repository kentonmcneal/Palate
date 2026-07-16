// In-app feedback: writes a structured row to public.feedback (+ an optional
// screenshot to the private 'feedback' storage bucket). Replaces the old
// mailto: links so reports land somewhere we can export in one shot.
//
// See supabase/migrations/0034_feedback.sql and supabase/scripts/export-feedback.ts.

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { supabase } from "./supabase";

export type FeedbackCategory = "bug" | "idea" | "confusing" | "love" | "other";

export const FEEDBACK_CATEGORIES: { key: FeedbackCategory; label: string; emoji: string }[] = [
  { key: "bug", label: "Something's broken", emoji: "🐞" },
  { key: "idea", label: "I have an idea", emoji: "💡" },
  { key: "confusing", label: "This confused me", emoji: "🤔" },
  { key: "love", label: "I love this", emoji: "❤️" },
];

export async function submitFeedback(input: {
  category: FeedbackCategory;
  message: string;
  screenshotUri?: string | null;
  route?: string | null;
}): Promise<void> {
  const message = input.message.trim();
  if (!message) throw new Error("Add a little detail so we can act on it.");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in to send feedback.");

  // Optional screenshot -> private bucket, one folder per user (matches the
  // avatar upload pattern: RN needs the arrayBuffer, not a bare file:// blob).
  let screenshotPath: string | null = null;
  if (input.screenshotUri) {
    const ext = (input.screenshotUri.split(".").pop() || "jpg").toLowerCase().slice(0, 4);
    const path = `${user.id}/${Date.now()}.${ext}`;
    const resp = await fetch(input.screenshotUri);
    const buf = await resp.arrayBuffer();
    const { error: upErr } = await supabase.storage.from("feedback").upload(path, buf, {
      contentType: ext === "png" ? "image/png" : "image/jpeg",
      upsert: false,
    });
    if (upErr) throw upErr;
    screenshotPath = path;
  }

  const { error } = await supabase.from("feedback").insert({
    user_id: user.id,
    category: input.category,
    message,
    screenshot_path: screenshotPath,
    app_version: Constants.expoConfig?.version ?? null,
    platform: Platform.OS,
    device: Device.modelName ?? null,
    os_version: String(Platform.Version ?? ""),
    context: { route: input.route ?? null, email: user.email ?? null },
  });
  if (error) throw error;
}
