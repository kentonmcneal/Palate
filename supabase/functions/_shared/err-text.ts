// Palate — turn anything thrown into something a human can act on.
//
// WHY THIS EXISTS
//
// `String(e)` is the obvious way to put an error in a JSON response, and it is
// silently wrong for the errors these functions actually throw. A
// PostgrestError is a plain object with no custom `toString`, so `String(e)`
// produces the literal text "[object Object]".
//
// On 2026-09-14 the push drain was found returning HTTP 500
// {"error":"[object Object]"} twenty-one times in six hours. The failure was
// perfectly visible and completely undiagnosable, and it had been that way for
// at least as long as the retained logs went back. An error that costs nothing
// to record and says nothing is worse than no error handling at all: it looks
// handled.
//
// So: prefer the fields that identify a Postgrest/Supabase error, fall back to
// Error's name and message, and only then to a structural dump.

export function errText(e: unknown): string {
  if (e == null) return "unknown";
  if (typeof e === "string") return e;
  const o = e as Record<string, unknown>;
  // Real Errors first. Checking the message field before this would drop the
  // name, and "Timeout of 5000 ms reached" is a materially worse line to find
  // in a log than "TypeError: Timeout of 5000 ms reached" — the class is half
  // the diagnosis, which is why gmail-import had already written this by hand.
  if (e instanceof Error) {
    const code = typeof o.code === "string" && o.code ? ` | ${o.code}` : "";
    return `${e.name}: ${e.message}${code}`;
  }
  // PostgrestError, StorageError, FunctionsError: plain objects, no custom
  // toString. Message plus the fields that say WHICH failure it was; `code` is
  // the part you can actually look up.
  const parts = [o.message, o.code, o.details, o.hint]
    .filter((v) => typeof v === "string" && v.length > 0);
  if (parts.length) return parts.join(" | ");
  try {
    const j = JSON.stringify(e);
    if (j && j !== "{}") return j;
  } catch {
    // Circular or non-serialisable. Fall through.
  }
  // Last resort. NOT Object.prototype.toString.call(e), which for a plain
  // object returns the literal "[object Object]" — the exact string this
  // module exists to stop appearing in logs. Name the type and say plainly
  // that it carried nothing, so the next reader knows the error was empty
  // rather than that the formatter gave up.
  const tag = Object.prototype.toString.call(e).slice(8, -1);
  const ctor = (e as { constructor?: { name?: string } })?.constructor?.name;
  const what = ctor && ctor !== tag ? `${ctor} (${tag})` : tag;
  return `unreportable ${what}: no message, code, or serialisable fields`;
}
