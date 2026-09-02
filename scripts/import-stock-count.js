#!/usr/bin/env node
/**
 * Import a physical stock count and make it the system's number.
 *
 * WHY: a recount found the on-hand figures wrong across the wig catalogue —
 * some from sizing mistakes at first data entry, some from units that were
 * never right. The count sheet is the truth; the system has to be moved onto
 * it, in one signed correction rather than a hundred hand edits.
 *
 * HOW IT REPLACES THE NUMBERS: stock quantity only ever moves through
 * `stock_movements`, so this does NOT write to `stock_levels`. It files one
 * `count` stock adjustment whose lines carry `system_count` (what the system
 * believes today) and `physical_count` (what the sheet says). Posting the
 * adjustment writes a movement of exactly the difference — a base the system
 * thinks has 9 and the sheet says 2 gets a -7 movement and lands on 2. The
 * counted number REPLACES the system's; nothing is added on top, and the GL,
 * the movement log and the audit trail all stay consistent.
 *
 * The adjustment is created and SUBMITTED, never posted. Stock does not move
 * until the CEO approves and posts it in Stock → Adjustments — which is what
 * makes the correction hers on the record.
 *
 * SAFETY INTERLOCKS (all deliberate — do not remove without reading why):
 *  · Dry run by default. `--commit` is required to write anything.
 *  · A sheet row that matches no base product, or matches two, aborts the run.
 *    With --unlisted=zero an unmatched row would otherwise be read as "we hold
 *    none of this" and write real stock down to nil.
 *  · If stock sits at more than one location, --location must be named. The
 *    sheet has no location column, so zeroing "everything not on the sheet"
 *    at a guessed location would wipe the other one.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/import-stock-count.js --file count.xlsx                  # dry run
 *   node scripts/import-stock-count.js --file count.xlsx --commit
 *   node scripts/import-stock-count.js --file count.xlsx --blank=zero
 *   node scripts/import-stock-count.js --file count.xlsx --unlisted=skip
 *   node scripts/import-stock-count.js --file count.xlsx --location "Main Warehouse"
 *   node scripts/import-stock-count.js --file count.xlsx --user ceo@example.com
 *   node scripts/import-stock-count.js --file count.xlsx --report variance.csv
 */

"use strict";

const fs = require("fs");
const path = require("path");

const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { refreshBrands, VALID, t } = require("../src/config/brands");
const stockService = require("../src/modules/stock/stock.service");
const {
  parseCountRows,
  dedupeRows,
  matchRows,
} = require("./lib/stock-count-sheet");
const { readCountSheet } = require("./lib/read-count-sheet");
const {
  resolveLocation,
  buildLines,
  summarise,
  blockers,
} = require("./lib/stock-count-plan");

// ── CLI ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    file: null,
    brand: "faitlynhair",
    sheet: null,
    location: null,
    // A blank Units cell means "not counted" — leave the system's number
    // alone. Pass --blank=zero to read a blank as a counted nil instead.
    blank: "skip",
    // A base product the sheet never names is written down to zero: the sheet
    // is the single source of truth for what we hold.
    unlisted: "zero",
    user: null,
    report: null,
    commit: false,
    allowUnmatched: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case "--file":
      case "-f":
        args.file = value();
        break;
      case "--brand":
        args.brand = value();
        break;
      case "--sheet":
        args.sheet = value();
        break;
      case "--location":
        args.location = value();
        break;
      case "--blank":
        args.blank = value();
        break;
      case "--unlisted":
        args.unlisted = value();
        break;
      case "--user":
        args.user = value();
        break;
      case "--report":
        args.report = value();
        break;
      case "--commit":
        args.commit = true;
        break;
      case "--allow-unmatched":
        args.allowUnmatched = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option '${flag}'`);
    }
  }
  return args;
}

const USAGE = `
Import a physical stock count and file it as a 'count' adjustment for approval.

  --file <path>        .xlsx or .csv count sheet                    (required)
  --brand <key>        brand schema                       (default: faitlynhair)
  --sheet <name>       worksheet to read              (default: the first sheet)
  --location <id|name> stock location the count covers  (default: the only one)
  --blank skip|zero    what an empty Units cell means           (default: skip)
  --unlisted zero|skip products the sheet never names         (default: zero)
  --user <email>       who the adjustment is filed as         (default: the CEO)
  --report <path>      write the full variance table to a CSV
  --commit             actually file the adjustment      (default: dry run only)
  --allow-unmatched    proceed past every blocker listed above    (dangerous)
`;

// ── Catalogue + stock reads ──────────────────────────────

/** Every base product that can hold stock, with the columns the matcher uses. */
async function loadProducts(brand) {
  const { rows } = await query(
    `SELECT product_id, product_code, name, primary_colour, texture_type,
            lace_type, cap_size, lace_size_codes, track_stock
       FROM ${t(brand, "products")}
      WHERE is_deleted = false
        AND product_type = 'physical'`,
  );
  return rows;
}

/** On-hand per (product, variant) at one location — the system_count side. */
async function loadLevels(brand, location_id) {
  const { rows } = await query(
    `SELECT pv.product_id, pv.variant_id, pv.sku, pv.variant_name,
            pv.is_active, COALESCE(sl.on_hand, 0)::int AS on_hand,
            COALESCE(sl.reserved, 0)::int AS reserved
       FROM ${t(brand, "product_variants")} pv
       LEFT JOIN ${t(brand, "stock_levels")} sl
              ON sl.variant_id = pv.variant_id AND sl.location_id = $1
      ORDER BY pv.is_default DESC, pv.display_order ASC, pv.created_at ASC`,
    [location_id],
  );
  const byProduct = new Map();
  for (const r of rows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id).push(r);
  }
  return byProduct;
}

/** Locations holding stock, so a multi-location brand can't be half-counted. */
async function loadLocations(brand) {
  const { rows } = await query(
    `SELECT loc.location_id, loc.display_name, loc.is_default, loc.is_active,
            COALESCE(SUM(sl.on_hand), 0)::int AS on_hand
       FROM ${t(brand, "stock_locations")} loc
       LEFT JOIN ${t(brand, "stock_levels")} sl
              ON sl.location_id = loc.location_id
      GROUP BY loc.location_id, loc.display_name, loc.is_default, loc.is_active
      ORDER BY loc.is_default DESC, loc.display_name ASC`,
  );
  return rows;
}

/** Who the adjustment is filed as. A real user row is required (created_by FK). */
async function resolveUser(email) {
  if (email) {
    const { rows } = await query(
      `SELECT user_id, display_name, email FROM shared.users WHERE email = $1`,
      [email],
    );
    if (!rows[0]) throw new Error(`No user with email ${email}`);
    return rows[0];
  }
  const { rows } = await query(
    `SELECT user_id, display_name, email
       FROM shared.users
      WHERE is_ceo = true AND is_active = true
      ORDER BY created_at LIMIT 1`,
  );
  if (!rows[0])
    throw new Error(
      "No CEO user found — pass --user <email> to file the count as a specific user.",
    );
  return rows[0];
}

// ── Reporting ────────────────────────────────────────────

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function writeReport(file, { lines, unchanged, unmatched, skipped, problems }) {
  const header = [
    "outcome",
    "sheet_row",
    "product",
    "sku",
    "system_count",
    "physical_count",
    "delta",
    "note",
  ];
  const body = [];
  const push = (outcome, e, note = "") =>
    body.push([
      outcome,
      e.row ?? "",
      e.product?.name ?? "",
      e.variant?.sku ?? "",
      e.system_count ?? "",
      e.physical_count ?? "",
      e.system_count === undefined || e.system_count === null
        ? ""
        : e.physical_count - e.system_count,
      note,
    ]);

  for (const e of lines)
    push(e.kind === "unlisted" ? "zeroed" : "corrected", e);
  for (const e of unchanged) push("already_correct", e);
  for (const e of problems) push("needs_attention", e, e.error);
  for (const u of unmatched)
    body.push([
      "unmatched",
      u.row.row,
      `${u.row.colour} · ${u.row.texture} · ${u.row.cap} · ${u.row.size ?? u.row.sizeRaw}`,
      "",
      "",
      u.row.units ?? "",
      "",
      u.error,
    ]);
  for (const s of skipped)
    body.push([
      "not_counted",
      s.row.row,
      s.product.name,
      "",
      "",
      "",
      "",
      "blank Units cell — left as-is",
    ]);

  fs.writeFileSync(
    file,
    [header, ...body].map((r) => r.map(csvCell).join(",")).join("\n") + "\n",
  );
}

// ── Main ─────────────────────────────────────────────────

(async () => {
  let exitCode = 0;
  try {
    const args = parseArgs(process.argv);
    if (args.help || !args.file) {
      console.log(USAGE);
      if (!args.file && !args.help) throw new Error("--file is required");
      return;
    }
    if (!["skip", "zero"].includes(args.blank))
      throw new Error("--blank must be 'skip' or 'zero'");
    if (!["skip", "zero"].includes(args.unlisted))
      throw new Error("--unlisted must be 'skip' or 'zero'");
    if (!fs.existsSync(args.file))
      throw new Error(`No such file: ${args.file}`);

    await initDatabase();
    await refreshBrands();
    if (!VALID.has(args.brand))
      throw new Error(
        `Unknown brand '${args.brand}' — expected one of ${[...VALID].join(", ")}`,
      );

    // ── Read + parse the sheet ──
    const { sheetName, rows: rawRows } = await readCountSheet(
      args.file,
      args.sheet,
    );
    const parsed = parseCountRows(rawRows);
    const { rows: deduped, conflicts } = dedupeRows(parsed);

    console.log(
      `\n${path.basename(args.file)} → '${sheetName}': ${parsed.length} rows, ` +
        `${deduped.length} distinct combinations`,
    );
    const blanks = deduped.filter((r) => r.units === null).length;
    const countedUnits = deduped.reduce((s, r) => s + (r.units ?? 0), 0);
    console.log(
      `  ${deduped.length - blanks} with a number (${countedUnits} units), ` +
        `${blanks} blank → ${args.blank === "zero" ? "counted as ZERO" : "left as-is"}`,
    );

    for (const c of conflicts) console.warn(`  ✖ ${c.message}`);
    const badRows = parsed.filter((r) => r.error);
    for (const r of badRows) console.warn(`  ✖ row ${r.row}: ${r.error}`);

    // ── Match against the catalogue ──
    const products = await loadProducts(args.brand);
    const { matched, unmatched, skipped } = matchRows(deduped, products, {
      blank: args.blank,
    });
    console.log(
      `\nMatched ${matched.length} of ${deduped.length} combinations against ` +
        `${products.length} ${args.brand} base products`,
    );
    for (const u of unmatched) console.warn(`  ✖ row ${u.row.row}: ${u.error}`);

    // ── Reconcile against the shelf ──
    const locations = await loadLocations(args.brand);
    const location = resolveLocation(locations, args.location, args.unlisted);
    console.log(`Counting against location: ${location.display_name}`);

    const levelsByProduct = await loadLevels(args.brand, location.location_id);
    const matchedProductIds = new Set(
      [...matched, ...skipped].map((m) => m.product.product_id),
    );
    const { lines, problems, unchanged } = buildLines({
      matched,
      levelsByProduct,
      unlisted: args.unlisted,
      matchedProductIds,
    });
    for (const p of problems) console.warn(`  ✖ ${p.product.name}: ${p.error}`);

    // ── The variance, line by line ──
    const corrections = lines.filter((l) => l.kind === "counted");
    const zeroed = lines.filter((l) => l.kind === "unlisted");
    if (corrections.length) {
      console.log(`\n── Corrections from the sheet (${corrections.length}) ──`);
      for (const l of corrections) {
        const d = l.physical_count - l.system_count;
        console.log(
          `  row ${String(l.row).padStart(4)}  ${l.product.name.slice(0, 52).padEnd(52)} ` +
            `${String(l.system_count).padStart(4)} → ${String(l.physical_count).padStart(4)}  ` +
            `${d > 0 ? "+" : ""}${d}`,
        );
      }
    }
    if (zeroed.length) {
      console.log(
        `\n── Not on the sheet, written down to zero (${zeroed.length}) ──`,
      );
      for (const l of zeroed)
        console.log(
          `  ${(l.variant.sku || l.product.name).slice(0, 52).padEnd(52)} ` +
            `${String(l.system_count).padStart(4)} → 0  -${l.system_count}`,
        );
    }

    // ── Summary ──
    const { surplus, writeDown, net } = summarise(lines);
    const systemTotal = [...levelsByProduct.values()]
      .flat()
      .reduce((s, v) => s + v.on_hand, 0);
    console.log(
      `\nSystem holds ${systemTotal} units at ${location.display_name} today.\n` +
        `  ${lines.length} lines change  ·  ${unchanged.length} already correct\n` +
        `  +${surplus} found  ·  -${writeDown} written down  ` +
        `·  net ${net >= 0 ? "+" : ""}${net}\n` +
        `  ends at ${systemTotal + net} units`,
    );
    if (skipped.length)
      console.log(
        `  ${skipped.length} blank rows left untouched (--blank=zero would write them down)`,
      );

    // Written BEFORE the interlocks on purpose: a run that refuses to file is
    // exactly the run whose fix-list is worth having in Excel.
    if (args.report) {
      writeReport(args.report, {
        lines,
        unchanged,
        unmatched,
        skipped,
        problems,
      });
      console.log(`\nVariance report → ${args.report}`);
    }

    // ── Interlocks ──
    const stop = blockers({ conflicts, badRows, unmatched, problems });
    if (stop.length && !args.allowUnmatched) {
      console.error(
        `\nNOT filing: ${stop.join("; ")}.\n` +
          (unmatched.length && args.unlisted === "zero"
            ? "With --unlisted=zero an unmatched row reads as 'we hold none of this', " +
              "so those products would be written down to nil by mistake.\n"
            : "") +
          "Fix the sheet (or the catalogue), or re-run with --allow-unmatched " +
          "once you have checked every line above.",
      );
      exitCode = 1;
      return;
    }

    if (!lines.length) {
      console.log(
        "\nNothing to correct — the system already matches the sheet.",
      );
      return;
    }

    if (!args.commit) {
      console.log(
        "\nDry run — nothing was written. Re-run with --commit to file the " +
          "adjustment for approval.",
      );
      return;
    }

    // ── File it ──
    const user = await resolveUser(args.user);
    const adj = await stockService.createAdjustment({
      brand: args.brand,
      user,
      request_id: null,
      input: {
        location_id: location.location_id,
        adjustment_type: "count",
        // Capped at 500 to match the API's own validator (stock.validator.js),
        // so a count filed here is indistinguishable from one filed via HTTP.
        reason: (
          `Physical stock count — ${path.basename(args.file)}. ` +
          `${corrections.length} corrected from the sheet` +
          (zeroed.length ? `, ${zeroed.length} not counted and zeroed` : "") +
          `. Net ${net >= 0 ? "+" : ""}${net} units.`
        ).slice(0, 500),
        lines: lines.map((l) => ({
          variant_id: l.variant.variant_id,
          system_count: l.system_count,
          physical_count: l.physical_count,
          notes:
            l.kind === "unlisted"
              ? "Not on the count sheet — written down to zero."
              : `Count sheet row ${l.row}: ${l.product.name}`.slice(0, 500),
        })),
      },
    });
    await stockService.submitAdjustment({
      brand: args.brand,
      user,
      request_id: null,
      id: adj.adjustment_id,
    });

    console.log(
      `\n→ ${adj.adjustment_number} filed as ${user.display_name || user.email} ` +
        `and submitted for approval.\n` +
        "Stock has NOT moved yet. Open Stock → Adjustments, review the lines, " +
        "then approve and post to make the count the system's number.",
    );
  } catch (err) {
    console.error(`\nImport failed: ${err.message}`);
    exitCode = 1;
  } finally {
    await closeDatabase();
    process.exit(exitCode);
  }
})();
