// ============================================================================
// menu-items.ts — restaurant menu item catalog + per-user reactions.
// ----------------------------------------------------------------------------
// Three operations the UI needs:
//   • listForRestaurant(restaurant_id)  — populates the "What did you get?" sheet
//   • upsertItem(restaurant_id, name)   — adds a new item (user-contributed)
//   • rateItem(item_id, visit_id, rating) — writes a Loved/OK/Not for me row
// Plus:
//   • myRatingsForRestaurant(restaurant_id) — surfaces "Your items here" block
//   • topItemsForRestaurant(restaurant_id)  — surfaces aggregate "what people loved"
// ============================================================================

import { supabase } from "./supabase";
import { invalidatePersonalSignal } from "./personal-signal";

export type ItemRating = "loved" | "ok" | "not_for_me";

export type MenuItem = {
  id: string;
  restaurant_id: string;
  name: string;
  category: string | null;
  visit_count: number;
};

export type MenuItemSummary = MenuItem & {
  loved_count: number;
  ok_count: number;
  not_for_me_count: number;
  rating_count: number;
};

export type MyItemRating = {
  rating: ItemRating;
  created_at: string;
  item: { id: string; name: string; restaurant_id: string };
};

// ----------------------------------------------------------------------------
// Read
// ----------------------------------------------------------------------------

export async function listForRestaurant(restaurantId: string, limit = 50): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, restaurant_id, name, category, visit_count")
    .eq("restaurant_id", restaurantId)
    .order("visit_count", { ascending: false })
    .order("name", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MenuItem[];
}

export async function topItemsForRestaurant(restaurantId: string, limit = 5): Promise<MenuItemSummary[]> {
  const { data, error } = await supabase
    .from("menu_item_summary")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("loved_count", { ascending: false })
    .order("rating_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MenuItemSummary[];
}

export async function myRatingsForRestaurant(restaurantId: string): Promise<MyItemRating[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("menu_item_ratings")
    .select("rating, created_at, item:menu_items!inner(id, name, restaurant_id)")
    .eq("user_id", user.id)
    .eq("item.restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  // De-dup to most recent rating per item — earlier rows are history.
  const seen = new Set<string>();
  const out: MyItemRating[] = [];
  for (const row of (data ?? []) as any[]) {
    const item = Array.isArray(row.item) ? row.item[0] : row.item;
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ rating: row.rating, created_at: row.created_at, item });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Write
// ----------------------------------------------------------------------------

/** Returns the existing row if one matches by name (case-insensitive). */
export async function upsertItem(restaurantId: string, name: string, category?: string | null): Promise<MenuItem> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Item name required");
  const normalized = trimmed.toLowerCase();

  const { data: existing } = await supabase
    .from("menu_items")
    .select("id, restaurant_id, name, category, visit_count")
    .eq("restaurant_id", restaurantId)
    .eq("name_normalized", normalized)
    .maybeSingle();
  if (existing) return existing as MenuItem;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("menu_items")
    .insert({
      restaurant_id: restaurantId,
      name: trimmed,
      name_normalized: normalized,
      category: category ?? null,
      created_by: user.id,
      source: "user",
    })
    .select("id, restaurant_id, name, category, visit_count")
    .single();
  if (error) throw error;
  return data as MenuItem;
}

export async function rateItem(opts: {
  menuItemId: string;
  visitId?: string | null;
  rating: ItemRating;
  notes?: string | null;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase.from("menu_item_ratings").insert({
    user_id: user.id,
    menu_item_id: opts.menuItemId,
    visit_id: opts.visitId ?? null,
    rating: opts.rating,
    notes: opts.notes ?? null,
  });
  if (error) throw error;
  // The next scoring pass should reflect this rating — bust the cache.
  invalidatePersonalSignal();
}

/** Convenience for the post-visit flow: create item + rating in one call. */
export async function addAndRate(opts: {
  restaurantId: string;
  visitId?: string | null;
  name: string;
  rating: ItemRating;
}): Promise<MenuItem> {
  const item = await upsertItem(opts.restaurantId, opts.name);
  await rateItem({ menuItemId: item.id, visitId: opts.visitId ?? null, rating: opts.rating });
  return item;
}
