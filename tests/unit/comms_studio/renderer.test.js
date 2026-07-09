"use strict";

/**
 * Communications Studio renderer — pure functions, no DB. Covers the
 * shared substitution + block compiler that every automated send uses.
 */

const renderer = require("../../../src/modules/comms_studio/renderer");

describe("comms_studio.renderer", () => {
  describe("renderStr", () => {
    test("substitutes known tokens", () => {
      expect(
        renderer.renderStr("Hi {{first_name}}!", { first_name: "Adaeze" }),
      ).toBe("Hi Adaeze!");
    });

    test("collapses unknown tokens to empty", () => {
      expect(
        renderer.renderStr("Hi {{first_name}} {{unknown}}", {
          first_name: "Adaeze",
        }),
      ).toBe("Hi Adaeze ");
    });

    test("handles null/undefined inputs safely", () => {
      expect(renderer.renderStr(null, { a: "b" })).toBe("");
      expect(renderer.renderStr("Hi {{a}}", null)).toBe("Hi ");
    });

    test("dotted token names resolve top-level only", () => {
      expect(
        renderer.renderStr("{{brand.name}}", { "brand.name": "Pixie" }),
      ).toBe("Pixie");
    });
  });

  describe("compileBlocks", () => {
    test("empty array returns empty string", () => {
      expect(renderer.compileBlocks([])).toBe("");
    });

    test("compiles a heading block into <h1>", () => {
      const html = renderer.compileBlocks([
        { type: "heading", text: "Welcome" },
      ]);
      expect(html).toContain("<h1");
      expect(html).toContain("Welcome");
    });

    test("compiles a button block with href", () => {
      const html = renderer.compileBlocks([
        { type: "button", label: "Track", href: "https://example.com/track" },
      ]);
      expect(html).toContain("https://example.com/track");
      expect(html).toContain("Track");
    });

    test("silently drops unknown block types", () => {
      const html = renderer.compileBlocks([
        { type: "heading", text: "OK" },
        { type: "unknown_type", text: "IGNORED" },
      ]);
      expect(html).toContain("OK");
      expect(html).not.toContain("IGNORED");
    });

    test("preserves tokens inside blocks for the outer substitution pass", () => {
      const html = renderer.compileBlocks([
        { type: "heading", text: "Hi {{first_name}}" },
      ]);
      expect(html).toContain("{{first_name}}");
    });
  });

  describe("buildEmail", () => {
    test("substitutes brand + variable tokens after wrapping", () => {
      const result = renderer.buildEmail({
        automation: {
          subject_template: "Order {{order_number}} — {{first_name}}",
          preheader_template: "at {{brand_name}}",
          email_blocks_json: [
            { type: "heading", text: "Order {{order_number}}" },
            { type: "paragraph", html: "Hi {{first_name}}." },
            { type: "button", label: "Track", href: "https://x.test" },
          ],
        },
        brandTokens: {
          brand_name: "Pixie Girl",
          brand_color: "#690909",
          logo_url: "",
          website_url: "",
          year: "2026",
        },
        variables: {
          first_name: "Adaeze",
          order_number: "PXG-1024",
        },
      });
      expect(result.subject).toBe("Order PXG-1024 — Adaeze");
      expect(result.html).toContain("Order PXG-1024");
      expect(result.html).toContain("Hi Adaeze.");
      // preheader is rendered inside the wrapper — brand_name substituted:
      expect(result.html).toContain("at Pixie Girl");
      // brand_color substituted into the CSS as the accent:
      expect(result.html).toContain("#690909");
    });
  });

  describe("buildWhatsApp", () => {
    test("substitutes tokens in the WA body", () => {
      expect(
        renderer.buildWhatsApp({
          automation: {
            whatsapp_body_template: "Hi {{first_name}}! Order {{order_number}}",
          },
          variables: { first_name: "Adaeze", order_number: "PXG-1024" },
        }),
      ).toBe("Hi Adaeze! Order PXG-1024");
    });
  });

  describe("extractTokens", () => {
    test("returns unique token names in order", () => {
      expect(
        renderer.extractTokens("{{a}} {{b}} {{a}} {{c}}"),
      ).toEqual(["a", "b", "c"]);
    });

    test("returns empty for null/blank input", () => {
      expect(renderer.extractTokens(null)).toEqual([]);
      expect(renderer.extractTokens("")).toEqual([]);
      expect(renderer.extractTokens("no tokens here")).toEqual([]);
    });
  });
});
