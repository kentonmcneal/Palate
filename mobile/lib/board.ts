// ============================================================================
// board.ts — the Board's data, and the words on it.
// ----------------------------------------------------------------------------
// One leaderboard of "visits this week" is a scoreboard only the leader
// enjoys. Several boards means most people lead one of them: the person who
// eats out constantly, the person who never repeats a cuisine, the person who
// has been to one place forty times, the person who got somewhere first.
//
// All four are one aggregate over visits (0119). Nothing here costs anything.
// ============================================================================

import { supabase } from "./supabase";

export type BoardCategory = "never_cooks" | "widest_net" | "deep_regular" | "first_in";
export type BoardScope = "following" | "everyone";
export type BoardWindow = "week" | "month" | "year" | "all";

export type BoardRow = {
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  value: number;
  detail: string | null;
  you: boolean;
};

export const BOARD_CATEGORIES: {
  key: BoardCategory;
  tab: string;
  title: string;
  blurb: string;
  unit: (n: number) => string;
}[] = [
  {
    key: "never_cooks",
    tab: "Never Cooks",
    title: "Never Cooks",
    blurb: "Most meals out. The kitchen is decorative.",
    unit: (n) => (n === 1 ? "visit" : "visits"),
  },
  {
    key: "widest_net",
    tab: "Widest Net",
    title: "Widest Net",
    blurb: "Most different cuisines. Never the same thing twice.",
    unit: (n) => (n === 1 ? "cuisine" : "cuisines"),
  },
  {
    key: "deep_regular",
    tab: "The Usual",
    title: "The Usual",
    blurb: "Most visits to one place. They know the order.",
    unit: (n) => (n === 1 ? "visit" : "visits"),
  },
  {
    key: "first_in",
    tab: "First In",
    title: "First In",
    blurb: "Places nobody else here has logged. The scout.",
    unit: (n) => (n === 1 ? "place" : "places"),
  },
];

export async function loadBoard(
  category: BoardCategory,
  scope: BoardScope,
  window: BoardWindow,
): Promise<BoardRow[]> {
  const { data, error } = await supabase.rpc("board_leaders", {
    p_category: category, p_scope: scope, p_window: window, p_limit: 25,
  });
  if (error) throw error;
  return (data ?? []) as BoardRow[];
}

export type RegularRow = BoardRow & { restaurant_name: string };

/** Who has been to one place the most. The founder's ask, verbatim. */
export async function loadRegulars(query: string): Promise<RegularRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc("restaurant_regulars", { p_query: q, p_limit: 25 });
  if (error) throw error;
  return (data ?? []) as RegularRow[];
}
