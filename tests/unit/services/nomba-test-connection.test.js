"use strict";

// Guards the Settings → Payment gateways → "Test connection" backend for Nomba
// (nomba.testConnection). Verifies the four-step checklist: credentials present,
// OAuth auth, webhook signature self-test, and a live checkout link — with axios
// mocked so no network is touched.

const SIG_KEY =
  "a3f8b2c9e4d1a7f0b5c8e2d6a9f3b1c7e4d0a8b2f5c9e1d3a7b0f5c8e2d6a9aa";

jest.mock("../../../src/config/env", () => ({
  config: {
    NOMBA_BASE_URL: "https://api.nomba.com",
    NOMBA_CLIENT_ID: null,
    NOMBA_API_KEY: null,
    NOMBA_ACCOUNT_ID: null,
    NOMBA_WEBHOOK_SIG_KEY: null,
    PIXIE_NOMBA_WEBHOOK_SIG_KEY: null,
    FAITLYN_NOMBA_WEBHOOK_SIG_KEY: null,
  },
}));

// Mock axios: token endpoint issues a token; checkout endpoint returns a link.
jest.mock("axios", () => {
  const instance = {
    post: jest.fn(async (url) => {
      if (url === "/v1/auth/token/issue") {
        return {
          data: {
            data: {
              access_token: "test-access-token",
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            },
          },
        };
      }
      return { data: {} };
    }),
    request: jest.fn(async (cfg) => {
      if (cfg.url === "/v1/checkout/order") {
        return {
          data: { data: { checkoutLink: "https://checkout.nomba/xyz" } },
        };
      }
      return { data: {} };
    }),
  };
  return { create: jest.fn(() => instance), __instance: instance };
});

const nomba = require("../../../src/services/nomba.service");

const FULL_CREDS = {
  client_id: "client-1",
  client_secret: "api-secret-1",
  account_id: "acct-1",
  webhook_signature_key: SIG_KEY,
};

const byKey = (checks, key) => checks.find((c) => c.key === key);

describe("nomba.testConnection", () => {
  test("all four checks pass with full, valid credentials", async () => {
    const res = await nomba.testConnection(FULL_CREDS, { brand: "pixiegirl" });

    expect(res.ok).toBe(true);
    expect(byKey(res.checks, "credentials").ok).toBe(true);
    expect(byKey(res.checks, "auth").ok).toBe(true);
    expect(byKey(res.checks, "webhook").ok).toBe(true);

    const payment = byKey(res.checks, "payment_init");
    expect(payment.ok).toBe(true);
    expect(payment.checkout_url).toBe("https://checkout.nomba/xyz");
    expect(payment.reference).toMatch(/^TEST-PIXIEGIRL-\d+$/);
  });

  test("missing API credentials fail the creds check and skip auth + payment", async () => {
    const res = await nomba.testConnection({
      webhook_signature_key: SIG_KEY,
    });

    expect(res.ok).toBe(false);
    expect(byKey(res.checks, "credentials").ok).toBe(false);
    expect(byKey(res.checks, "credentials").detail).toMatch(/Client ID/);
    // Auth + payment are skipped (not attempted) when creds are incomplete.
    expect(byKey(res.checks, "auth").ok).toBe(false);
    expect(byKey(res.checks, "payment_init").ok).toBe(false);
    // The webhook self-test still runs (key is present) and passes.
    expect(byKey(res.checks, "webhook").ok).toBe(true);
  });

  test("a missing webhook signature key is reported, other checks still run", async () => {
    const res = await nomba.testConnection({
      client_id: "client-1",
      client_secret: "api-secret-1",
      account_id: "acct-1",
    });

    const webhook = byKey(res.checks, "webhook");
    expect(webhook.ok).toBe(false);
    expect(webhook.detail).toMatch(/Not set/);
    // Auth + payment still succeed via the mocked axios.
    expect(byKey(res.checks, "auth").ok).toBe(true);
    expect(byKey(res.checks, "payment_init").ok).toBe(true);
    // Overall not ok because the webhook key is missing.
    expect(res.ok).toBe(false);
  });

  test("an auth failure is captured and the payment step is skipped", async () => {
    const axios = require("axios");
    axios.__instance.post.mockImplementationOnce(async () => {
      const err = new Error("Request failed");
      err.response = { status: 401, data: { message: "Invalid client" } };
      throw err;
    });

    const res = await nomba.testConnection(FULL_CREDS);

    const auth = byKey(res.checks, "auth");
    expect(auth.ok).toBe(false);
    expect(auth.detail).toMatch(/HTTP 401/);
    expect(auth.detail).toMatch(/Invalid client/);
    // Payment is skipped because auth failed.
    expect(byKey(res.checks, "payment_init").ok).toBe(false);
    expect(byKey(res.checks, "payment_init").detail).toMatch(/Skipped/);
    expect(res.ok).toBe(false);
  });
});
