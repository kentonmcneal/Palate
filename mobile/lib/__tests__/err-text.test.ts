import { errText } from "../../../supabase/functions/_shared/err-text";

// The bug this file exists to prevent: the push drain returned HTTP 500
// {"error":"[object Object]"} twenty-one times in six hours on 2026-09-14.
// The failure was perfectly visible and completely undiagnosable.
describe("errText never renders an error as [object Object]", () => {
  const cases: Record<string, unknown> = {
    "PostgrestError shape": {
      message: "permission denied for table push_outbox",
      code: "42501",
      details: null,
      hint: null,
    },
    "StorageError shape": { message: "Object not found", statusCode: "404" },
    "plain object": { foo: 1 },
    "empty object": {},
    "array": [1, 2],
    "number": 42,
    "boolean": false,
  };
  for (const [name, value] of Object.entries(cases)) {
    it(`handles a ${name}`, () => {
      expect(errText(value)).not.toContain("[object Object]");
      expect(errText(value).length).toBeGreaterThan(0);
    });
  }
});

describe("errText keeps the part you can act on", () => {
  it("leads with the message and includes the code for a PostgrestError", () => {
    const out = errText({ message: "permission denied", code: "42501", details: "", hint: "" });
    expect(out).toContain("permission denied");
    expect(out).toContain("42501");
  });

  // The class is half the diagnosis. Checking `message` before `instanceof
  // Error` would silently drop the name, which is why gmail-import had
  // already hand-rolled this behaviour.
  it("keeps the name of a real Error", () => {
    expect(errText(new TypeError("x is not a function"))).toBe("TypeError: x is not a function");
  });

  it("does not invent a name for a bare string", () => {
    expect(errText("Unauthorized")).toBe("Unauthorized");
  });

  it("says something useful for null and undefined", () => {
    expect(errText(null)).toBe("unknown");
    expect(errText(undefined)).toBe("unknown");
  });

  // An empty object must not fall through to Object.prototype.toString, which
  // returns the very string this module exists to eliminate.
  it("names the type instead of emitting [object Object] for an empty error", () => {
    const out = errText({});
    expect(out).not.toContain("[object Object]");
    expect(out).toContain("Object");
    expect(out).toContain("no message");
  });

  it("survives a circular object", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => errText(a)).not.toThrow();
  });
});
