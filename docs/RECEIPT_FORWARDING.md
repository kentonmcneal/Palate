# Receipt forwarding

Replaces the Gmail OAuth import. Nothing in this path shows a user a security
warning, costs an annual fee, or requires Google's approval.

## Why the Gmail import was withdrawn

`gmail.readonly` is in Google's **restricted** scope tier. Any app requesting it
shows every user the full-page *"Google hasn't verified this app — BACK TO
SAFETY"* interstitial until it passes OAuth verification **and** an annual CASA
Tier 2 third-party security assessment (roughly $540–675/yr, ~6 weeks). No
publishing status, test-user list, or console setting removes that screen:
"Testing" and "In production, unverified" both show it.

The flow is gated, not deleted — `mobile/lib/gmail-gate.ts`. Flip
`GMAIL_OAUTH_ENABLED` to `true` the day verification is worth paying for;
accounts that connected before the gate keep importing either way.

## How forwarding works

```
user forwards mail
   -> receipts+<token>@your-palate.com
   -> Cloudflare Email Routing (catch-all)
   -> infra/cloudflare/receipt-router.js        flattens MIME to JSON
   -> supabase/functions/receipt-ingest         verifies secret, resolves token
   -> _shared/receipt-parser.ts                 SAME parser the Gmail path used
   -> email_receipts (status = 'pending')
   -> the user confirms in the app
```

**The token is the identity.** A `From` header is trivially forged; a 24-hex
token is not. `receipt_ingest_tokens` has no insert/update policy at all — only
`my_receipt_token()` mints one, so nobody can choose their own or overwrite
somebody else's.

**Nothing writes a visit automatically.** Same rule as the Gmail import review:
the app proposes, the person decides. A parser mistake that reaches the taste
graph surfaces later as bad taste rather than as a bug.

**Accepting is free.** A receipt carries a *name*, and turning a name into a
place is a paid Google lookup. `acceptReceipt` resolves against the local
`restaurants` catalogue only; anything it cannot find is handed to the search
screen the user already drives by hand.

## Cloudflare setup (the one remaining manual step)

1. Cloudflare → `your-palate.com` → **Email** → **Email Routing** → enable.
   This adds MX records. It does **not** affect Resend's SPF/DKIM, so login
   OTPs keep sending.
2. **Workers & Pages** → Create Worker → paste `infra/cloudflare/receipt-router.js`.
3. Worker → Settings → Variables:
   - `INGEST_URL` = `https://oxzsspbojeyeelbjqjdx.supabase.co/functions/v1/receipt-ingest`
   - `INGEST_SECRET` (**encrypted**) = the value in `~/palate-ingest-secret.txt`
4. Email Routing → **Routes** → **Catch-all** → send to that Worker.
   Catch-all, not a single address: every user's address is
   `receipts+<their token>@…` and those are not enumerable in advance.

**Leave "Subaddressing" OFF.** It governs whether `receipts+tag@` is delivered to
a rule written for plain `receipts@`. We use catch-all, which takes every local
part anyway, and turning it on risks Cloudflare normalising the address and
stripping the `+token` that *is* the identity. The Worker no longer depends on
the setting either way — `recipientWithTag()` takes the first of the envelope
address, `Delivered-To`, `X-Original-To`, `To:`, or the `Received` trace that
still carries a tag.

`RECEIPT_INGEST_SECRET` is already set on Supabase. The function fails **closed**
when it is unset — an unconfigured endpoint refuses everything rather than
accepting anything.

## What was verified, and how

Against the deployed function, not a clean deploy:

| Case | Result |
|---|---|
| `GET` | `405 method_not_allowed` |
| No/incorrect secret | `503` when unset (fails closed), `401` when wrong |
| Gmail **filter** forward (original `From` survives) | parsed → `Lilia`, `opentable.com` |
| **Hand** forward (`From` rewritten, original in body) | parsed → `Lilia`, `opentable.com` |
| Same meal arriving both ways | deduped to one row |
| Marketing from a known sender | not parsed, sender miss recorded |
| Valid-looking token, no such user | `404 unknown_token` |
| Bare address, no `+tag` | `400 no_token_in_address` |

The hand-forward case **failed the first time**: the fallback tested whether the
`From` header parsed as an address rather than whether it was a *known receipt
sender*, and `someone@gmail.com` parses fine — so it never opened the body. That
is the forward people try first. Caught by firing a real one at the deployed
function.

MIME extraction (multipart, quoted-printable, base64) is verified in
`infra/cloudflare/receipt-router.js` against realistic message shapes.

## Not yet verified

Cloudflare's own delivery hop — steps 1–4 above have not been performed, so no
real email has travelled the whole path. Everything downstream of the Worker is
proven.
