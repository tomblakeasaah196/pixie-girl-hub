"use strict";

/**
 * Brand Voice validator tests — the Zod schema is the only boundary
 * gate between the editor UI and shared.brand_voice_config.
 */

const v = require("../../../src/modules/ai_governance/governance.validator");

function run(mw, body) {
  const req = { body };
  let called = false;
  let error;
  try {
    mw(req, {}, () => {
      called = true;
    });
  } catch (e) {
    error = e;
  }
  return { req, called, error };
}

describe("brand-voice validator", () => {
  test("accepts an empty payload (all fields optional)", () => {
    const { called } = run(v.validateBrandVoiceUpsert, {});
    expect(called).toBe(true);
  });

  test("accepts a complete payload", () => {
    const { called } = run(v.validateBrandVoiceUpsert, {
      tone: "warm, luxe, playful",
      voice_summary: "We speak like a confident best friend.",
      signature_html: "— The Pixie Girl team 🌹",
      do_donts: {
        do: ["Greet by first name", "Use the brand emojis"],
        dont: ["Never promise specific delivery dates"],
      },
      faq_markdown: "## Returns\nWe accept returns within 7 days.",
      sample_transcripts: [
        {
          label: "Returns enquiry",
          customer: "Hi can I return?",
          staff: "Of course.",
        },
      ],
      primary_emojis: ["🌹", "✨"],
      classify_inbound: false,
      draft_on_tap: true,
    });
    expect(called).toBe(true);
  });

  test("rejects oversize do_donts arrays", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `rule ${i}`);
    const { error } = run(v.validateBrandVoiceUpsert, {
      do_donts: { do: tooMany },
    });
    expect(error).toBeDefined();
  });

  test("rejects malformed sample transcripts", () => {
    const { error } = run(v.validateBrandVoiceUpsert, {
      sample_transcripts: [{ unknown_field: "x" }],
    });
    expect(error).toBeDefined();
  });
});
