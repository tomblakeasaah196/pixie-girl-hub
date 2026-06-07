/**
 * Point of Sale (V2.2 §6.3) — HTTP controllers.
 */

"use strict";

const service = require("./pos.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Terminals ────────────────────────────────────────────
const listTerminals = async (req, res) =>
  res.json({
    data: await service.listTerminals({
      brand: req.brand,
      is_active:
        req.query.is_active === undefined
          ? undefined
          : req.query.is_active === "true",
    }),
  });
const getTerminal = async (req, res) =>
  res.json({
    data: await service.getTerminal({ brand: req.brand, id: req.params.id }),
  });
const createTerminal = async (req, res) =>
  res.status(201).json({
    data: await service.createTerminal({ ...base(req), input: req.body }),
  });
const updateTerminal = async (req, res) =>
  res.json({
    data: await service.updateTerminal({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// ── PINs ─────────────────────────────────────────────────
const setPin = async (req, res) =>
  res.status(201).json({
    data: await service.setPin({
      ...base(req),
      target_user_id: req.body.user_id,
      pin: req.body.pin,
      must_change_pin: req.body.must_change_pin,
    }),
  });
const verifyPin = async (req, res) =>
  res.json({
    data: await service.verifyPin({
      brand: req.brand,
      user_id: req.body.user_id,
      pin: req.body.pin,
    }),
  });

// ── Sessions ─────────────────────────────────────────────
async function listSessions(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listSessions({
      brand: req.brand,
      filters: {
        status: req.query.status,
        terminal_id: req.query.terminal_id,
        staff_user_id: req.query.staff_user_id,
      },
      page,
      page_size,
    }),
  );
}
const getSession = async (req, res) =>
  res.json({
    data: await service.getSession({ brand: req.brand, id: req.params.id }),
  });
const openSession = async (req, res) =>
  res.status(201).json({
    data: await service.openSession({ ...base(req), input: req.body }),
  });
const closeSession = async (req, res) =>
  res.json({
    data: await service.closeSession({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const reconcileSession = async (req, res) =>
  res.json({
    data: await service.reconcileSession({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// ── Cash drops ───────────────────────────────────────────
const recordCashDrop = async (req, res) =>
  res.status(201).json({
    data: await service.recordCashDrop({ ...base(req), input: req.body }),
  });

// ── Checkout / transactions ──────────────────────────────
async function listTransactions(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listTransactions({
      brand: req.brand,
      filters: {
        session_id: req.query.session_id,
        status: req.query.status,
        cashier_user_id: req.query.cashier_user_id,
      },
      page,
      page_size,
    }),
  );
}
const getTransaction = async (req, res) =>
  res.json({
    data: await service.getTransaction({ brand: req.brand, id: req.params.id }),
  });
const checkout = async (req, res) =>
  res
    .status(201)
    .json({ data: await service.checkout({ ...base(req), input: req.body }) });
const voidTransaction = async (req, res) =>
  res.json({
    data: await service.voidTransaction({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

module.exports = {
  listTerminals,
  getTerminal,
  createTerminal,
  updateTerminal,
  setPin,
  verifyPin,
  listSessions,
  getSession,
  openSession,
  closeSession,
  reconcileSession,
  recordCashDrop,
  listTransactions,
  getTransaction,
  checkout,
  voidTransaction,
};
