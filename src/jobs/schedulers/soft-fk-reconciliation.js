/**
 * Soft-FK reconciliation sweep (F-13, C-3).
 * Nightly. Iterates shared.soft_fk_registry, finds orphaned source rows,
 * and writes findings to shared.soft_fk_reconciliation_findings.
 *
 * Table names and column names come from the DB-managed registry — they are
 * checked against a safe-identifier pattern before interpolation.
 */

"use strict";

const { query } = require("../../config/database");
const { BRANDS } = require("../../config/brands");
const { logger } = require("../../config/logger");

// Guard against any rogue registry row injecting SQL
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function assertIdents(...names) {
  for (const n of names) {
    if (!SAFE_IDENT.test(n))
      throw new Error(`Unsafe identifier in soft-FK registry: "${n}"`);
  }
}

async function runSoftFkReconciliation() {
  const { rows: startRows } = await query(
    `SELECT shared.fn_soft_fk_reconciliation_start() AS run_id`,
  );
  const run_id = startRows[0].run_id;
  let totalOrphans = 0;

  try {
    const { rows: pairs } = await query(
      `SELECT * FROM shared.soft_fk_registry WHERE is_active = true`,
    );

    for (const pair of pairs) {
      assertIdents(
        pair.source_schema, pair.source_table, pair.source_column,
        pair.target_table, pair.target_column,
      );
      if (pair.source_discriminator_column)
        assertIdents(pair.source_discriminator_column);

      const brandTargets =
        pair.target_schema_pattern === "{business}" ? [...BRANDS] : [pair.target_schema_pattern];

      for (const targetSchema of brandTargets) {
        assertIdents(targetSchema);

        const filterParams = [];
        const filterClauses = [`s.${pair.source_column} IS NOT NULL`];
        let pi = 1;

        if (pair.source_discriminator_column && pair.source_discriminator_value) {
          filterClauses.push(`s.${pair.source_discriminator_column} = $${pi++}`);
          filterParams.push(pair.source_discriminator_value);
        }

        // For per-brand targets, restrict source rows to that brand so we
        // don't report cross-brand false positives.
        if (pair.target_schema_pattern === "{business}") {
          filterClauses.push(`s.business = $${pi++}`);
          filterParams.push(targetSchema);
        }

        let orphans;
        try {
          const { rows } = await query(
            `SELECT s.${pair.source_column}::text AS missing_target_id,
                    s.${pair.source_column}::text AS source_row_pk
               FROM ${pair.source_schema}.${pair.source_table} s
              WHERE ${filterClauses.join(" AND ")}
                AND NOT EXISTS (
                  SELECT 1 FROM ${targetSchema}.${pair.target_table} t
                   WHERE t.${pair.target_column} = s.${pair.source_column}
                )
              LIMIT 500`,
            filterParams,
          );
          orphans = rows;
        } catch (err) {
          logger.warn(
            { err, source_table: pair.source_table, targetSchema },
            "soft-fk check query failed — skipping pair",
          );
          continue;
        }

        for (const o of orphans) {
          try {
            await query(
              `INSERT INTO shared.soft_fk_reconciliation_findings
                 (run_id, registry_id, source_row_pk, missing_target_id)
               VALUES ($1, $2, $3, $4::uuid)
               ON CONFLICT DO NOTHING`,
              [run_id, pair.registry_id, o.source_row_pk, o.missing_target_id],
            );
            totalOrphans += 1;
          } catch (err) {
            logger.warn({ err, registry_id: pair.registry_id }, "finding insert failed");
          }
        }
      }
    }

    await query(
      `SELECT shared.fn_soft_fk_reconciliation_finish($1, $2, NULL)`,
      [run_id, totalOrphans],
    );
    logger.info({ run_id, totalOrphans, pairs: pairs.length }, "soft-FK recon complete");
  } catch (err) {
    await query(
      `SELECT shared.fn_soft_fk_reconciliation_finish($1, $2, $3)`,
      [run_id, totalOrphans, String(err.message)],
    ).catch(() => {});
    logger.error({ err, run_id }, "soft-FK reconciliation failed");
  }

  return { run_id, totalOrphans };
}

module.exports = { runSoftFkReconciliation };
