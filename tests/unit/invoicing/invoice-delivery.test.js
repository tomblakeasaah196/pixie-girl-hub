"use strict";

// Mock the heavy edges so the delivery logic is testable without DB/Redis/SMTP.
jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "http://localhost:7000" },
}));
jest.mock("../../../src/jobs/queue", () => ({ enqueue: jest.fn() }));
jest.mock("../../../src/services/comms-log.service", () => ({ record: jest.fn() }));
jest.mock("../../../src/services/whatsapp.service", () => ({ sendText: jest.fn() }));
jest.mock("../../../src/modules/email_campaigns/email-render", () => ({
  resolveBrandTokens: jest.fn(async () => ({
    brand_name: "Pixie Girl Global",
    brand_color: "#690909",
    support_email: "care@pixiegirlglobal.com",
    website_url: "https://pixiegirlglobal.com",
    year: "2026",
  })),
  // email-theme.renderStr passes through {{tokens}}; the real one is fine, but
  // wrapEmail uses it via the theme module which we don't mock.
  renderStr: (html) => html,
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const { enqueue } = require("../../../src/jobs/queue");
const commsLog = require("../../../src/services/comms-log.service");
const whatsapp = require("../../../src/services/whatsapp.service");
const delivery = require("../../../src/modules/invoicing/invoice-delivery.service");

const invoice = (over = {}) => ({
  invoice_id: "11111111-1111-4111-8111-111111111111",
  invoice_number: "PXG-INV-0007",
  total_ngn: "50000.00",
  balance_due_ngn: "50000.00",
  due_date: "2026-07-15",
  contact_id: "c1",
  contact_name: "Ada Obi",
  contact_email: "ada@example.com",
  contact_phone: "+2348012345678",
  ...over,
});

describe("publicViewUrl", () => {
  test("embeds brand + invoice id (unguessable UUID link)", () => {
    const url = delivery.publicViewUrl("pixiegirl", "abc-123");
    expect(url).toMatch(/\/api\/public\/invoices\/pixiegirl\/abc-123\/view$/);
  });
});

describe("buildInvoiceEmail", () => {
  test("carries the invoice number, amount due and the view link", async () => {
    const emailRender = require("../../../src/modules/email_campaigns/email-render");
    const tokens = await emailRender.resolveBrandTokens("pixiegirl");
    const viewUrl = delivery.publicViewUrl("pixiegirl", invoice().invoice_id);
    const out = delivery.buildInvoiceEmail({
      brandTokens: tokens,
      invoice: invoice(),
      viewUrl,
    });
    expect(out.subject).toContain("PXG-INV-0007");
    expect(out.subject).toContain("₦50,000.00");
    expect(out.html).toContain(viewUrl);
    expect(out.text).toContain("PXG-INV-0007");
  });

  test("a settled invoice does not nag for payment", async () => {
    const emailRender = require("../../../src/modules/email_campaigns/email-render");
    const tokens = await emailRender.resolveBrandTokens("pixiegirl");
    const out = delivery.buildInvoiceEmail({
      brandTokens: tokens,
      invoice: invoice({ balance_due_ngn: "0.00" }),
      viewUrl: "https://x/view",
    });
    expect(out.subject).not.toMatch(/due/i);
  });
});

describe("dispatchInvoice", () => {
  afterEach(() => {
    delete process.env.INVOICE_DISPATCH_DISABLED;
  });

  test("email channel enqueues an email-send job tied to the invoice", async () => {
    const res = await delivery.dispatchInvoice({
      brand: "pixiegirl",
      invoice: invoice(),
      channel: "email",
    });
    expect(res.dispatched).toBe(true);
    expect(res.channel).toBe("email");
    expect(enqueue).toHaveBeenCalledWith(
      "email-send",
      "invoice-send",
      expect.objectContaining({
        brand: "pixiegirl",
        to: "ada@example.com",
        reference_type: "invoice",
        reference_id: invoice().invoice_id,
        event_key: "invoice.sent",
      }),
    );
  });

  test("no email on file → not dispatched, logged as failed", async () => {
    const res = await delivery.dispatchInvoice({
      brand: "pixiegirl",
      invoice: invoice({ contact_email: null }),
      channel: "email",
    });
    expect(res.dispatched).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(commsLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", reference_type: "invoice" }),
    );
  });

  test("kill-switch records intent but sends nothing", async () => {
    process.env.INVOICE_DISPATCH_DISABLED = "true";
    const res = await delivery.dispatchInvoice({
      brand: "pixiegirl",
      invoice: invoice(),
      channel: "email",
    });
    expect(res.dispatched).toBe(false);
    expect(res.reason).toMatch(/disabled/);
    expect(enqueue).not.toHaveBeenCalled();
    expect(commsLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "queued" }),
    );
  });

  test("whatsapp channel sends inline and stamps the comms log", async () => {
    whatsapp.sendText.mockResolvedValueOnce({ messages: [{ id: "wamid.1" }] });
    const res = await delivery.dispatchInvoice({
      brand: "pixiegirl",
      invoice: invoice(),
      channel: "whatsapp",
    });
    expect(res.dispatched).toBe(true);
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+2348012345678" }),
    );
    expect(commsLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        status: "sent",
        provider_ref: "wamid.1",
      }),
    );
  });
});
