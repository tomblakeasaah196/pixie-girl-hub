/**
 * Nomba ledger reconciliation sweep — the pull-based safety net independent
 * of inbound webhooks (owner decision, 2026-07: "Nomba is our bank, we
 * should see everything").
 *
 * Webhooks can silently fail (bad signature key, dashboard misconfigured,
 * server down at the moment of delivery) with zero visible error — that's
 * what caused the empty POS Reconciliation screen despite real payments
 * having happened. This sweep asks Nomba directly, via
 * `GET /v1/transactions/bank` (the account's own credit/debit ledger — the
 * business banks WITH Nomba, so this is the definitive statement, covering
 * POS terminal taps, transfers-in, and checkout settlements alike), and
 * parks any CREDIT this system has no matching payment for into the same
 * `pos_terminal_reconciliation` queue staff already work from.
 *
 * Runs every 10 minutes (see jobs/schedulers/nomba-ledger-sync.js) with a
 * generous lookback overlap so a slow cron tick or a brief Nomba outage
 * can't create a gap; the unique index on (provider, provider_reference)
 * makes re-scanning the same window a no-op.
 */

"use strict";

const { VALID_BRANDS } = require("../../config/brands");
const { logger } = require("../../config/logger");
const nomba = require("../../services/nomba.service");
const gateways = require("../business_setup/payment-gateways.service");
const salesRepo = require("../sales/sales.repo");
const repo = require("./pos.repo");
const events = require("./pos.events");

// Overlaps the 10-minute cron cadence generously so a delayed tick, a
// restart, or a brief Nomba outage can never leave a silent gap.
const LOOKBACK_MINUTES = 20;
const MAX_PAGES = 10; // hard stop against a runaway cursor loop

function isCreditSuccess(row) {
  return (
    row &&
    row.transactionType === "CREDIT" &&
    String(row.status || "").toUpperCase() === "SUCCESS"
  );
}

function providerRef(row) {
  const meta = row.meta || {};
  return meta.transactionId || meta.rrn || meta.merchantTxRef || null;
}

/**
 * Every reference this ledger row carries — the payment may be recorded under
 * any of them (terminal taps under transactionId/merchantTxRef, online
 * checkouts under our orderReference). providerRef() stays the queue's dedup
 * key; this is only for "have we already got it?".
 */
function candidateRefs(row) {
  const meta = row.meta || {};
  return [
    meta.transactionId,
    meta.rrn,
    meta.merchantTxRef,
    meta.orderReference,
    meta.sessionId,
    row.transactionId,
    row.orderReference,
  ].filter((v) => v !== undefined && v !== null && String(v).trim() !== "");
}

/**
 * The currency of a ledger credit. The business banks both a Naira account and
 * a USD wallet with Nomba; a USD row's `amount` is DOLLARS and must never be
 * parked as that many Naira. Anything unstated is Naira (the account default).
 */
function rowCurrency(row) {
  const meta = row.meta || {};
  return String(
    row.currency || meta.currency || meta.transactionCurrency || "NGN",
  ).toUpperCase();
}

async function syncBrand({ brand, dateFrom, dateTo }) {
  const creds = await gateways.resolveCredentials({ brand, provider: "nomba" });
  if (!creds) return { brand, skipped: "not_configured" };

  let cursor = null;
  let scanned = 0;
  let parked = 0;
  let pages = 0;

  do {
    let page;
    try {
      page = await nomba.fetchLedgerTransactions({
        dateFrom,
        dateTo,
        cursor,
        limit: 100,
        creds,
      });
    } catch (err) {
      logger.error(
        { brand, err: err.message },
        "nomba ledger sync: fetch failed",
      );
      return { brand, error: err.message, scanned, parked };
    }

    for (const row of page.results) {
      scanned += 1;
      if (!isCreditSuccess(row)) continue;
      const ref = providerRef(row);
      if (!ref) continue; // nothing safe to dedup on — skip rather than risk a duplicate

      const already = await salesRepo.paymentExistsForNombaLedgerRefs({
        brand,
        refs: candidateRefs(row),
      });
      if (already) continue;

      // A USD wallet credit parks with its DOLLAR amount; Match converts it at
      // the chosen order's locked rate. amount_ngn (NOT NULL) is 0 — there is
      // no honest Naira figure until an order is chosen.
      const ccy = rowCurrency(row);
      const foreign = ccy !== "NGN";
      const parkedRow = await repo.enqueueReconciliation({
        row: {
          provider: "nomba",
          resolved_brand: brand,
          amount_ngn: foreign ? "0" : row.amount,
          paid_currency: foreign ? ccy : undefined,
          paid_amount: foreign ? row.amount : undefined,
          transaction_time: row.timeUpdated || null,
          provider_reference: ref,
          note: foreign
            ? `${ccy} ${row.amount} credited to the Nomba ${ccy} wallet with no matching payment in the Hub — match it to its order to convert at that order's locked rate.`
            : undefined,
          raw_payload: row,
        },
      });
      if (parkedRow) {
        parked += 1;
        events.emit("pending", {
          recon_id: parkedRow.recon_id,
          business: brand,
          amount_ngn: foreign ? "0" : row.amount,
          paid_currency: foreign ? ccy : null,
          paid_amount: foreign ? row.amount : null,
        });
      }
    }

    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);

  return { brand, scanned, parked };
}

async function runNombaLedgerSync({ lookbackMinutes = LOOKBACK_MINUTES } = {}) {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - lookbackMinutes * 60_000);
  const results = [];
  for (const brand of VALID_BRANDS) {
    const r = await syncBrand({
      brand,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    });
    results.push(r);
  }
  const totalParked = results.reduce((s, r) => s + (r.parked || 0), 0);
  logger.info({ results, totalParked }, "nomba ledger sync complete");
  return { results, totalParked };
}

module.exports = { runNombaLedgerSync, syncBrand, candidateRefs, rowCurrency };
