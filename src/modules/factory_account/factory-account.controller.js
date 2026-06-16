/**
 * Factory Account — HTTP handlers. Thin layer; no business logic here.
 */

"use strict";

const svc = require("./factory-account.service");

// ── Accounts ──────────────────────────────────────────────

async function listAccounts(req, res, next) {
  try {
    const data = await svc.listAccounts({ brand: req.brand });
    res.json({ data });
  } catch (err) { next(err); }
}

async function createAccount(req, res, next) {
  try {
    const account = await svc.createAccount({
      brand: req.brand,
      user: req.user,
      request_id: req.id,
      input: req.body,
    });
    res.status(201).json({ data: account });
  } catch (err) { next(err); }
}

async function getAccount(req, res, next) {
  try {
    const account = await svc.getAccount({ brand: req.brand, id: req.params.accountId });
    res.json({ data: account });
  } catch (err) { next(err); }
}

async function updateAccount(req, res, next) {
  try {
    const account = await svc.updateAccount({
      brand: req.brand,
      user: req.user,
      request_id: req.id,
      id: req.params.accountId,
      input: req.body,
    });
    res.json({ data: account });
  } catch (err) { next(err); }
}

// ── Ledger entries ────────────────────────────────────────

async function listLedger(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const offset = parseInt(req.query.offset ?? "0", 10);
    const result = await svc.listLedgerEntries({
      brand: req.brand,
      account_id: req.params.accountId,
      limit,
      offset,
    });
    res.json({ data: result.entries, meta: { total: result.total, limit, offset } });
  } catch (err) { next(err); }
}

async function addLedgerEntry(req, res, next) {
  try {
    const entry = await svc.addLedgerEntry({
      brand: req.brand,
      user: req.user,
      request_id: req.id,
      account_id: req.params.accountId,
      input: req.body,
    });
    res.status(201).json({ data: entry });
  } catch (err) { next(err); }
}

async function reconcileEntries(req, res, next) {
  try {
    const result = await svc.reconcileEntries({
      brand: req.brand,
      user: req.user,
      request_id: req.id,
      account_id: req.params.accountId,
      entry_ids: req.body.entry_ids,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
}

// ── Shipments ─────────────────────────────────────────────

async function listShipments(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const offset = parseInt(req.query.offset ?? "0", 10);
    const result = await svc.listShipments({
      brand: req.brand,
      account_id: req.query.account_id,
      status: req.query.status,
      limit,
      offset,
    });
    res.json({ data: result.shipments, meta: { total: result.total, limit, offset } });
  } catch (err) { next(err); }
}

async function createShipment(req, res, next) {
  try {
    const shipment = await svc.createShipment({
      brand: req.brand,
      user: req.user,
      request_id: req.id,
      input: req.body,
    });
    res.status(201).json({ data: shipment });
  } catch (err) { next(err); }
}

async function getShipment(req, res, next) {
  try {
    const shipment = await svc.getShipment({ brand: req.brand, id: req.params.shipmentId });
    res.json({ data: shipment });
  } catch (err) { next(err); }
}

async function advanceShipment(req, res, next) {
  try {
    const shipment = await svc.advanceShipment({
      brand: req.brand,
      user: req.user,
      request_id: req.id,
      id: req.params.shipmentId,
      input: req.body,
    });
    res.json({ data: shipment });
  } catch (err) { next(err); }
}

module.exports = {
  listAccounts, createAccount, getAccount, updateAccount,
  listLedger, addLedgerEntry, reconcileEntries,
  listShipments, createShipment, getShipment, advanceShipment,
};
