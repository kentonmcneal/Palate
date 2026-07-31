/**
 * seed-review-account.ts — populate the App Store review demo account with a
 * realistic visit history so the reviewer sees Discover, profile, and Wrapped
 * with data instead of an empty app.
 *
 * Usage (service-role key stays in YOUR terminal — never commit it, never paste
 * it into chat):
 *
 *   cd supabase/scripts && npm install
 *   SUPABASE_URL=https://oxzsspbojeyeelbjqjdx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   REVIEW_EMAIL=palate.review1@gmail.com \
 *   npx tsx seed-review-account.ts
 *
 * Idempotent: it deletes the review account's existing seeded visits first, so
 * re-running gives a clean, consistent history (safe to run repeatedly).
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REVIEW_EMAIL = process.env.REVIEW_EMAIL ?? "palate.review1@gmail.com";
const NUM_VISITS = Number(process.env.NUM_VISITS ?? "18");

if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

async function findUserId(email: string): Promise<string> {
  // Page through admin users to find the review account by email.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  throw new Error(
    `No user found for ${email}. Sign in once in the app with that address first, then re-run.`,
  );
}

async function pickRestaurants(): Promise<Array<{ id: string; name: string; cuisine_type: string | null }>> {
  // Prefer discovery-eligible, cuisine-diverse real restaurants already in the DB.
  const { data, error } = await db
    .from("restaurants")
    .select("id, name, cuisine_type")
    .eq("recommendation_eligibility", 1)
    .not("cuisine_type", "is", null)
    .limit(120);
  if (error) throw error;
  if (!data?.length) throw new Error("No eligible restaurants in the DB to seed from.");

  // Spread across distinct cuisines for a believable, varied palate.
  const byCuisine = new Map<string, { id: string; name: string; cuisine_type: string | null }>();
  for (const r of data) {
    const c = r.cuisine_type ?? "other";
    if (!byCuisine.has(c)) byCuisine.set(c, r);
  }
  const diverse = [...byCuisine.values()];
  // Shuffle for variety, then take what we need (cycling if fewer cuisines than visits).
  for (let i = diverse.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [diverse[i], diverse[j]] = [diverse[j], diverse[i]];
  }
  return diverse;
}

const MEALS = ["breakfast", "lunch", "dinner"] as const;

async function main() {
  const userId = await findUserId(REVIEW_EMAIL);
  console.log(`Review user: ${REVIEW_EMAIL} → ${userId}`);

  const pool = await pickRestaurants();
  console.log(`Seeding from ${pool.length} distinct-cuisine restaurants.`);

  // Clean slate — remove any prior seeded visits for this user.
  const { error: delErr } = await db.from("visits").delete().eq("user_id", userId);
  if (delErr) throw delErr;

  // Build ~NUM_VISITS visits spread over the last 30 days, 1 per chosen day,
  // varied meals, no same-restaurant-same-day dupes.
  const rows: Array<{ user_id: string; restaurant_id: string; visited_at: string; meal_type: string }> = [];
  const now = Date.now();
  for (let i = 0; i < NUM_VISITS; i++) {
    const r = pool[i % pool.length];
    const daysAgo = Math.floor((i / NUM_VISITS) * 30) + Math.floor(Math.random() * 2);
    const hour = 8 + Math.floor(Math.random() * 12); // 8am–8pm
    const d = new Date(now - daysAgo * 86400_000);
    d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
    rows.push({
      user_id: userId,
      restaurant_id: r.id,
      visited_at: d.toISOString(),
      meal_type: hour < 11 ? "breakfast" : hour < 16 ? "lunch" : "dinner",
    });
  }

  const { error: insErr, count } = await db
    .from("visits")
    .insert(rows, { count: "exact" });
  if (insErr) throw insErr;

  console.log(`✅ Seeded ${count ?? rows.length} visits for ${REVIEW_EMAIL}.`);
  console.log("Open the app as the review account — Discover, profile, and Wrapped should now have data.");
}

main().catch((e) => {
  console.error("Seed failed:", e.message ?? e);
  process.exit(1);
});
