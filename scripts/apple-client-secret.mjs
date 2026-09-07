#!/usr/bin/env node
// ============================================================================
// apple-client-secret.mjs — the JWT Apple calls a "client secret".
// ----------------------------------------------------------------------------
// Apple does not issue a client secret. It issues a .p8 signing key, and the
// secret is a short-lived ES256 JWT you sign with it yourself. Pasting the .p8
// into a form that wants the secret gets you "Secret key should be a JWT",
// which is a true error message about a confusing name.
//
// YOU PROBABLY DO NOT NEED THIS. Palate signs in with signInWithIdToken — the
// native flow, where the device gets the identity token from Apple and
// Supabase checks its signature and audience. The client secret is only used
// by the OAuth redirect flow, where Supabase exchanges an authorization code
// with Apple. Leave Supabase's "Secret Key (for OAuth)" empty unless the form
// refuses to save without it.
//
// It expires. Apple caps the lifetime at six months, so whatever you paste
// stops working on a date nobody has written down. That is the strongest
// reason to leave the field empty when the native flow does not need it.
//
// Runs locally with no dependencies. The key never leaves this machine and is
// never printed.
//
//   node scripts/apple-client-secret.mjs \
//     --p8 ~/Downloads/AuthKey_ABC123XYZ.p8 \
//     --team-id YOURTEAMID --key-id ABC123XYZ --client-id app.palate.ios
// ============================================================================

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const need = ["p8", "team-id", "key-id", "client-id"];
const missing = need.filter((k) => !args[k]);
if (missing.length) {
  console.error(`Missing: ${missing.map((m) => "--" + m).join(" ")}`);
  console.error("\nSee the header of this file for a full example.");
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const now = Math.floor(Date.now() / 1000);
// Apple's ceiling is 15777000 seconds (about six months) and rejects more.
const SIX_MONTHS = 15777000;

const header = { alg: "ES256", kid: args["key-id"] };
const payload = {
  iss: args["team-id"],
  iat: now,
  exp: now + SIX_MONTHS,
  aud: "https://appleid.apple.com",
  sub: args["client-id"],
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

let key;
try {
  key = readFileSync(args.p8, "utf8");
} catch (e) {
  console.error(`Could not read ${args.p8}: ${e.message}`);
  process.exit(1);
}
if (!key.includes("BEGIN PRIVATE KEY")) {
  console.error("That file does not look like a .p8 private key.");
  process.exit(1);
}

// JOSE wants the raw r||s pair, not the DER structure Node signs with by
// default. ieee-p1363 is exactly that, and getting it wrong produces a JWT
// that looks perfectly well-formed and is rejected by Apple.
const sig = createSign("SHA256")
  .update(signingInput)
  .sign({ key, dsaEncoding: "ieee-p1363" });

const jwt = `${signingInput}.${b64url(sig)}`;

console.log(jwt);
console.error(`\n(expires ${new Date((now + SIX_MONTHS) * 1000).toISOString().slice(0, 10)} — put that date in a calendar)`);
