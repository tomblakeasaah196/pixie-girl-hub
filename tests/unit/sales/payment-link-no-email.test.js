"use strict";

// Regression guard for the FLH-SO-0109 "Failed to generate payment link".
//
// The order was a walk-in: the contact had a phone number but NO email. The
// service passed that null straight to the gateway, and every gateway rejects a
// null customerEmail (Nomba 400, Paystack "email required"), so the whole chain
// failed and staff saw a bare "Failed to generate payment link" — with nothing
// wrong with the Nomba credentials at all.
//
// The fix: substitute a per-document no-reply address when the contact has no
// usable email, and record the gateway's OWN status + description in `attempts`
// so a real failure says which gateway rejected the call and why.

const ORDER = {
  order_id: "ord-1",
  order_number: "FLH-SO-0109",
  status: "pending",
  contact_id: "contact-1",
  sales_campaign_id: null,
  total_ngn: "425000.00",
  amount_paid_ngn: "0.00",
  display_currency: null,
  fx_rate_used: null,
};

let mockContactRow = { email: null };
let mockNombaImpl = async () => ({
  data: { checkoutLink: "https://pay.nomba.com/checkout/xyz" },
});
const mockNombaCalls = [];

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(async () => ORDER),
  findByPublicToken: jest.fn(async () => null),
}));

jest.mock("../../../src/modules/sales_campaigns/campaigns.repo", () => ({
  findById: jest.fn(async () => null),
}));

jest.mock(
  "../../../src/modules/business_setup/payment-gateways.service",
  () => ({
    getActiveChain: jest.fn(async () => [
      { provider: "nomba", credentials: { client_id: "c" } },
    ]),
  }),
);

jest.mock("../../../src/services/nomba.service", () => ({
  initializePayment: jest.fn(async (args) => {
    mockNombaCalls.push(args);
    return mockNombaImpl(args);
  }),
}));

jest.mock("../../../src/services/paystack.service", () => ({}));
jest.mock("../../../src/services/opay.service", () => ({}));
jest.mock("../../../src/services/stripe.service", () => ({}));

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(async () => ({ rows: [mockContactRow] })),
}));

jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "https://hub.example.com" },
}));

const paymentLink = require("../../../src/modules/sales/payment-link.service");

beforeEach(() => {
  mockNombaCalls.length = 0;
  mockContactRow = { email: null };
  mockNombaImpl = async () => ({
    data: { checkoutLink: "https://pay.nomba.com/checkout/xyz" },
  });
});

test("a customer with no email still gets a pay link (no-reply substituted)", async () => {
  const res = await paymentLink.createPaymentLink({
    brand: "faitlynhair",
    order_id: "ord-1",
  });

  expect(res.checkout_url).toBe("https://pay.nomba.com/checkout/xyz");
  expect(mockNombaCalls).toHaveLength(1);
  // A real, syntactically valid address — never null/empty.
  expect(mockNombaCalls[0].email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  // Keyed to the document, so gateways that de-dupe by email don't merge buyers.
  expect(mockNombaCalls[0].email).toContain("flh-so-0109");
});

test("a real customer email is still used as-is", async () => {
  mockContactRow = { email: "buyer@example.com" };
  await paymentLink.createPaymentLink({
    brand: "faitlynhair",
    order_id: "ord-1",
  });
  expect(mockNombaCalls[0].email).toBe("buyer@example.com");
});

test("a blank/garbage email on the contact is replaced, not forwarded", async () => {
  mockContactRow = { email: "   " };
  await paymentLink.createPaymentLink({
    brand: "faitlynhair",
    order_id: "ord-1",
  });
  expect(mockNombaCalls[0].email).toContain("no-reply");
});

test("a gateway rejection records the provider's own status and reason", async () => {
  mockNombaImpl = async () => {
    const err = new Error("Request failed with status code 400");
    err.response = {
      status: 400,
      data: { description: "customerEmail is required" },
    };
    throw err;
  };

  await expect(
    paymentLink.createPaymentLink({ brand: "faitlynhair", order_id: "ord-1" }),
  ).rejects.toMatchObject({
    code: "ALL_GATEWAYS_FAILED",
    // The attempts trail is what Kaizen now surfaces — it must name the reason,
    // not the useless axios "Request failed with status code 400".
    metadata: {
      attempts: [
        {
          provider: "nomba",
          error: "HTTP 400 — customerEmail is required",
        },
      ],
    },
  });
});
