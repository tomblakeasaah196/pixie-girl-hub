"use strict";

// Lock in the webhook-signature fix: Nomba signs with the DASHBOARD webhook
// signature key (NOT the API client secret), HMAC-SHA256 over the canonical
// field string, base64-encoded, compared to the `nomba-signature` header.
// These tests guard against a regression back to verifying with the API key.

const crypto = require("crypto");

const SIG_KEY = "a3f8b2c9e4d1a7f0b5c8e2d6a9f3b1c7e4d0a8b2f5c9e1d3a7b0f5c8e2d6a9aa";
const API_KEY = "totally-different-api-client-secret";

jest.mock("../../../src/config/env", () => ({
  config: {
    NOMBA_BASE_URL: "https://api.nomba.com",
    NOMBA_CLIENT_ID: "client-1",
    NOMBA_API_KEY: "totally-different-api-client-secret",
    NOMBA_ACCOUNT_ID: "acct-1",
    NOMBA_WEBHOOK_SIG_KEY:
      "a3f8b2c9e4d1a7f0b5c8e2d6a9f3b1c7e4d0a8b2f5c9e1d3a7b0f5c8e2d6a9aa",
    PIXIE_NOMBA_WEBHOOK_SIG_KEY: null,
    FAITLYN_NOMBA_WEBHOOK_SIG_KEY: null,
  },
}));

const nomba = require("../../../src/services/nomba.service");

const TS = "2026-06-25T10:00:00Z";

function makePayload() {
  return {
    event_type: "payment_success",
    requestId: "req-123",
    data: {
      merchant: { userId: "user-9", walletId: "wallet-7" },
      transaction: {
        transactionId: "txn-555",
        type: "checkout",
        time: "2026-06-25T09:59:58Z",
        responseCode: "00",
      },
    },
  };
}

function signWith(key, payload, timestamp) {
  const t = payload.data.transaction;
  const m = payload.data.merchant;
  let rc = t.responseCode || "";
  if (rc === "null") rc = "";
  const canonical = [
    payload.event_type,
    payload.requestId,
    m.userId,
    m.walletId,
    t.transactionId,
    t.type,
    t.time,
    rc,
    timestamp,
  ].join(":");
  return crypto.createHmac("sha256", key).update(canonical, "utf8").digest("base64");
}

describe("nomba.verifyWebhookSignature", () => {
  test("accepts a payload signed with the webhook signature key (Buffer body)", () => {
    const payload = makePayload();
    const sig = signWith(SIG_KEY, payload, TS);
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    expect(
      nomba.verifyWebhookSignature(raw, {
        "nomba-signature": sig,
        "nomba-timestamp": TS,
      }),
    ).toBe(true);
  });

  test("REJECTS a payload signed with the API client secret (the original bug)", () => {
    const payload = makePayload();
    const sig = signWith(API_KEY, payload, TS);
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    expect(
      nomba.verifyWebhookSignature(raw, {
        "nomba-signature": sig,
        "nomba-timestamp": TS,
      }),
    ).toBe(false);
  });

  test("rejects a tampered body", () => {
    const payload = makePayload();
    const sig = signWith(SIG_KEY, payload, TS);
    const tampered = makePayload();
    tampered.data.transaction.transactionId = "txn-999"; // body no longer matches sig
    const raw = Buffer.from(JSON.stringify(tampered), "utf8");
    expect(
      nomba.verifyWebhookSignature(raw, {
        "nomba-signature": sig,
        "nomba-timestamp": TS,
      }),
    ).toBe(false);
  });

  test("returns false when required headers are missing", () => {
    const payload = makePayload();
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    expect(nomba.verifyWebhookSignature(raw, {})).toBe(false);
  });

  test("uses an explicit per-brand creds key over env", () => {
    const brandKey = "brand-specific-key-0000000000000000000000000000";
    const payload = makePayload();
    const sig = signWith(brandKey, payload, TS);
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    expect(
      nomba.verifyWebhookSignature(
        raw,
        { "nomba-signature": sig, "nomba-timestamp": TS },
        { webhook_signature_key: brandKey },
      ),
    ).toBe(true);
  });

  test("treats responseCode 'null' string as empty when signing", () => {
    const payload = makePayload();
    payload.data.transaction.responseCode = "null"; // serialised null
    // Sign with rc normalised to "" (what the verifier does internally).
    const sig = signWith(SIG_KEY, payload, TS); // signWith maps "null"→""
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    expect(
      nomba.verifyWebhookSignature(raw, {
        "nomba-signature": sig,
        "nomba-timestamp": TS,
      }),
    ).toBe(true);
  });
});
