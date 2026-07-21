/**
 * Nomba gateway client (V2.2 §5.1) — NGN gateway (also POS terminals).
 *
 * OAuth client-credentials → access token (cached per client_id until ~expiry):
 *   - initializePayment: create an online checkout order (redirect link).
 *   - verifyTransaction: server-side lookup by order reference.
 *   - verifyWebhookSignature: HMAC-SHA256 over the canonical field string
 *     keyed on the WEBHOOK SIGNATURE KEY (set in Nomba dashboard), compared
 *     to the `nomba-signature` header. true | false | null.
 *
 * Each function accepts an optional `creds` ({ client_id, client_secret,
 * account_id, webhook_signature_key }) resolved per-brand; omitted → env fallback.
 *
 * ⚠️  The webhook signature key is a SEPARATE secret from the API client_secret.
 *    It is set in the Nomba dashboard under Developer → Webhook Setup.
 *    Store it in env as NOMBA_WEBHOOK_SIG_KEY (and per-brand variants).
 */

"use strict";

const crypto = require("crypto");
const axios = require("axios");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");

const tokenCache = new Map(); // client_id → { token, expiresAt }

// ── creds helpers ───────────────────────────────────────
// `creds` may carry webhook_signature_key (from per-brand config).
// Fallback: env NOMBA_WEBHOOK_SIG_KEY (and per-brand overrides below).
function keys(creds) {
  return {
    client_id: (creds && creds.client_id) || config.NOMBA_CLIENT_ID,
    client_secret: (creds && creds.client_secret) || config.NOMBA_API_KEY,
    account_id: (creds && creds.account_id) || config.NOMBA_ACCOUNT_ID,
    // Webhook signature key: per-brand via creds, then env, then null.
    webhook_signature_key:
      (creds && creds.webhook_signature_key) ||
      config.NOMBA_WEBHOOK_SIG_KEY ||
      null,
  };
}

function isConfigured(creds) {
  const k = keys(creds);
  return Boolean(k.client_id && k.client_secret && k.account_id);
}
function ensure(creds) {
  if (!isConfigured(creds))
    throw new AppError(
      "NOMBA_NOT_CONFIGURED",
      "Nomba keys are not configured",
      503,
    );
}

function http(k) {
  return axios.create({
    baseURL: config.NOMBA_BASE_URL,
    headers: { accountId: k.account_id },
    timeout: 20000,
  });
}

async function getToken(k) {
  const cached = tokenCache.get(k.client_id);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const { data } = await http(k).post("/v1/auth/token/issue", {
    grant_type: "client_credentials",
    client_id: k.client_id,
    client_secret: k.client_secret,
  });
  const body = data && data.data ? data.data : data;
  const token = body.access_token || body.accessToken;
  const expiresAt = body.expiresAt
    ? new Date(body.expiresAt).getTime()
    : Date.now() + (Number(body.expires_in) || 3600) * 1000;

  tokenCache.set(k.client_id, { token, expiresAt });
  return token;
}

async function authed(method, url, body, creds) {
  ensure(creds);
  const k = keys(creds);
  const token = await getToken(k);
  const { data } = await http(k).request({
    method,
    url,
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

/**
 * Create an online checkout order.
 *
 * Nomba settles BOTH currencies on the SAME account/key (owner confirmed June
 * 2026) — there is no USD sub-account and no separate credential. We simply
 * parse the currency and the amount through:
 *   - `currency`: "NGN" | "USD" (defaults to NGN). No longer hardcoded.
 *   - `amount`:   the charge in that currency's MAJOR units (Nomba uses decimal
 *                 major units, not kobo/cents). For NGN this is the Naira total;
 *                 for USD it is the whole-dollar figure the campaign's rate
 *                 produced — whatever the campaign sends, Nomba receives.
 *
 * `amount_ngn` is accepted as a back-compat alias when a caller only has the
 * Naira figure and is settling in NGN. Returns Nomba's response (checkoutLink
 * in data).
 */
async function initializePayment({
  reference,
  amount,
  currency,
  amount_ngn,
  email,
  callback_url,
  creds,
}) {
  const chargeCurrency = String(currency || "NGN").toUpperCase();
  const chargeAmount =
    amount !== undefined && amount !== null ? amount : amount_ngn;
  return authed(
    "post",
    "/v1/checkout/order",
    {
      order: {
        orderReference: reference,
        callbackUrl: callback_url,
        customerEmail: email,
        amount: Number(chargeAmount),
        currency: chargeCurrency,
      },
    },
    creds,
  );
}

/**
 * Push a charge to a physical Nomba POS terminal (PD §6.21 — Nomba is the
 * in-store POS gateway). `amount_ngn` is the NGN total in MAJOR units (Naira).
 * The terminal prompts the customer to tap/insert; the result arrives via
 * webhook (confirmed as method 'nomba_terminal'). `reference` is sent as
 * `merchantTxRef` so Nomba echoes it back on the webhook, letting us auto-match
 * the payment to its order (Option 2). Set it to the order number so the webhook
 * handler's brand + order resolution works.
 *
 * ⚠️  AMOUNT UNIT — UNVERIFIED, MUST TEST BEFORE LIVE USE.
 *    We send the amount in MAJOR units (Naira), matching every other Nomba call
 *    in this integration (/v1/checkout/order, transfers) and the major-unit
 *    figures Nomba reports back on webhooks. Nomba's terminal docs, however,
 *    say this endpoint takes the SMALLEST unit (kobo) — which would mean
 *    multiplying by 100. The two disagree, and getting it wrong over-charges a
 *    customer 100×, so we deliberately do NOT multiply until a single real
 *    sandbox/live charge confirms which unit the terminal endpoint actually
 *    wants. Verify that before using push-to-terminal for real customers.
 */
async function requestTerminalPayment({
  terminal_id,
  amount_ngn,
  reference,
  creds,
}) {
  return authed(
    "post",
    `/v1/terminals/payment-request/${encodeURIComponent(terminal_id)}`,
    {
      merchantTxRef: reference,
      amount: Number(amount_ngn),
      currency: "NGN",
    },
    creds,
  );
}

/** Look up a transaction/order by our reference. */
async function verifyTransaction(reference, creds) {
  return authed(
    "get",
    `/v1/checkout/transaction?idType=ORDER_REFERENCE&id=${encodeURIComponent(reference)}`,
    undefined,
    creds,
  );
}

/**
 * Verify an inbound Nomba webhook signature.
 *
 * Nomba's official docs (all language samples) define the signature as:
 *
 *   1. Construct a canonical string from the JSON payload fields:
 *        event_type : requestId : userId : walletId : transactionId : transactionType : transactionTime : responseCode : timestamp
 *      (each field separated by ':', empty string if field is missing)
 *   2. HMAC-SHA256(the above string, webhook_signature_key) → raw bytes
 *   3. Base64-encode the raw bytes → this is the expected signature
 *   4. Compare to the value in the `nomba-signature` header (case-insensitively)
 *
 * The timestamp is read from the `nomba-timestamp` header (RFC-3339 string).
 *
 * Returns: true (valid), false (present but invalid), null (no secret configured → skip verification).
 *
 * @param {Buffer|string} rawBody  – the raw request body (Buffer or string)
 * @param {object}      headers   – the request headers (lowercase keys)
 * @param {object}      [creds]   – optional per-brand creds { webhook_signature_key }
 */
function verifyWebhookSignature(rawBody, headers = {}, creds) {
  // ── 1. Resolve the webhook signature key ──────────────────
  // Per-brand: creds.webhook_signature_key
  // Fallback:   env NOMBA_WEBHOOK_SIG_KEY
  // Also support per-brand env vars (same pattern as API keys):
  //   PIXIE_NOMBA_WEBHOOK_SIG_KEY, FAITLYN_NOMBA_WEBHOOK_SIG_KEY
  const envSigKey =
    config.NOMBA_WEBHOOK_SIG_KEY ||
    config.PIXIE_NOMBA_WEBHOOK_SIG_KEY ||
    config.FAITLYN_NOMBA_WEBHOOK_SIG_KEY ||
    null;

  const secret = (creds && creds.webhook_signature_key) || envSigKey;

  if (!secret) return null; // no secret configured → skip (log only)

  // ── 2. Read Nomba's signature headers ─────────────────────
  // Nomba sends: nomba-signature, nomba-sig-value (both same value),
  //               nomba-timestamp (RFC-3339 string).
  // Header names are case-insensitive; express normalises to lowercase.
  const sig = headers["nomba-signature"] || headers["nomba-sig-value"] || null;

  const timestamp = headers["nomba-timestamp"] || null;

  if (!sig || !timestamp) return false; // required headers missing → reject

  // ── 3. Parse the payload (we need individual fields, not the raw body) ──
  let payload;
  try {
    payload =
      typeof rawBody === "string"
        ? JSON.parse(rawBody)
        : JSON.parse(rawBody.toString("utf8"));
  } catch {
    return false; // malformed body → reject
  }

  const data = payload.data || {};
  const merchant = data.merchant || {};
  const transaction = data.transaction || {};

  // ── 4. Build the canonical hashing payload (EXACTLY as Nomba's docs) ──
  // Nomba's docs: "event_type:requestId:userId:walletId:transactionId:transactionType:transactionTime:responseCode:timestamp"
  //
  // Official samples (Go/Python/JS/Java/C#/PHP) all use these exact 8 fields
  // joined by ':', with empty-string fallback for missing fields, and treat the
  // string "null" (the JSON value null serialised) as empty string.
  let responseCode = transaction.responseCode || "";
  if (responseCode === "null") responseCode = "";

  const hashingPayload = [
    payload.event_type || "",
    payload.requestId || "",
    merchant.userId || "",
    merchant.walletId || "",
    transaction.transactionId || "",
    transaction.type || "",
    transaction.time || "",
    responseCode,
    timestamp,
  ].join(":");

  // ── 5. Compute HMAC-SHA256 → base64 ─────────────────────
  const computed = crypto
    .createHmac("sha256", secret)
    .update(hashingPayload, "utf8")
    .digest("base64");

  // ── 6. Constant-time, case-INSENSITIVE compare ──────────
  // Nomba's own samples (C#, PHP, Go) all compare case-insensitively.
  // Base64 can have '+'/'-' and '/'/'_' differences between standard and
  // URL-safe encodings, and the header value may have trailing whitespace.
  try {
    const sigNormalised = (sig || "").toString().trim();
    const compNormalised = (computed || "").toString().trim();
    return crypto.timingSafeEqual(
      Buffer.from(sigNormalised, "utf8"),
      Buffer.from(compNormalised, "utf8"),
    );
  } catch {
    // If lengths differ (e.g. padding), timingSafeEqual throws.
    // Do a manual case-insensitive string compare as fallback.
    try {
      const a = (sig || "").toString().trim().toLowerCase();
      const b = (computed || "").toString().trim().toLowerCase();
      return a === b;
    } catch {
      return false;
    }
  }
}

/**
 * Salary payout / bank transfer (HR payroll disbursement).
 *
 * Sends a single payout to a Nigerian bank account. `amount_ngn` is in NGN
 * major units. Returns { ok, reference, raw } — never throws on a "not
 * configured" state (the caller queues those for manual settlement), but does
 * throw on a real network/API error so the caller can mark the slip failed.
 *
 * NOTE: Nomba's payout endpoint + payload were still being confirmed at build
 * time (meeting action item — Jaffa & Baji). The path/shape below follows
 * Nomba's transfer API convention; verify against the live account before
 * go-live. When creds are absent the function reports not_configured so payroll
 * falls back to a manual bank schedule rather than blocking.
 */
async function disburseSalary(
  { account_number, bank_code, amount_ngn, narration, reference },
  creds,
) {
  if (!isConfigured(creds)) {
    return { ok: false, reason: "not_configured", reference: null };
  }
  const raw = await authed(
    "post",
    "/v1/transfers/bank",
    {
      amount: Number(amount_ngn),
      currency: "NGN",
      accountNumber: account_number,
      bankCode: bank_code || undefined,
      narration: narration || "Salary",
      merchantTxRef: reference,
    },
    creds,
  );
  // Nomba wraps results in { data: { ... } }; success shape varies by account.
  const data = (raw && raw.data) || raw || {};
  const ok =
    data.status === "success" ||
    data.success === true ||
    Boolean(data.transactionId || data.id);
  return {
    ok,
    reference: data.transactionId || data.id || reference || null,
    raw: data,
  };
}

// ── Connection self-test (Settings → Payment gateways → Test) ──────────
/**
 * Turn any error into a short, SECRET-FREE one-liner for the UI. Surfaces the
 * HTTP status + Nomba's own message (or a network error code) and never leaks
 * the request (which carries the client_secret) or a stack trace.
 */
function describeError(e) {
  if (e && e.response) {
    const status = e.response.status;
    const body = e.response.data;
    const msg =
      (body &&
        (body.description ||
          body.message ||
          (body.data && body.data.message))) ||
      (typeof body === "string" ? body : "");
    return `HTTP ${status}${msg ? ` — ${String(msg).slice(0, 200)}` : ""}`;
  }
  if (e && e.code) return String(e.code); // ECONNABORTED, ENOTFOUND, …
  return e && e.message ? String(e.message).slice(0, 200) : "unknown error";
}

/**
 * Self-signed webhook roundtrip: sign a sample payload with the configured
 * signature key using Nomba's EXACT canonical algorithm, then feed it back
 * through verifyWebhookSignature. A `true` proves the stored key will validate
 * a genuine Nomba webhook (same HMAC scheme) — it does not prove Nomba's
 * dashboard is pointed at our URL (that only a real inbound event can show).
 */
function webhookSelfTest(secret, creds) {
  const timestamp = new Date().toISOString();
  const payload = {
    event_type: "payment_success",
    requestId: "selftest-request",
    data: {
      merchant: { userId: "selftest-user", walletId: "selftest-wallet" },
      transaction: {
        transactionId: "selftest-txn",
        type: "checkout",
        time: timestamp,
        responseCode: "00",
      },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const hashingPayload = [
    payload.event_type,
    payload.requestId,
    payload.data.merchant.userId,
    payload.data.merchant.walletId,
    payload.data.transaction.transactionId,
    payload.data.transaction.type,
    payload.data.transaction.time,
    payload.data.transaction.responseCode,
    timestamp,
  ].join(":");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(hashingPayload, "utf8")
    .digest("base64");
  const headers = {
    "nomba-signature": signature,
    "nomba-timestamp": timestamp,
  };
  return verifyWebhookSignature(rawBody, headers, creds) === true;
}

/**
 * Run a live connection test for a brand's Nomba credentials and return a
 * structured checklist the UI renders as green/red rows. Checks, in order:
 *   1. credentials   – client_id, client_secret, account_id all present
 *   2. auth          – a FRESH OAuth token can be issued (proves the API key)
 *   3. webhook       – signature key set + self-signed roundtrip verifies
 *   4. payment_init  – Nomba creates a live checkout link (proves a payment can
 *                      be started end-to-end; NO money moves until it's paid)
 * Every check is isolated so one failure still reports the rest.
 */
async function testConnection(creds, opts = {}) {
  const k = keys(creds);
  const checks = [];

  // 1 ── credentials present
  const missing = [];
  if (!k.client_id) missing.push("Client ID");
  if (!k.client_secret) missing.push("API key");
  if (!k.account_id) missing.push("Account ID");
  const credsOk = missing.length === 0;
  checks.push({
    key: "credentials",
    label: "Credentials present",
    ok: credsOk,
    detail: credsOk
      ? "Client ID, API key and Account ID are all set."
      : `Missing: ${missing.join(", ")}.`,
  });

  // 2 ── API authentication (fresh OAuth token)
  let authOk = false;
  if (credsOk) {
    try {
      tokenCache.delete(k.client_id); // bypass cache so we truly exercise the creds
      await getToken(k);
      authOk = true;
      checks.push({
        key: "auth",
        label: "API authentication",
        ok: true,
        detail: "Obtained an OAuth access token from Nomba.",
      });
    } catch (e) {
      checks.push({
        key: "auth",
        label: "API authentication",
        ok: false,
        detail: `Token request failed: ${describeError(e)}`,
      });
    }
  } else {
    checks.push({
      key: "auth",
      label: "API authentication",
      ok: false,
      detail: "Skipped — credentials incomplete.",
    });
  }

  // 3 ── webhook signature key
  if (!k.webhook_signature_key) {
    checks.push({
      key: "webhook",
      label: "Webhook signature key",
      ok: false,
      detail:
        "Not set — inbound webhooks cannot be verified. Add it from Nomba → Developer → Webhook Setup.",
    });
  } else {
    let roundtrip = false;
    try {
      roundtrip = webhookSelfTest(k.webhook_signature_key, creds);
    } catch {
      roundtrip = false;
    }
    checks.push({
      key: "webhook",
      label: "Webhook signature key",
      ok: roundtrip,
      detail: roundtrip
        ? "Key is set and a signed sample verified correctly."
        : "Key is set but the signature self-test did not verify — re-check the value.",
    });
  }

  // 4 ── create a live test checkout (proves a payment can be initialised)
  if (authOk) {
    const reference = `TEST-${String(opts.brand || "pxg").toUpperCase()}-${Date.now()}`;
    const amount =
      opts.amount !== null && opts.amount !== undefined
        ? Number(opts.amount)
        : 100;
    const currency = String(opts.currency || "NGN").toUpperCase();
    try {
      const data = await initializePayment({
        reference,
        amount,
        currency,
        email: opts.email || "payments-test@pixiegirlhub.local",
        callback_url: opts.callback_url,
        creds,
      });
      const url =
        data && data.data && (data.data.checkoutLink || data.data.checkout_url);
      checks.push({
        key: "payment_init",
        label: "Create test checkout",
        ok: Boolean(url),
        detail: url
          ? `Nomba created a live ${currency} ${amount} checkout — no charge until it is paid. Open the link to run a full end-to-end payment.`
          : "Nomba accepted the request but returned no checkout link.",
        checkout_url: url || undefined,
        reference,
      });
    } catch (e) {
      checks.push({
        key: "payment_init",
        label: "Create test checkout",
        ok: false,
        detail: `Checkout creation failed: ${describeError(e)}`,
      });
    }
  } else {
    checks.push({
      key: "payment_init",
      label: "Create test checkout",
      ok: false,
      detail: "Skipped — authentication failed.",
    });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

module.exports = {
  isConfigured,
  initializePayment,
  requestTerminalPayment,
  verifyTransaction,
  verifyWebhookSignature,
  disburseSalary,
  testConnection,
};
