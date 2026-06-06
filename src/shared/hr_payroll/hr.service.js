/**
 * HR & Payroll service (V2.2 §6.11) — Pass 1: employees + Tier-1 config.
 *
 * - Employees (shared.staff_profiles): CRUD; PII is encrypted in the repo and
 *   masked here for non-owners (owner/CEO sees full). All writes audited as
 *   sensitive (they touch salary/bank/identity data).
 * - Config (commission_rules, bonus_rules, performance_kpi_definitions,
 *   performance_cycles, payroll_deductions): a generic audited CRUD factory.
 *   KPI definitions additionally expose a weight-sum summary (must total 100).
 */

"use strict";

const hrRepo = require("./hr.repo");
const configRepos = require("./config.repos");
const fields = require("./hr.fields");
const events = require("./hr.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, ConflictError } = require("../../utils/errors");

const canSee = (user) => Boolean(user && user.is_ceo);

// ── Employees ──────────────────────────────────────────────

async function listStaff({ brand, user, filters, page, page_size }) {
  const result = await hrRepo.findAll({ brand, filters, page, page_size });
  return { ...result, data: fields.redactStaffList(result.data, canSee(user)) };
}

async function getStaff({ brand, user, id }) {
  const staff = await hrRepo.findById({ brand, id });
  if (!staff) throw new NotFoundError("Employee");
  return fields.redactStaff(staff, canSee(user));
}

async function createStaff({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const created = await hrRepo.create({ client, brand, input });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.create_employee",
      target_type: "staff_profiles",
      target_id: created.profile_id,
      after: fields.redactStaff(created, false), // never log raw PII
      request_id,
      is_sensitive: true,
    });
    events.emit("employee_created", { brand, profile_id: created.profile_id });
    return fields.redactStaff(created, canSee(user));
  });
}

async function updateStaff({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await hrRepo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("Employee");
    const updated = await hrRepo.update({ client, brand, id, patch });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.update_employee",
      target_type: "staff_profiles",
      target_id: id,
      before: fields.redactStaff(before, false),
      after: fields.redactStaff(updated, false),
      request_id,
      is_sensitive: true,
    });
    events.emit("employee_updated", { brand, profile_id: id });
    return fields.redactStaff(updated, canSee(user));
  });
}

async function deleteStaff({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await hrRepo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("Employee");
    await hrRepo.softDelete({ client, brand, id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.archive_employee",
      target_type: "staff_profiles",
      target_id: id,
      before: fields.redactStaff(before, false),
      request_id,
      is_sensitive: true,
    });
    events.emit("employee_archived", { brand, profile_id: id });
  });
}

// ── Generic audited config CRUD ────────────────────────────

function makeConfigService({ repo, entity, sensitive = false }) {
  return {
    async list({ brand, filters, page, page_size }) {
      return repo.findAll({ brand, filters, page, page_size });
    },
    async get({ brand, id }) {
      const item = await repo.findById({ brand, id });
      if (!item) throw new NotFoundError(entity);
      return item;
    },
    async create({ brand, user, request_id, input }) {
      return transaction(async (client) => {
        const created = await repo.create({ client, brand, input });
        await audit({
          business: brand,
          user_id: user.user_id,
          action_key: `hr_payroll.create_${entity}`,
          target_type: repo.table,
          target_id: created[repo.pk],
          after: created,
          request_id,
          is_sensitive: sensitive,
        });
        events.emit(`${entity}_created`, { brand, id: created[repo.pk] });
        return created;
      });
    },
    async update({ brand, user, request_id, id, patch }) {
      return transaction(async (client) => {
        const before = await repo.findById({ client, brand, id });
        if (!before) throw new NotFoundError(entity);
        const updated = await repo.update({ client, brand, id, patch });
        await audit({
          business: brand,
          user_id: user.user_id,
          action_key: `hr_payroll.update_${entity}`,
          target_type: repo.table,
          target_id: id,
          before,
          after: updated,
          request_id,
          is_sensitive: sensitive,
        });
        events.emit(`${entity}_updated`, { brand, id });
        return updated;
      });
    },
    async remove({ brand, user, request_id, id }) {
      return transaction(async (client) => {
        const before = await repo.findById({ client, brand, id });
        if (!before) throw new NotFoundError(entity);
        await repo.remove({ client, brand, id });
        await audit({
          business: brand,
          user_id: user.user_id,
          action_key: `hr_payroll.delete_${entity}`,
          target_type: repo.table,
          target_id: id,
          before,
          request_id,
          is_sensitive: sensitive,
        });
        events.emit(`${entity}_deleted`, { brand, id });
      });
    },
  };
}

const commissionRules = makeConfigService({
  repo: configRepos.commissionRulesRepo,
  entity: "commission_rule",
});
const bonusRules = makeConfigService({
  repo: configRepos.bonusRulesRepo,
  entity: "bonus_rule",
});
const deductions = makeConfigService({
  repo: configRepos.deductionsRepo,
  entity: "payroll_deduction",
  sensitive: true,
});
const kpiDefsBase = makeConfigService({
  repo: configRepos.kpiDefsRepo,
  entity: "kpi_definition",
});
const cyclesBase = makeConfigService({
  repo: configRepos.cyclesRepo,
  entity: "performance_cycle",
});

// KPI definitions: same CRUD + a weight-sum summary (must total 100).
async function kpiWeightSummary({ brand }) {
  const { data } = await configRepos.kpiDefsRepo.findAll({
    brand,
    filters: {},
    page: 1,
    page_size: 200,
  });
  const total = fields.kpiWeightsTotal(data);
  return {
    total,
    target: fields.WEIGHT_TARGET,
    balanced: fields.kpiWeightsValid(total),
  };
}
const kpiDefs = { ...kpiDefsBase, weightSummary: kpiWeightSummary };

// Cycles: block hard-delete unless the cycle is still 'upcoming'.
const cycles = {
  ...cyclesBase,
  async remove({ brand, user, request_id, id }) {
    const cycle = await configRepos.cyclesRepo.findById({ brand, id });
    if (!cycle) throw new NotFoundError("performance_cycle");
    if (cycle.status !== "upcoming") {
      throw new ConflictError(
        "Only an upcoming cycle can be deleted; close or archive instead",
      );
    }
    return cyclesBase.remove({ brand, user, request_id, id });
  },
};

module.exports = {
  // employees
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  // config
  commissionRules,
  bonusRules,
  deductions,
  kpiDefs,
  cycles,
};
