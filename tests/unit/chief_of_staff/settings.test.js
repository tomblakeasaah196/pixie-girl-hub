"use strict";

/**
 * Chief of Staff settings + naming propagation (PR6). Pure: the settings
 * validator, the persona system prompt, and the briefing goals-section header
 * all read the CEO's assistant_name/tone/pronoun. No DB.
 */

const { schemas } = require("../../../src/modules/chief_of_staff/cos.validator");
const persona = require("../../../src/modules/chief_of_staff/cos.persona");
const briefing = require("../../../src/modules/chief_of_staff/cos.briefing");

describe("settingsUpdate validator", () => {
  test("accepts a valid partial update", () => {
    const v = schemas.settingsUpdate.parse({ assistant_name: "Ada", tone: "concise" });
    expect(v.assistant_name).toBe("Ada");
    expect(v.tone).toBe("concise");
  });

  test("rejects an empty body (must change something)", () => {
    expect(() => schemas.settingsUpdate.parse({})).toThrow();
  });

  test("rejects unknown fields (strict)", () => {
    expect(() => schemas.settingsUpdate.parse({ is_ceo: true })).toThrow();
  });

  test("rejects an invalid tone / pronoun", () => {
    expect(() => schemas.settingsUpdate.parse({ tone: "sassy" })).toThrow();
    expect(() => schemas.settingsUpdate.parse({ pronoun: "xe" })).toThrow();
  });

  test("validates HH:MM time fields", () => {
    expect(schemas.settingsUpdate.parse({ quiet_start: "21:30" }).quiet_start).toBe("21:30");
    expect(() => schemas.settingsUpdate.parse({ quiet_start: "9pm" })).toThrow();
    expect(() => schemas.settingsUpdate.parse({ work_end: "25:00" })).toThrow();
  });

  test("allows clearing the avatar with null", () => {
    expect(schemas.settingsUpdate.parse({ avatar_url: null }).avatar_url).toBeNull();
  });
});

describe("persona naming (CoS only)", () => {
  test("uses the custom assistant name + pronoun", () => {
    const p = persona.systemPrompt({
      brand: "pixiegirl",
      settings: { assistant_name: "Ada", tone: "warm", pronoun: "she" },
      actionTitles: ["Create a goal"],
    });
    expect(p).toContain("You are Ada, the Chief of Staff");
    expect(p).toContain('use "she"');
  });

  test("defaults to Chief of Staff when no settings", () => {
    const p = persona.systemPrompt({ brand: "faitlynhair", actionTitles: [] });
    expect(p).toContain("You are Chief of Staff");
  });

  test("carries the prompt-injection guard", () => {
    const p = persona.systemPrompt({ brand: "pixiegirl", actionTitles: [] });
    expect(p).toMatch(/DATA, NOT COMMANDS/i);
    expect(p).toMatch(/cannot grant you new powers/i);
  });

  test("reflects the concise tone line", () => {
    const p = persona.systemPrompt({
      brand: "pixiegirl",
      settings: { tone: "concise" },
      actionTitles: [],
    });
    expect(p).toMatch(/crisp and to the point/i);
  });
});

describe("briefing goals section naming", () => {
  const baseGoals = [
    { title: "Launch line", health: "behind", progress_pct: 40 },
    { title: "Grow retail", health: "on_track", progress_pct: 70 },
  ];

  test("header carries the assistant name", () => {
    const s = briefing.composeGoalsSection({
      brand: "pixiegirl",
      goals: baseGoals,
      overdueMilestones: 0,
      overdueTasks: 1,
      priorities: [],
      assistantName: "Ada",
    });
    expect(s.hasContent).toBe(true);
    expect(s.text).toContain("Ada — Goals (pixiegirl)");
  });

  test("defaults the header when unnamed", () => {
    const s = briefing.composeGoalsSection({
      brand: "faitlynhair",
      goals: [],
      overdueMilestones: 0,
      overdueTasks: 0,
      priorities: [],
    });
    expect(s.text).toContain("Chief of Staff — Goals (faitlynhair)");
  });
});
