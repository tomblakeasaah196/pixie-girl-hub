"use strict";

const v = require("../../../src/modules/outbound_policy/outbound-policy.validator");

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

describe("outbound_policy validators", () => {
  test("accepts a complete upsert", () => {
    const { called, req } = run(v.validateUpsert, {
      event_key: "payment_reminder",
      channel_preference: "whatsapp",
      fallback_channel: "email",
      rationale: "Recovery rate justifies ₦11",
      block_whatsapp: false,
      is_active: true,
    });
    expect(called).toBe(true);
    expect(req.body.channel_preference).toBe("whatsapp");
  });

  test("rejects invalid channel_preference", () => {
    const { error } = run(v.validateUpsert, {
      event_key: "x",
      channel_preference: "carrier_pigeon",
    });
    expect(error).toBeDefined();
  });

  test("respect_contact_pref is a valid choice", () => {
    const { called } = run(v.validateUpsert, {
      event_key: "marketing_blast",
      channel_preference: "respect_contact_pref",
      block_whatsapp: true,
    });
    expect(called).toBe(true);
  });
});
