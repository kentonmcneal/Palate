import { readFunctionError } from "../function-error";

// Connecting Gmail failed on a real device with "Edge Function returned a
// non-2xx status code", which could have meant any of three unrelated
// problems. supabase-js puts the function's real reply on error.context and
// almost every call site discards it.
function invokeError(status: number, body: unknown) {
  return {
    message: "Edge Function returned a non-2xx status code",
    context: new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  };
}

describe("readFunctionError", () => {
  it("reads the reason and the detail our functions actually send", async () => {
    const text = await readFunctionError(invokeError(502, {
      error: "google_token_exchange_failed",
      detail: "invalid_grant: redirect_uri mismatch",
    }));
    expect(text).toContain("[502]");
    expect(text).toContain("google_token_exchange_failed");
    expect(text).toContain("redirect_uri mismatch");
  });

  it("includes the hint when there is one", async () => {
    const text = await readFunctionError(invokeError(400, {
      error: "no_refresh_token",
      hint: "User must consent again with prompt=consent",
    }));
    expect(text).toContain("no_refresh_token");
    expect(text).toContain("prompt=consent");
  });

  it("does not repeat a reason that appears twice", async () => {
    const text = await readFunctionError(invokeError(500, { error: "boom", message: "boom" }));
    expect(text).toBe("[500] boom");
  });

  it("uses no em dash, because this lands in an alert", async () => {
    const text = await readFunctionError(invokeError(502, { error: "a", detail: "b" }));
    expect(text).not.toMatch(/—/);
  });

  it("falls back rather than throwing on anything unexpected", async () => {
    const generic = "Edge Function returned a non-2xx status code";
    expect(await readFunctionError(invokeError(500, ""))).toBe(`[500] ${generic}`);
    expect(await readFunctionError({ message: generic })).toBe(generic);
    expect(await readFunctionError(null)).toBe("Something went wrong");
    // Not JSON: the raw text still beats the generic sentence.
    expect(await readFunctionError(invokeError(500, "upstream timeout"))).toBe("[500] upstream timeout");
  });
});

// The first version computed the status tag AFTER the shape check, so an
// error whose context was not a Response came back with no tag at all and
// read exactly like an unhandled failure.
describe("the status survives a context that is not a Response", () => {
  it("keeps the tag when the body cannot be read", async () => {
    const text = await readFunctionError({
      message: "Edge Function returned a non-2xx status code",
      context: { status: 500 },
    });
    expect(text).toBe("[500] Edge Function returned a non-2xx status code");
  });

  it("says something useful when there is no context at all", async () => {
    const text = await readFunctionError({ message: "boom" });
    expect(text).toBe("boom");
  });
});
