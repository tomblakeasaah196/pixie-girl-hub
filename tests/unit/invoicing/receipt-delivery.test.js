"use strict";

jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "http://localhost:7000" },
}));
jest.mock("../../../src/jobs/queue", () => ({ enqueue: jest.fn() }));
jest.mock("../../../src/services/comms-log.service", () => ({ record: jest.fn() }));
jest.mock("../../../src/services/whatsapp.service", () => ({ sendText: jest.fn() }));
jest.mock("../../../src/modules/email_campaigns/email-render", () => ({
  resolveBrandTokens: jest.fn(async () => ({
    brand_name: "Faitlynhair",
    brand_color: "#690909",
    year: "2026",
  })),
  renderStr: (html) => html,
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const { enqueue } = require("../../../src/jobs/queue");
const commsLog = require("../../../src/services/comms-log.service");
const whatsapp = require("../../../src/services/whatsapp.service");
const delivery = require("../../../src/modules/invoicing/receipt-delivery.service");

const receipt = (over = {}) => ({
  receipt_id: "22222222-2222-4222-8222-222222222222",
  receipt_number: "FLH-RCT-0003",
  invoice_number: "FLH-INV-0009",
  amount_ngn: "30000.00",
  payment_method: "bank_transfer",
  contact_id: "c2",
  contact_name: "Bisi A.",
  contact_email: "bisi@example.com",
  contact_phone: "+2348099999999",
  ...over,
});

describe("receipt publicViewUrl", () => {
  test("targets the public receipts view", () => {
    expect(delivery.publicViewUrl("faitlynhair", "r1")).toMatch(
      /\/api\/public\/receipts\/faitlynhair\/r1\/view$/,
    );
  });
});

describe("buildReceiptEmail", () => {
  test("acknowledges payment with amount + view link", async () => {
    const emailRender = require("../../../src/modules/email_campaigns/email-render");
    const tokens = await emailRender.resolveBrandTokens("faitlynhair");
    const url = "https://x/view";
    const out = delivery.buildReceiptEmail({ brandTokens: tokens, receipt: receipt(), viewUrl: url });
    expect(out.subject).toContain("FLH-RCT-0003");
    expect(out.html).toContain("₦30,000.00");
    expect(out.html).toContain(url);
  });
});

describe("dispatchReceipt", () => {
  afterEach(() => {
    delete process.env.INVOICE_DISPATCH_DISABLED;
  });

  test("email enqueues a receipt-send job tied to the receipt", async () => {
    const res = await delivery.dispatchReceipt({ brand: "faitlynhair", receipt: receipt(), channel: "email" });
    expect(res.dispatched).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      "email-send",
      "receipt-send",
      expect.objectContaining({
        to: "bisi@example.com",
        reference_type: "receipt",
        reference_id: receipt().receipt_id,
        event_key: "receipt.sent",
      }),
    );
  });

  test("kill-switch records intent, sends nothing", async () => {
    process.env.INVOICE_DISPATCH_DISABLED = "true";
    const res = await delivery.dispatchReceipt({ brand: "faitlynhair", receipt: receipt(), channel: "email" });
    expect(res.dispatched).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(commsLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "queued", reference_type: "receipt" }),
    );
  });

  test("print channel is not auto-delivered", async () => {
    const res = await delivery.dispatchReceipt({ brand: "faitlynhair", receipt: receipt(), channel: "print" });
    expect(res.dispatched).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("whatsapp sends inline and stamps the comms log", async () => {
    whatsapp.sendText.mockResolvedValueOnce({ messages: [{ id: "wamid.9" }] });
    const res = await delivery.dispatchReceipt({ brand: "faitlynhair", receipt: receipt(), channel: "whatsapp" });
    expect(res.dispatched).toBe(true);
    expect(commsLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "whatsapp", status: "sent", provider_ref: "wamid.9" }),
    );
  });
});
