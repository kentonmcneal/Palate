import { toError } from "../observability";

// ============================================================================
// The reason this exists, measured in production on 2026-09-06.
// ----------------------------------------------------------------------------
// Sentry titles an issue from an Error's name and message. Handed a plain
// object it has nothing to title with, so it files everything under "Object
// captured as exception with keys: code, details, hint, message" and the real
// failure is invisible. Two of the three people who have ever used this app
// spent four days inside that one issue.
//
// Supabase is the source: its client rejects with a plain object, not an
// Error, so every unhandled Supabase rejection lands in the same bucket.
// ============================================================================

describe("toError", () => {
  it("leaves a real Error alone", () => {
    const e = new TypeError("Cannot read property 'id' of null");
    const { error, extra } = toError(e);
    expect(error).toBe(e);
    expect(extra).toEqual({});
  });

  it("turns a Supabase error into something Sentry can title", () => {
    const { error, extra } = toError({
      code: "42501",
      details: null,
      hint: "check RLS",
      message: "permission denied for table visits",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("permission denied for table visits");
    // The Postgres code is the most identifying field Supabase gives, so it
    // becomes the name and Sentry groups distinct failures separately.
    expect(error.name).toBe("SupabaseError 42501");
    expect(extra.thrown_code).toBe("42501");
    expect(extra.thrown_hint).toBe("check RLS");
  });

  it("groups two different Postgres failures apart", () => {
    const a = toError({ code: "42501", message: "permission denied" }).error;
    const b = toError({ code: "23505", message: "duplicate key" }).error;
    expect(a.name).not.toBe(b.name);
  });

  it("still says something useful for an object with no message", () => {
    const { error } = toError({ weird: 1, other: 2 });
    expect(error.message).toBe("Non-Error thrown with keys: other, weird");
  });

  it("handles the values nobody expects to be thrown", () => {
    expect(toError("boom").error.message).toBe("boom");
    expect(toError(null).error.message).toBe("Non-Error thrown: null");
    expect(toError(undefined).error.message).toBe("Non-Error thrown: undefined");
    expect(toError(42).error.message).toBe("Non-Error thrown: 42");
    expect(toError({}).error.message).toBe("Non-Error thrown with keys: none");
  });
});
