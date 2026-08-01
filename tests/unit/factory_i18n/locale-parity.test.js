"use strict";

/**
 * Factory i18n — the guard that keeps "I switched to Chinese and it's still
 * English" from coming back.
 *
 * Three things have to stay in step or a factory manager lands on a half-
 * translated page:
 *
 *   1. Every key in the English baseline exists in every other bundled locale.
 *      A missing key silently falls back to English, which is exactly the bug.
 *   2. No non-English bundle leaks an untranslated ASCII-only string.
 *   3. The API's REQUIRED_KEYS matches the English baseline, so a language
 *      pasted into Settings → Factory Languages is validated against the SAME
 *      key set the app actually renders (the admin page derives its list from
 *      en.json; the API hardcodes one — they must not drift).
 *
 * Interpolation placeholders must survive translation too: "{{currency}}"
 * dropped from a Chinese string renders a label with a hole in it.
 */

const fs = require("fs");
const path = require("path");

const LOCALES_DIR = path.join(
  __dirname,
  "../../../apps/admin/src/i18n/locales",
);

const load = (code) =>
  JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"));

const en = load("en");
const others = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith(".json") && f !== "en.json")
  .map((f) => f.replace(/\.json$/, ""));

const placeholders = (s) => (s.match(/\{\{\s*\w+\s*\}\}/g) || []).sort();

describe("bundled factory locales", () => {
  it("ships at least one non-English locale", () => {
    expect(others.length).toBeGreaterThan(0);
    expect(others).toContain("zh");
  });

  it.each(others)("%s has exactly the English key set", (code) => {
    const other = load(code);
    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(others)("%s has no ASCII-only (untranslated) values", (code) => {
    const other = load(code);
    // A value that is pure ASCII in a CJK locale is an untranslated leftover.
    // Bare placeholders and pure punctuation/number labels are legitimate.
    const untranslated = Object.entries(other)
      .filter(([, v]) => /^[\x20-\x7E]+$/.test(v))
      .filter(([, v]) => /[A-Za-z]/.test(v.replace(/\{\{\s*\w+\s*\}\}/g, "")))
      .map(([k]) => k);
    expect(untranslated).toEqual([]);
  });

  it.each(others)("%s preserves every interpolation placeholder", (code) => {
    const other = load(code);
    const broken = Object.keys(en)
      .filter(
        (k) =>
          JSON.stringify(placeholders(en[k])) !==
          JSON.stringify(placeholders(other[k] ?? "")),
      )
      .map((k) => `${k}: en=${en[k]} / ${code}=${other[k]}`);
    expect(broken).toEqual([]);
  });

  it("uses `n`, not the plural-reserved `count`, for our own counters", () => {
    // i18next treats {{count}} as a plural selector and looks for key_one /
    // key_other. Our bundles are flat, so a {{count}} we introduce would not
    // resolve. (The pre-existing `reconcile` key is excluded — it is passed
    // through i18next's plural machinery by the ledger screen.)
    const offenders = Object.keys(en)
      .filter((k) => k !== "reconcile")
      .filter((k) => /\{\{\s*count\s*\}\}/.test(en[k]));
    expect(offenders).toEqual([]);
  });
});

describe("API validation matches the rendered key set", () => {
  it("REQUIRED_KEYS equals the English baseline", () => {
    const src = fs.readFileSync(
      path.join(
        __dirname,
        "../../../src/modules/factory_i18n/factory-i18n.controller.js",
      ),
      "utf8",
    );
    const block = src.match(/const REQUIRED_KEYS = \[([\s\S]*?)\n\];/);
    expect(block).not.toBeNull();
    const required = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(required.sort()).toEqual(Object.keys(en).sort());
  });
});

describe("production keys are actually present", () => {
  // Spot-check the groups the Production module renders, so a future refactor
  // that drops them fails here rather than in front of the factory manager.
  it.each([
    "productionTitle",
    "productionRunsTab",
    "addCost",
    "addProducts",
    "receiveUnits",
    "costHiddenForRole",
    "runStatus.in_production",
    "unitStatus.qc_pass",
    "costType.freight_international",
    "costType.3pl_lagos",
  ])("%s exists in every locale", (key) => {
    expect(en[key]).toBeTruthy();
    for (const code of others) expect(load(code)[key]).toBeTruthy();
  });
});
