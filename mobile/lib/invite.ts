// ============================================================================
// invite.ts — asking somebody to bring a friend, which the app never did.
// ----------------------------------------------------------------------------
// There was a share sheet for a Wrapped image and nothing else: no code, no
// link, no record of who arrived because of whom. For an app whose
// recommendations lean on the people you follow, an empty graph is the worst
// state it can be in, and nothing in the product ever tried to fix it.
//
// A code is not a key. The invite-only gate went away in migration 0061, so
// nobody is kept out without one and nobody gets in faster with one. It does
// two things: it records the referral, and it hands a brand-new account
// somebody to follow on day one instead of an empty feed.
// ============================================================================

import { supabase } from "./supabase";
import { track } from "./analytics";

/** Where a person without the app is sent. External TestFlight group. */
export const INVITE_URL = "https://testflight.apple.com/join/GYadZcZw";

export type InviteSummary = { code: string; joined: number };

export type Inviter = {
  id: string;
  displayName: string | null;
  username: string | null;
};

/** Your code, and how many people have joined with it. Null when signed out
 *  or when the read fails: an invite card that cannot load is not worth an
 *  error state on a profile. */
export async function inviteSummary(): Promise<InviteSummary | null> {
  try {
    const { data, error } = await supabase.rpc("invite_summary");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.code) return null;
    return { code: String(row.code), joined: Number(row.joined ?? 0) };
  } catch {
    return null;
  }
}

/**
 * Claim somebody's code. Returns the inviter so the caller can offer to
 * follow them, or null when the code is unknown, is your own, or you have
 * already been attributed to someone. Set once, on purpose: a referral is a
 * fact about how you arrived, and a rewritable one would be worthless as a
 * record and farmable as a way to collect follows.
 */
export async function redeemInvite(code: string): Promise<Inviter | null> {
  const clean = normalizeCode(code);
  if (!clean) return null;
  try {
    const { data, error } = await supabase.rpc("redeem_invite", { p_code: clean });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.inviter_id) return null;
    void track("invite_redeemed");
    return {
      id: String(row.inviter_id),
      displayName: row.display_name ?? null,
      username: row.username ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Codes get typed by hand, so lowercase, spaces and stray punctuation are all
 * forgiven. Nothing is SUBSTITUTED: the generator's alphabet already excludes
 * I, O, 0 and 1 precisely so the ambiguous pairs never occur, and guessing
 * that a typed "O" meant something else would silently redeem a different
 * person's code. An unmatched code is told it is unmatched.
 */
export function normalizeCode(raw: string): string | null {
  const cleaned = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * What gets shared. The name of a real place they would recognise beats a
 * feature list: "I have been logging where I eat" is a thing a friend
 * answers, and a paragraph about passive capture is not.
 */
export function shareText(code: string, displayName?: string | null): string {
  const who = displayName?.trim() ? `${displayName.trim()} is on` : "I am on";
  return [
    `${who} Palate, which quietly notices the restaurants you go to and learns what you actually like.`,
    "",
    `Invite code: ${code}`,
    INVITE_URL,
  ].join("\n");
}

/** "3 friends", "1 friend", or null when nobody has joined yet, so a fresh
 *  account is not shown a zero. */
export function joinedLine(joined: number): string | null {
  if (!Number.isFinite(joined) || joined <= 0) return null;
  return `${joined} ${joined === 1 ? "person has" : "people have"} joined with your code`;
}
