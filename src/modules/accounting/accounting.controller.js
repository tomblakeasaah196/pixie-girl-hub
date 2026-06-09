/**
 * Accounting & Finance (V2.2 §6.6) — HTTP controllers.
 */

"use strict";

const service = require("./accounting.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// Chart of accounts
const listGroups = async (req, res) =>
  res.json({ data: await service.listGroups({ brand: req.brand }) });
const updateGroup = async (req, res) =>
  res.json({
    data: await service.updateGroup({
      brand: req.brand,
      id: req.params.groupId,
      input: req.body,
    }),
  });
const listAccounts = async (req, res) =>
  res.json({
    data: await service.listAccounts({
      brand: req.brand,
      filters: {
        q: req.query.q,
        is_active:
          req.query.is_active === undefined
            ? undefined
            : req.query.is_active === "true",
      },
    }),
  });
const getAccount = async (req, res) =>
  res.json({
    data: await service.getAccount({
      brand: req.brand,
      id: req.params.accountId,
    }),
  });
const createAccount = async (req, res) =>
  res.status(201).json({
    data: await service.createAccount({ ...base(req), input: req.body }),
  });
const updateAccount = async (req, res) =>
  res.json({
    data: await service.updateAccount({
      ...base(req),
      id: req.params.accountId,
      patch: req.body,
    }),
  });

// Fiscal periods
const listPeriods = async (req, res) =>
  res.json({ data: await service.listPeriods({ brand: req.brand }) });
const createPeriod = async (req, res) =>
  res.status(201).json({
    data: await service.createPeriod({ ...base(req), input: req.body }),
  });
const closePeriod = async (req, res) =>
  res.json({
    data: await service.closePeriod({ ...base(req), id: req.params.periodId }),
  });

// Journals
async function listJournals(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listJournals({
      brand: req.brand,
      filters: {
        status: req.query.status,
        source_type: req.query.source_type,
        from: req.query.from,
        to: req.query.to,
      },
      page,
      page_size,
    }),
  );
}
const getJournal = async (req, res) =>
  res.json({
    data: await service.getJournal({
      brand: req.brand,
      id: req.params.entryId,
    }),
  });
const createManualJournal = async (req, res) =>
  res.status(201).json({
    data: await service.createManualJournal({
      ...base(req),
      input: req.body,
    }),
  });
const reverseJournal = async (req, res) =>
  res.status(201).json({
    data: await service.reverseEntry({
      ...base(req),
      id: req.params.entryId,
      reason: req.body.reason,
    }),
  });

// Financial reports
const trialBalance = async (req, res) =>
  res.json({
    data: await service.trialBalance({
      brand: req.brand,
      as_of: req.query.as_of,
    }),
  });
const profitAndLoss = async (req, res) =>
  res.json({
    data: await service.profitAndLoss({
      brand: req.brand,
      from: req.query.from,
      to: req.query.to,
    }),
  });
const balanceSheet = async (req, res) =>
  res.json({
    data: await service.balanceSheet({
      brand: req.brand,
      as_of: req.query.as_of,
    }),
  });
const cashFlow = async (req, res) =>
  res.json({
    data: await service.cashFlow({
      brand: req.brand,
      from: req.query.from,
      to: req.query.to,
    }),
  });
const arAgeing = async (req, res) =>
  res.json({
    data: await service.receivablesAgeing({
      brand: req.brand,
      as_of: req.query.as_of,
    }),
  });
const apAgeing = async (req, res) =>
  res.json({
    data: await service.payablesAgeing({
      brand: req.brand,
      as_of: req.query.as_of,
    }),
  });

module.exports = {
  listGroups,
  updateGroup,
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  listPeriods,
  createPeriod,
  closePeriod,
  listJournals,
  getJournal,
  createManualJournal,
  reverseJournal,
  trialBalance,
  profitAndLoss,
  balanceSheet,
  cashFlow,
  arAgeing,
  apAgeing,
};
