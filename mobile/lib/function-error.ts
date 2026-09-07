// ============================================================================
// function-error.ts — what the edge function actually said.
// ----------------------------------------------------------------------------
// supabase-js reports every non-2xx from an edge function as a
// FunctionsHttpError whose `message` is the fixed string "Edge Function
// returned a non-2xx status code". The function's own reply — the part that
// says WHICH thing went wrong — is on `error.context`, an unread Response
// that almost every call site throws away.
//
// Connecting Gmail failed on a real device with exactly that sentence, and it
// could have meant any of: Google rejected the code exchange, Google returned
// no refresh token, or the token failed to encrypt. Three different problems
// with three different fixes, and the app said none of them.
//
// Our functions reply with { error, detail?, hint? }, so there is always
// something better to show than the generic line.
// ============================================================================

/** Human-readable text for a supabase functions.invoke error. Never throws. */
export async function readFunctionError(error: unknown): Promise<string> {
  const fallback = (error as { message?: string } | null)?.message
    ?? "Something went wrong";

  const res = (error as { context?: unknown } | null)?.context;
  // Only a Response carries the body; other context shapes are not useful.
  if (!res || typeof (res as Response).text !== "function") return fallback;

  let raw = "";
  try {
    raw = await (res as Response).text();
  } catch {
    // Already consumed, or not readable. The generic message is all there is.
    return fallback;
  }
  if (!raw.trim()) return fallback;

  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const parts = [body.error, body.detail, body.hint, body.message]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (parts.length > 0) {
      // De-duplicated: `error` and `message` are often the same string.
      // Joined with a colon rather than a dash: this reaches an alert box.
      return [...new Set(parts)].join(": ").slice(0, 400);
    }
  } catch {
    // Not JSON. The raw text is still better than the generic sentence.
  }
  return raw.slice(0, 400);
}
