/**
 * Cloudflare Email Worker — inbound mail → Pixie Girl Hub.
 *
 * Cloudflare Email Routing hands each incoming message to this Worker. We parse
 * the MIME, build the JSON payload the Hub expects, HMAC-SHA256 the EXACT bytes
 * we're about to POST, and forward it to the inbound webhook. The Hub verifies
 * the signature with CF_EMAIL_INBOUND_SECRET and threads the message into the
 * right brand's inbox (routed by the `to` address).
 *
 * NOTE: Cloudflare Email Workers MUST use ES module syntax — the email()
 * handler only exists in `export default { ... }`. A CommonJS
 * (require/module.exports) worker deploys but never receives mail.
 *
 * ── Setup ────────────────────────────────────────────────────────────────
 * 1.  npm i postal-mime           (declare it so `wrangler deploy` bundles it)
 * 2.  Set the secret (must equal CF_EMAIL_INBOUND_SECRET in the Hub's .env):
 *        wrangler secret put INBOUND_SECRET
 * 3.  Deploy, then in Cloudflare → your domain → Email → Email Routing, route
 *     contact@thefaitlynbrand.com (and ideally a catch-all) to "Send to a Worker"
 *     → this Worker.
 *
 * The signed body is byte-for-byte what we POST, so the Hub's HMAC over its raw
 * request body matches ours. Do NOT re-stringify or mutate `body` after signing.
 */

import PostalMime from "postal-mime";

// Where the Hub receives inbound mail.
const WEBHOOK_URL =
  "https://hub.pixiegirlglobal.com/api/webhooks/email/inbound";

/** Hex HMAC-SHA256 of `message` using `secret` (Web Crypto, Workers runtime). */
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async email(message, env, _ctx) {
    if (!env.INBOUND_SECRET) {
      // Fail closed — without the secret the Hub would reject us anyway.
      console.error("INBOUND_SECRET is not set; dropping message");
      return;
    }

    // Parse the raw MIME into headers + text/html bodies.
    const parsed = await PostalMime.parse(message.raw);

    // Header lookups are case-insensitive; message.headers is a Map.
    const hdr = (name) => message.headers.get(name) || undefined;

    const payload = {
      // `to` routes the message to a brand — send the ORIGINAL envelope
      // recipient (e.g. contact@thefaitlynbrand.com), lower-cased by the Hub.
      to: message.to,
      from: {
        email: message.from,
        name: (parsed.from && parsed.from.name) || undefined,
      },
      subject: parsed.subject || hdr("subject") || "",
      text: parsed.text || "",
      html: parsed.html || "",
      message_id:
        (parsed.messageId || hdr("message-id") || "").trim() || undefined,
      in_reply_to:
        (parsed.inReplyTo || hdr("in-reply-to") || "").trim() || undefined,
      // References header is the most reliable thread key when present.
      thread_id: firstRef(parsed.references || hdr("references")),
    };

    // Sign the EXACT string we send. Serialize once, reuse for both.
    const body = JSON.stringify(payload);
    const signature = "sha256=" + (await hmacHex(env.INBOUND_SECRET, body));

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cf-email-signature": signature,
      },
      body,
    });

    if (!res.ok) {
      // Log so a bad signature / 5xx is visible in `wrangler tail`. Cloudflare
      // will not retry email() automatically, so surface failures loudly.
      const text = await res.text().catch(() => "");
      console.error(`Hub webhook ${res.status}: ${text}`);
      message.setReject(`Hub webhook returned ${res.status}`);
    }
  },
};

/** First id out of a References header ("<a> <b> <c>" → "<a>"), or undefined. */
function firstRef(refs) {
  if (!refs) return undefined;
  const m = String(refs).trim().split(/\s+/)[0];
  return m || undefined;
}
