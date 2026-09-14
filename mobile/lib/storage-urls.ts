// ============================================================================
// storage-urls.ts — meal photos live in a private bucket now.
// ----------------------------------------------------------------------------
// `visit-photos` was a PUBLIC bucket, and an unauthenticated caller holding the
// anon key that ships inside the binary could list it — and list `avatars`,
// which returned user UUIDs. A photograph of your dinner, with a place and a
// time attached, is not a profile picture, so 0167 made that bucket private.
//
// Private means a URL has to be SIGNED, and a signed URL expires. So:
//
//   • store the PATH, not a URL. A stored URL is a stored secret with a
//     deadline, and a row that outlives its signature is a broken image
//     nobody can explain.
//   • sign on read, and cache the result in memory for less than its lifetime
//     so a feed of twenty photos is not twenty round trips.
//
// Handles a legacy public URL too. There are zero of those today — which is
// exactly why this was the moment to do it — but a migration that assumes its
// own table is empty is a migration waiting to be wrong.
// ============================================================================
import { supabase } from "./supabase";

const BUCKET = "visit-photos";
/** Supabase's signature lifetime, in seconds. */
const SIGN_TTL_S = 60 * 60;
/** Cache for less than the signature lives, so a cached URL is never a dead
 *  one. Ten minutes of slack covers a screen left open. */
const CACHE_TTL_MS = (SIGN_TTL_S - 600) * 1000;

const cache = new Map<string, { url: string; at: number }>();

/**
 * The storage PATH inside visit-photos, from whatever is stored in the column.
 * Returns null for anything that is not ours to sign.
 */
export function visitPhotoPath(stored: string | null | undefined): string | null {
  if (!stored) return null;
  // Already a path: "<uid>/<visit>-<ts>.jpg"
  if (!stored.startsWith("http")) return stored;
  // Legacy full URL, public or signed.
  const m = new RegExp(`/object/(?:public|sign)/${BUCKET}/([^?]+)`).exec(stored);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * A URL the app can actually render. Silent and best-effort: a photo that
 * cannot be signed renders as no photo, which every caller already handles,
 * rather than throwing inside a list.
 */
export async function signedVisitPhoto(stored: string | null | undefined): Promise<string | null> {
  const path = visitPhotoPath(stored);
  if (!path) return null;

  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.url;

  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_S);
    if (error || !data?.signedUrl) return null;
    cache.set(path, { url: data.signedUrl, at: Date.now() });
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Sign a batch, in parallel, for a screen that renders several at once. */
export async function signedVisitPhotos(
  stored: Array<string | null | undefined>,
): Promise<Array<string | null>> {
  return Promise.all(stored.map((s) => signedVisitPhoto(s)));
}
