"use strict";

/**
 * Email render pipeline — brand/campaign/recipient token resolution, the static
 * countdown, and the final per-recipient build (pixel + List-Unsubscribe).
 */

jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "https://app.test", CDN_BASE_URL: "" },
}));
jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn() },
}));

const { query } = require("../../../src/config/database");
const render = require("../../../src/modules/email_campaigns/email-render");

afterEach(() => {
  jest.clearAllMocks();
  render.invalidateBrand();
});

describe("countdown", () => {
  test("~2 days out reads honestly (round, not ceil)", () => {
    const end = new Date(Date.now() + 49 * 3_600_000).toISOString(); // 49h
    const c = render.countdown(end);
    expect(c.deadline_phrase).toBe("Only 2 days left");
    expect(c.days_left).toBe("2");
    expect(c.sale_end_display).toMatch(/\d+ \w+/);
  });

  test("under a day → final hours", () => {
    const end = new Date(Date.now() + 5 * 3_600_000).toISOString();
    expect(render.countdown(end).deadline_phrase).toBe("Final hours — ends today");
  });

  test("past deadline → last chance", () => {
    const end = new Date(Date.now() - 3_600_000).toISOString();
    const c = render.countdown(end);
    expect(c.deadline_phrase).toBe("Last chance");
    expect(c.days_left).toBe("0");
  });

  test("invalid date is safe (blank tokens)", () => {
    expect(render.countdown("not-a-date")).toEqual({
      days_left: "",
      deadline_phrase: "",
      sale_end_display: "",
    });
  });
});

describe("renderStr", () => {
  test("fills known tokens, blanks unknown (never leaks {{x}} or 'undefined')", () => {
    const out = render.renderStr("Hi {{first_name}}, {{discount}}% off {{nope}}", {
      first_name: "Ada",
      discount: "30",
    });
    expect(out).toBe("Hi Ada, 30% off ");
    expect(out).not.toMatch(/\{\{|undefined/);
  });
});

describe("resolveCampaignTokens", () => {
  test("maps sale fields, absolutises link, derives countdown, defaults CTA", () => {
    const end = new Date(Date.now() + 49 * 3_600_000).toISOString();
    const t = render.resolveCampaignTokens({
      merge_data: { discount: "30", sale_url: "shop.test/sale", sale_ends_at: end, vip: true },
    });
    expect(t.discount).toBe("30");
    expect(t.sale_url).toBe("https://shop.test/sale");
    expect(t.cta_url).toBe("https://shop.test/sale");
    expect(t.cta_label).toBe("Shop the collection");
    expect(t.deadline_phrase).toBe("Only 2 days left");
    expect(t.vip).toBe("true"); // custom scalar passed through, stringified
  });

  test("ignores nested objects and missing merge_data", () => {
    const t = render.resolveCampaignTokens({ merge_data: { bad: { a: 1 } } });
    expect(t.bad).toBeUndefined();
    expect(render.resolveCampaignTokens({})).toBeTruthy();
  });
});

describe("resolveBrandTokens", () => {
  test("pulls identity from business_config; logo + site become absolute", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          display_name: "Pixie Girl Global",
          legal_name: "Pixie Girl Global Ltd",
          accent_colour: "#690909",
          secondary_colour: "#A81D1D",
          logo_path: "/media/logo.png",
          brand_theme: {},
          website: "pixiegirlglobal.com",
          support_email: "support@pixiegirlglobal.com",
          address: "Lekki, Lagos",
        },
      ],
    });
    const t = await render.resolveBrandTokens("pixiegirl");
    expect(t.brand_name).toBe("Pixie Girl Global");
    expect(t.logo_url).toBe("https://app.test/media/logo.png");
    expect(t.website_url).toBe("https://pixiegirlglobal.com");
    expect(t.brand_color).toBe("#690909");
    expect(t.brand_color_deep).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t.brand_color_deep).not.toBe("#690909");
    expect(t.year).toBe(String(new Date().getFullYear()));
  });

  test("falls back gracefully when the brand row is missing", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const t = await render.resolveBrandTokens("ghost");
    expect(t.brand_color).toBe("#690909"); // sane default
    expect(t.logo_url).toBe("");
  });
});

describe("buildEmail", () => {
  const template = {
    subject_line: "Up to {{discount}}% off, {{first_name}}",
    html_body:
      "<html><body><p>Hi {{first_name}}, shop at {{sale_url}}. Brand {{brand_name}} ({{brand_color}}). <a href='{{unsubscribe_url}}'>off</a></p></body></html>",
    plain_text_body: "Hi {{first_name}} — {{discount}}% off at {{sale_url}}",
  };
  const brandTokens = {
    brand_name: "Pixie Girl Global",
    brand_color: "#690909",
    support_email: "support@pixiegirlglobal.com",
    year: "2026",
  };
  const recipient = {
    recipient_id: "rid-123",
    contact_name_snapshot: "Adaeze Obi",
    email: "adaeze@example.com",
  };

  test("substitutes all layers, injects pixel, sets one-click unsubscribe", () => {
    const campaignTokens = render.resolveCampaignTokens({
      merge_data: { discount: "30", sale_url: "shop.test/x" },
    });
    const out = render.buildEmail({ template, brandTokens, campaignTokens, recipient, brand: "pixiegirl" });

    expect(out.subject).toBe("Up to 30% off, Adaeze");
    expect(out.html).not.toMatch(/\{\{/);
    expect(out.html).toContain("Pixie Girl Global");
    expect(out.html).toContain("https://shop.test/x");
    expect(out.html).toContain("/api/public/email/open/rid-123");
    expect(out.html).toContain("/api/public/email/unsubscribe/rid-123");
    expect(out.text).toBe("Hi Adaeze — 30% off at https://shop.test/x");
    expect(out.headers["List-Unsubscribe"]).toContain("rid-123");
    expect(out.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  test("derives plain text from html when the template has none", () => {
    const out = render.buildEmail({
      template: { subject_line: "Hi", html_body: "<p>Hello {{first_name}}</p>", plain_text_body: null },
      brandTokens,
      campaignTokens: {},
      recipient,
      brand: "pixiegirl",
    });
    expect(out.text).toContain("Hello Adaeze");
    expect(out.text).not.toMatch(/<[^>]+>/);
  });
});
