"use strict";

const v = require("../../../src/shared/contacts/contacts.validator");

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

describe("contacts validator — contactCreate", () => {
  test("accepts a minimal payload (display_name + primary_phone)", () => {
    const { called, req, error } = run(v.validateCreate, {
      display_name: "Rynna Nasah",
      primary_phone: "+2349020868023",
    });
    expect(error).toBeUndefined();
    expect(called).toBe(true);
    expect(req.body.display_name).toBe("Rynna Nasah");
    expect(req.body.primary_phone).toBe("+2349020868023");
  });

  test("accepts the full Rynna payload incl. instagram_handle with leading @", () => {
    const { called, req, error } = run(v.validateCreate, {
      contact_type: ["customer"],
      display_name: "Rynna Nasah",
      first_name: "Rynna",
      last_name: "Nasah",
      primary_phone: "+2349020868023",
      whatsapp_number: "+2349020868023",
      email: "blakeasaah@gmail.com",
      instagram_handle: "@_saved_by__grace__",
      priority_level: "new",
      source: "instagram_dm",
      country_code: "NG",
    });
    expect(error).toBeUndefined();
    expect(called).toBe(true);
    // The leading '@' must be stripped so we store the canonical form.
    expect(req.body.instagram_handle).toBe("_saved_by__grace__");
    expect(req.body.email).toBe("blakeasaah@gmail.com");
    expect(req.body.priority_level).toBe("new");
  });

  test("accepts instagram_handle without leading @", () => {
    const { req, error } = run(v.validateCreate, {
      display_name: "Test",
      primary_phone: "+2348012345678",
      instagram_handle: "amara.style",
    });
    expect(error).toBeUndefined();
    expect(req.body.instagram_handle).toBe("amara.style");
  });

  test("rejects display_name when empty", () => {
    const { error, called } = run(v.validateCreate, {
      display_name: "",
      primary_phone: "+2349020868023",
    });
    expect(called).toBe(false);
    expect(error).toBeDefined();
  });

  test("rejects an invalid gender value (the UI used to send 'female')", () => {
    const { error, called } = run(v.validateCreate, {
      display_name: "Rynna",
      primary_phone: "+2349020868023",
      gender: "female", // ← old broken UI value
    });
    expect(called).toBe(false);
    expect(error).toBeDefined();
  });

  test("accepts the canonical gender enum (F / M / other / prefer_not)", () => {
    for (const g of ["F", "M", "other", "prefer_not"]) {
      const { error, called } = run(v.validateCreate, {
        display_name: "X",
        primary_phone: "+2349000000000",
        gender: g,
      });
      expect(error).toBeUndefined();
      expect(called).toBe(true);
    }
  });

  test("treats empty-string social handles as not-provided", () => {
    const { error, req } = run(v.validateCreate, {
      display_name: "X",
      primary_phone: "+2349000000000",
      instagram_handle: "",
      tiktok_handle: "",
    });
    expect(error).toBeUndefined();
    expect(req.body.instagram_handle).toBeUndefined();
    expect(req.body.tiktok_handle).toBeUndefined();
  });

  test("rejects an instagram_handle containing a space", () => {
    const { error } = run(v.validateCreate, {
      display_name: "X",
      primary_phone: "+2349000000000",
      instagram_handle: "saved by grace",
    });
    expect(error).toBeDefined();
  });

  test("rejects extra unknown top-level fields (.strict)", () => {
    const { error } = run(v.validateCreate, {
      display_name: "X",
      primary_phone: "+2349000000000",
      not_a_real_field: "oops",
    });
    expect(error).toBeDefined();
  });

  test("validateUpdate is a partial — accepts a single-field patch", () => {
    const { error, req, called } = run(v.validateUpdate, {
      instagram_handle: "@new_handle",
    });
    expect(error).toBeUndefined();
    expect(called).toBe(true);
    expect(req.body.instagram_handle).toBe("new_handle");
  });
});
