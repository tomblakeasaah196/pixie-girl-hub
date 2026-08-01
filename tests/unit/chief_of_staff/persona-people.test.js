"use strict";

// The persona's people-resolution contract: the roster shows JOB TITLES (how
// the CEO refers to people — "the operations manager"), and the prompt carries
// an explicit disambiguation protocol — several matches → ask which one, zero
// matches → say so, never invent a user_id. cos.persona is pure (no I/O), so
// these assert on the rendered prompt directly.

const persona = require("../../../src/modules/chief_of_staff/cos.persona");

const U = (over = {}) => ({
  user_id: "11111111-1111-4111-8111-111111111111",
  display_name: "Ada Obi",
  role_name: "Staff",
  is_ceo: false,
  ...over,
});

const render = (roster, truncated = false) =>
  persona.systemPrompt({
    brand: "pixiegirl",
    actionTitles: ["Find a teammate (for assignment)"],
    roster,
    rosterTruncated: truncated,
  });

describe("cos.persona — roster shows job titles", () => {
  test("job title leads, RBAC role follows when it adds information", () => {
    const p = render([U({ job_title: "Operations Manager", role_name: "Staff" })]);
    expect(p).toContain("Ada Obi · Operations Manager · Staff — user_id:");
  });

  test("duplicate title/role collapses to one label (case-insensitive)", () => {
    const p = render([U({ job_title: "Manager", role_name: "manager" })]);
    expect(p).toContain("Ada Obi · Manager — user_id:");
    expect(p).not.toContain("Manager · manager");
  });

  test("no staff profile → falls back to the role alone, no stray separator", () => {
    const p = render([U({ job_title: null, role_name: "BDM" })]);
    expect(p).toContain("Ada Obi · BDM — user_id:");
  });

  test("no title and no role still renders the person cleanly", () => {
    const p = render([U({ job_title: null, role_name: null })]);
    expect(p).toContain("• Ada Obi — user_id:");
  });

  test("truncated roster points at search_users by name, job title or role", () => {
    const p = render([U()], true);
    expect(p).toMatch(/call search_users by name, job title or role/);
  });
});

describe("cos.persona — person-resolution protocol", () => {
  const p = render([U()]);

  test("declares what search_users matches, including job titles", () => {
    expect(p).toContain("RESOLVING A PERSON — NAME, JOB TITLE OR ROLE:");
    expect(p).toMatch(/matches name, email, job title/);
    expect(p).toMatch(/retry once with a shorter fragment/);
  });

  test("several matches → ask the CEO, hold dependent steps", () => {
    expect(p).toMatch(/two Samuels.*do NOT pick one/);
    expect(p).toMatch(/hold back EVERY step that depends on that person/);
  });

  test("zero matches → never invent a user_id or substitute a contact", () => {
    expect(p).toMatch(/never invent a user_id/);
    expect(p).toMatch(/never substitute a contact/);
  });

  test("single match needs no round-trip question", () => {
    expect(p).toMatch(/EXACTLY ONE match → use that user_id without asking/);
  });
});
