import * as fs from "fs";
import * as path from "path";
import { GMAIL_SCOPES } from "../gmail";

// Three attempts at Gmail OAuth failed with "Error 400: invalid_request",
// every one of them because the redirect URI was constructed by hand:
//
//   1. "palate://auth/google"                    — app scheme, not registered
//   2. makeRedirectUri({ scheme: reversedId })   — emitted TWO slashes
//   3. `${reversedId}:/oauth2redirect`           — still rejected
//
// Google sign-in worked throughout, using expo's Google provider, which knows
// Google's iOS redirect convention and never exposes it. The fix was to stop
// reasoning about URI shapes and use that provider for Gmail too.
//
// These tests guard the lesson rather than the string: if someone reintroduces
// a hand-built Google redirect, this fails before it reaches a device, where
// the symptom is invisible until a user taps Connect.

const gmailSrc = fs.readFileSync(path.join(__dirname, "..", "gmail.ts"), "utf8");

describe("Gmail OAuth", () => {
  it("does not hand-build a Google redirect URI", () => {
    expect(gmailSrc).not.toMatch(/makeRedirectUri/);
    expect(gmailSrc).not.toMatch(/com\.googleusercontent\.apps/);
  });

  it("does not raise the authorization prompt itself", () => {
    // The prompt belongs to the provider in GmailImportCard; this module only
    // exchanges the resulting code.
    expect(gmailSrc).not.toMatch(/promptAsync/);
    expect(gmailSrc).toMatch(/exchangeGmailCode/);
  });

  it("registers the URL schemes the provider's redirect can use", () => {
    // expo's Google provider builds `${bundleId}:/oauthredirect`. If that scheme
    // is not in CFBundleURLSchemes, Google accepts the request and iOS silently
    // fails to route the callback home — the app just sits there.
    const appJson = require("../../app.json");
    const schemes: string[] = appJson.expo.ios.infoPlist.CFBundleURLTypes
      .flatMap((t: { CFBundleURLSchemes: string[] }) => t.CFBundleURLSchemes);
    expect(schemes).toContain(appJson.expo.ios.bundleIdentifier);
  });

  it("requests read-only Gmail access and nothing broader", () => {
    expect(GMAIL_SCOPES).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(GMAIL_SCOPES.some((s) => s.includes("gmail.modify"))).toBe(false);
    expect(GMAIL_SCOPES.some((s) => s.includes("mail.google.com"))).toBe(false);
  });
});
