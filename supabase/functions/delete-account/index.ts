// ============================================================================
// delete-account — Guideline 5.1.1(v), including the photographs.
// ----------------------------------------------------------------------------
// delete_my_account() clears the rows. It cannot clear the FILES: Supabase
// refuses direct DML against storage.objects ("Direct deletion from storage
// tables is not allowed. Use the Storage API instead", 42501), so a migration
// physically cannot do this. A tidy-looking `delete from storage.objects`
// inside the RPC pushes green and then throws on the first real call, turning
// "photos survive deletion" into "deletion fails entirely". That was tried,
// and reverted in 0157.
//
// So the Storage API, from somewhere holding the service role.
//
// Server-side rather than in settings.tsx on purpose: a client-side
// list-and-remove is skippable by force-quitting halfway through, and a
// deletion you can interrupt is not a deletion.
//
// Order matters. Files first, rows second. If the row deletion fails after the
// files are gone the user is left with an account whose photos are missing,
// which is recoverable and honest. The other order leaves orphaned
// photographs of somebody's dinner with no account to trace them to, which is
// exactly what we are fixing.
// ============================================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKETS = ["avatars", "visit-photos", "feedback"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Every object under <uid>/ in one bucket, paged. */
async function removeUserFolder(admin: ReturnType<typeof createClient>, bucket: string, uid: string) {
  let removed = 0;
  // list() returns one page; a user with a lot of meal photos needs all of
  // them, and stopping at the first hundred would silently leave files behind.
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(uid, { limit: 100, offset });
    if (error || !data || data.length === 0) break;
    const paths = data.map((f) => `${uid}/${f.name}`);
    const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
    if (rmErr) throw new Error(`${bucket}: ${rmErr.message}`);
    removed += paths.length;
    if (data.length < 100) break;
  }
  return removed;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return json({ error: "missing auth" }, 401);

  // Same shape as places-proxy and gmail-import: project key authenticates the
  // request, the JWT is passed explicitly to say who is asking. Passing the
  // JWT as the api key is the bug that meant nobody could ever connect Gmail.
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser(jwt);
  if (authErr || !user) {
    return json({ error: "unauthorized", detail: authErr?.message ?? "no user for this token" }, 401);
  }
  const uid = user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const removed: Record<string, number> = {};
  try {
    for (const b of BUCKETS) removed[b] = await removeUserFolder(admin, b, uid);
  } catch (e) {
    // Refuse to proceed. Deleting the rows now would strand the files with
    // nothing left to identify them by, which is worse than not deleting yet.
    return json({ error: "storage_delete_failed", detail: String(e), removed }, 500);
  }

  // The RPC reads auth.uid(), so it has to run as the user, not as the admin.
  const { error: rpcErr } = await userClient.rpc("delete_my_account");
  if (rpcErr) return json({ error: "row_delete_failed", detail: rpcErr.message, removed }, 500);

  return json({ ok: true, removed });
});
