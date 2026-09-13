/**
 * receipt-router — the Cloudflare Email Worker behind receipts+<token>@<domain>.
 *
 * Cloudflare Email Routing accepts the mail; this flattens it to JSON and hands
 * it to the receipt-ingest edge function. It deliberately holds no logic about
 * restaurants: parsing lives in supabase/functions/_shared/receipt-parser.ts,
 * shared with the Gmail path, so the two can never disagree about what counts
 * as an OpenTable confirmation.
 *
 * Deliberately dependency-free so it can be pasted into the Cloudflare
 * dashboard without a build step. The MIME handling below is therefore
 * deliberately shallow — enough for the text/plain part of a forwarded
 * confirmation, which is all the parser reads. If a platform ever ships
 * HTML-only receipts worth parsing, bundle postal-mime with wrangler rather
 * than growing this.
 *
 * Setup:
 *   1. Cloudflare > your domain > Email > Email Routing > enable.
 *   2. Create this Worker, paste this file.
 *   3. Settings > Variables:
 *        INGEST_URL     https://<project>.supabase.co/functions/v1/receipt-ingest
 *        INGEST_SECRET  (encrypted) the value in ~/palate-ingest-secret.txt
 *   4. Email Routing > Routes > Catch-all > send to this Worker.
 *      Catch-all, not a single address: every user's address is
 *      receipts+<their token>@<domain>, and those are not enumerable in advance.
 */

const MAX_BYTES = 1024 * 512; // A receipt is small. Anything larger is not one.

export default {
  async email(message, env) {
    // Never bounce on our own failure. A bounced forward tells the user their
    // address is wrong when the truth is that our endpoint was down, and they
    // will not try twice.
    try {
      const raw = await readCapped(message.raw, MAX_BYTES);
      const text = extractPlainText(raw);
      const to = recipientWithTag(message, raw);

      const res = await fetch(env.INGEST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ingest-secret": env.INGEST_SECRET,
        },
        body: JSON.stringify({
          to,
          from: message.headers.get("from") || message.from,
          subject: message.headers.get("subject") || "",
          date: message.headers.get("date") || null,
          text,
        }),
      });
      if (!res.ok) console.log("ingest rejected", res.status, await res.text());
    } catch (err) {
      console.log("ingest error", String(err));
    }
  },
};

/**
 * The recipient address INCLUDING its +tag, which is the whole identity.
 *
 * `message.to` is the envelope recipient and normally carries the tag intact
 * under a catch-all route. But Cloudflare has a "Subaddressing" setting whose
 * interaction with catch-all I have not tested, and if it ever normalises
 * receipts+<token>@ down to receipts@ the token is gone and every forward from
 * every user lands as no_token_in_address.
 *
 * So: take the first candidate that actually has a +tag, and only fall back to
 * the bare envelope address if none do. Costs nothing, and makes the toggle in
 * the dashboard stop mattering.
 */
function recipientWithTag(message, raw) {
  const candidates = [
    message.to,
    message.headers.get("delivered-to"),
    message.headers.get("x-original-to"),
    message.headers.get("to"),
  ];
  for (const c of candidates) {
    if (c && /[^<>\s@]+\+[^<>\s@]+@/.test(c)) return c;
  }
  // Last resort: the original RCPT TO as it appeared in the received headers.
  const m = /^Received:[\s\S]*?\bfor\s+<([^>]+\+[^>]+)>/im.exec((raw || "").slice(0, 4000));
  if (m) return m[1];
  return message.to;
}

async function readCapped(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  try { await reader.cancel(); } catch (_) { /* already closed */ }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, size - off)), off); off += c.length; }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

/**
 * The text/plain part of a MIME message, decoded.
 *
 * Falls back to the whole body: the parser only needs the subject plus, for a
 * hand forward, the "From:" line near the top — and both survive being handed
 * slightly messy text. Returning nothing would lose the hand-forward case
 * entirely, which is the one people try first.
 */
function extractPlainText(raw) {
  const sep = raw.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
  const headerEnd = raw.indexOf(sep);
  if (headerEnd < 0) return raw;

  const parts = raw.split(/\r?\n--[-A-Za-z0-9'()+_,./:=?]+\r?\n/);
  for (const part of parts) {
    if (!/content-type:\s*text\/plain/i.test(part)) continue;
    const bodyStart = part.indexOf(sep);
    if (bodyStart < 0) continue;
    const enc = (/content-transfer-encoding:\s*([\w-]+)/i.exec(part) || [])[1];
    return decodeBody(part.slice(bodyStart + sep.length), enc);
  }

  const enc = (/content-transfer-encoding:\s*([\w-]+)/i.exec(raw.slice(0, headerEnd)) || [])[1];
  return decodeBody(raw.slice(headerEnd + sep.length), enc);
}

function decodeBody(body, encoding) {
  const e = (encoding || "").toLowerCase();
  if (e === "base64") {
    try { return atob(body.replace(/\s+/g, "")); } catch (_) { return body; }
  }
  if (e === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body;
}
