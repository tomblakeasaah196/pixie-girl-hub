"use strict";

const v = require("../../../src/modules/customer_assets/customer-assets.validator");

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

const UUID = "11111111-1111-1111-1111-111111111111";

describe("customer asset validators (PR3)", () => {
  test("check-in requires owner_contact_id", () => {
    expect(run(v.validateCheckIn, {}).error).toBeDefined();
    expect(
      run(v.validateCheckIn, { owner_contact_id: "not-a-uuid" }).error,
    ).toBeDefined();
    const { called } = run(v.validateCheckIn, {
      owner_contact_id: UUID,
      condition_note: "lace intact",
    });
    expect(called).toBe(true);
  });

  test("check-out status is optional but bounded", () => {
    expect(run(v.validateCheckOut, {}).called).toBe(true);
    expect(
      run(v.validateCheckOut, { status: "returned_to_owner" }).called,
    ).toBe(true);
    expect(run(v.validateCheckOut, { status: "lost" }).called).toBe(true);
    expect(
      run(v.validateCheckOut, { status: "teleported" }).error,
    ).toBeDefined();
  });
});
