"use strict";

const v = require("../../../src/modules/customer_onboarding/customer-onboarding.validator");

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

describe("customer onboarding validators", () => {
  test("rejects submission with no contact method", () => {
    const { error } = run(v.validateSubmission, {
      first_name: "Ada",
      delivery_address: {
        line1: "12 Admiralty Way",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
        country_code: "NG",
      },
    });
    expect(error).toBeDefined();
  });

  test("accepts a complete submission", () => {
    const { called, req } = run(v.validateSubmission, {
      first_name: "Ada",
      last_name: "Okafor",
      primary_phone: "+2348012345678",
      whatsapp_number: "+2348012345678",
      email: "ada@example.com",
      instagram_handle: "ada",
      preferred_channel: "whatsapp",
      date_of_birth: "1995-04-12",
      delivery_address: {
        line1: "12 Admiralty Way",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
        country_code: "NG",
        latitude: 6.43,
        longitude: 3.42,
        google_maps_url: "https://maps.app.goo.gl/abc",
      },
    });
    expect(called).toBe(true);
    expect(req.body.preferred_channel).toBe("whatsapp");
  });

  test("link create requires a business", () => {
    const { error } = run(v.validateCreateLink, {});
    expect(error).toBeDefined();
  });
});
