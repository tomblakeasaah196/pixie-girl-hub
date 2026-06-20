/**
 * Factory Account (China running-balance ledger) — service layer.
 *
 * Manages running RMB/CNY accounts between the CEO (Faith) and China
 * factory managers. Each factory supplier has one account. Ledger entries
 * DR (orders, fees) or CR (payments) update the running balance via a DB
 * trigger (fn_update_factory_account_balance).
 *
 * When a factory manager logs a shipment, this service:
 *   1. Creates a ledger entry for the shipping fee (if provided)
 *   2. Emits SHIPMENT_DISPATCHED so the event system can notify Faith
 */

"use strict";

const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const repo = require("./factory-account.repo");
const events = require("./factory-account.events");
const {
  NotFoundError,
  ConflictError,
  AppError,
} = require("../../utils/errors");

const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  metadata,
  request_id,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    metadata,
    request_id,
  });

// ── Accounts ──────────────────────────────────────────────

async function createAccount({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const existing = await repo.listAccounts({ client, brand });
    const duplicate = existing.find(
      (a) => a.supplier_id === input.supplier_id && a.is_active,
    );
    if (duplicate) {
      throw new ConflictError(
        "An active factory account already exists for this supplier.",
      );
    }
    const account = await repo.createAccount({
      client,
      brand,
      data: { ...input, created_by: user?.user_id },
    });
    await A(
      brand,
      user?.user_id,
      "factory.account.create",
      "factory_account",
      account.account_id,
      { account_name: account.account_name },
      request_id,
    );
    return account;
  });
}

async function getAccount({ brand, id }) {
  const account = await repo.getAccount({ client: null, brand, id });
  if (!account) throw new NotFoundError("Factory account not found.");
  return account;
}

async function listAccounts({ brand }) {
  return repo.listAccounts({ client: null, brand });
}

async function updateAccount({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getAccount({ client, brand, id });
    if (!existing) throw new NotFoundError("Factory account not found.");
    const account = await repo.updateAccount({
      client,
      brand,
      id,
      data: input,
    });
    await A(
      brand,
      user?.user_id,
      "factory.account.update",
      "factory_account",
      id,
      input,
      request_id,
    );
    return account;
  });
}

// ── Ledger entries ────────────────────────────────────────

async function addLedgerEntry({ brand, user, request_id, account_id, input }) {
  return transaction(async (client) => {
    const account = await repo.getAccount({ client, brand, id: account_id });
    if (!account) throw new NotFoundError("Factory account not found.");
    if (!account.is_active)
      throw new AppError({
        code: "ACCOUNT_INACTIVE",
        httpStatus: 409,
        userMessage: "This factory account is no longer active.",
      });

    const entry = await repo.addLedgerEntry({
      client,
      brand,
      data: { ...input, account_id, recorded_by: user?.user_id },
    });

    // Alert check: balance exceeds credit alert threshold
    if (
      account.credit_alert_threshold &&
      entry.running_balance >= account.credit_alert_threshold
    ) {
      events.emit("ACCOUNT_BALANCE_ALERT", {
        brand,
        account_id,
        account_name: account.account_name,
        balance: entry.running_balance,
        threshold: account.credit_alert_threshold,
        currency: account.base_currency,
      });
    }

    await A(
      brand,
      user?.user_id,
      "factory.ledger.create",
      "factory_account_ledger",
      entry.entry_id,
      {
        account_id,
        entry_type: input.entry_type,
        amount_base: entry.amount_base,
      },
      request_id,
    );
    return entry;
  });
}

async function listLedgerEntries({ brand, account_id, limit, offset }) {
  const account = await repo.getAccount({
    client: null,
    brand,
    id: account_id,
  });
  if (!account) throw new NotFoundError("Factory account not found.");
  return repo.listLedgerEntries({
    client: null,
    brand,
    account_id,
    limit,
    offset,
  });
}

async function reconcileEntries({
  brand,
  user,
  request_id,
  account_id,
  entry_ids,
}) {
  return transaction(async (client) => {
    const account = await repo.getAccount({ client, brand, id: account_id });
    if (!account) throw new NotFoundError("Factory account not found.");
    const updated = await repo.reconcileEntries({ client, brand, entry_ids });
    await A(
      brand,
      user?.user_id,
      "factory.ledger.reconcile",
      "factory_account_ledger",
      account_id,
      { entry_ids },
      request_id,
    );
    return { reconciled: updated.length };
  });
}

// ── Shipments ─────────────────────────────────────────────

async function createShipment({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const account = await repo.getAccount({
      client,
      brand,
      id: input.account_id,
    });
    if (!account) throw new NotFoundError("Factory account not found.");

    const shipment_ref = await repo.nextShipmentRef({ client, brand });
    const shipment = await repo.createShipment({
      client,
      brand,
      data: { ...input, shipment_ref, created_by: user?.user_id },
    });

    await repo.addShipmentItems({
      client,
      brand,
      shipment_id: shipment.shipment_id,
      items: input.items,
    });

    // Log courier fee as a ledger DR entry if provided
    if (
      input.courier_fee_original &&
      parseFloat(input.courier_fee_original) > 0
    ) {
      await repo.addLedgerEntry({
        client,
        brand,
        data: {
          account_id: input.account_id,
          entry_type: "shipping_fee",
          direction: "DR",
          amount_original: input.courier_fee_original,
          original_currency: input.courier_fee_currency ?? "CNY",
          fx_rate_to_base: 1,
          reference_type: "factory_shipment",
          reference_id: shipment.shipment_id,
          description: `Shipping fee — ${shipment_ref}`,
          entry_date: input.shipped_at ?? null,
          recorded_by: user?.user_id,
        },
      });
    }

    await A(
      brand,
      user?.user_id,
      "factory.shipment.create",
      "factory_shipment",
      shipment.shipment_id,
      { shipment_ref },
      request_id,
    );

    events.emit("SHIPMENT_DISPATCHED", {
      brand,
      shipment_id: shipment.shipment_id,
      shipment_ref,
      account_id: input.account_id,
      supplier_name: account.supplier_name,
      items_count: input.items.length,
    });

    return repo.getShipment({ client, brand, id: shipment.shipment_id });
  });
}

async function getShipment({ brand, id }) {
  const s = await repo.getShipment({ client: null, brand, id });
  if (!s) throw new NotFoundError("Shipment not found.");
  return s;
}

async function listShipments({ brand, account_id, status, limit, offset }) {
  return repo.listShipments({
    client: null,
    brand,
    account_id,
    status,
    limit,
    offset,
  });
}

async function advanceShipment({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getShipment({ client, brand, id });
    if (!existing) throw new NotFoundError("Shipment not found.");

    const shipment = await repo.advanceShipment({
      client,
      brand,
      id,
      data: input,
    });

    await A(
      brand,
      user?.user_id,
      "factory.shipment.advance",
      "factory_shipment",
      id,
      { status: input.status },
      request_id,
    );

    events.emit("SHIPMENT_STATUS_CHANGED", {
      brand,
      shipment_id: id,
      shipment_ref: existing.shipment_ref,
      from_status: existing.status,
      to_status: input.status,
    });

    return shipment;
  });
}

module.exports = {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
  addLedgerEntry,
  listLedgerEntries,
  reconcileEntries,
  createShipment,
  getShipment,
  listShipments,
  advanceShipment,
};
