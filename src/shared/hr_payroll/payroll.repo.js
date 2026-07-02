/**
 * Payroll operations repository (V2.2 §6.11) — Pass 2.
 * Per-brand tables: payroll_runs, payslips, payslip_lines, commission_earned,
 * bonuses_awarded. Parameterised SQL only.
 */

"use strict";

const { ex: exec } = require("../../config/database");
const { t } = require("../../config/brands");
// ── Active staff (with their user account) for a payroll run ───────────
async function listActiveStaffForPayroll({ client, brand, period_end }) {
  const { rows } = await exec(client)(
    `SELECT sp.profile_id, sp.job_title, sp.department, sp.base_salary,
            sp.bank_account_number, sp.bank_sort_code, sp.bank_name,
            u.user_id
       FROM shared.staff_profiles sp
       JOIN shared.users u ON u.staff_profile_id = sp.profile_id
      WHERE sp.business = $1
        AND sp.is_deleted = false
        AND u.is_active = true
        AND (sp.end_date IS NULL OR sp.end_date >= $2)
      ORDER BY sp.job_title ASC`,
    [brand, period_end],
  );
  return rows;
}

// ── payroll_runs ───────────────────────────────────────────
async function listRuns({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
}) {
  const where = ["1=1"];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.pay_year) {
    where.push(`pay_year = $${i++}`);
    params.push(filters.pay_year);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const offset = (page - 1) * page_size;
  const run = exec(client);
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "payroll_runs")} ${whereSql}
      ORDER BY pay_year DESC, pay_month DESC
      LIMIT $${i} OFFSET $${i + 1}`,
    [...params, page_size, offset],
  );
  const { rows: cr } = await run(
    `SELECT count(*)::int AS total FROM ${t(brand, "payroll_runs")} ${whereSql}`,
    params,
  );
  return { data: rows, page, page_size, total: cr[0].total };
}

async function findRun({ client, brand, run_id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "payroll_runs")} WHERE run_id = $1 LIMIT 1`,
    [run_id],
  );
  return rows[0] || null;
}

async function findRunByPeriod({ client, brand, pay_year, pay_month }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "payroll_runs")} WHERE pay_year = $1 AND pay_month = $2 LIMIT 1`,
    [pay_year, pay_month],
  );
  return rows[0] || null;
}

async function createRun({ client, brand, run_number, input, created_by }) {
  const { rows } = await exec(client)(
    `INSERT INTO ${t(brand, "payroll_runs")}
       (run_number, fiscal_period_id, pay_month, pay_year, pay_date,
        period_start, period_end, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      run_number,
      input.fiscal_period_id ?? null,
      input.pay_month,
      input.pay_year,
      input.pay_date,
      input.period_start,
      input.period_end,
      input.notes ?? null,
      created_by ?? null,
    ],
  );
  return rows[0];
}

async function updateRun({ client, brand, run_id, patch }) {
  const allowed = [
    "status",
    "total_staff",
    "total_gross_ngn",
    "total_commission_ngn",
    "total_bonus_ngn",
    "total_paye_ngn",
    "total_pension_employee_ngn",
    "total_pension_employer_ngn",
    "total_nhf_ngn",
    "total_other_deductions_ngn",
    "total_net_ngn",
    "calculated_at",
    "approved_by",
    "approved_at",
    "paid_at",
    "workflow_instance_id",
    "notes",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of allowed) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (sets.length === 0) return findRun({ client, brand, run_id });
  params.push(run_id);
  const { rows } = await exec(client)(
    `UPDATE ${t(brand, "payroll_runs")} SET ${sets.join(", ")} WHERE run_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── payslips + lines ───────────────────────────────────────
async function deletePayslipsForRun({ client, brand, run_id }) {
  // payslip_lines cascade on payslip delete.
  await exec(client)(
    `DELETE FROM ${t(brand, "payslips")} WHERE payroll_run_id = $1`,
    [run_id],
  );
}

async function insertPayslip({ client, brand, _payslip_number, data }) {
  const cols = [
    "payslip_number",
    "payroll_run_id",
    "user_id",
    "staff_profile_id",
    "job_title_snapshot",
    "department_snapshot",
    "bank_account_snapshot",
    "bank_sort_code_snapshot",
    "base_salary_ngn",
    "allowances_ngn",
    "commission_ngn",
    "bonus_ngn",
    "overtime_ngn",
    "reimbursements_ngn",
    "gross_pay_ngn",
    "paye_ngn",
    "pension_employee_ngn",
    "pension_employer_ngn",
    "nhf_ngn",
    "loan_repayment_ngn",
    "advance_recovery_ngn",
    "other_deductions_ngn",
    "total_deductions_ngn",
    "net_pay_ngn",
  ];
  const vals = cols.map((_, idx) => `$${idx + 1}`);
  const params = cols.map((c) => (data[c] === undefined ? null : data[c]));
  const { rows } = await exec(client)(
    `INSERT INTO ${t(brand, "payslips")} (${cols.join(", ")})
     VALUES (${vals.join(", ")}) RETURNING *`,
    params,
  );
  return rows[0];
}

async function insertPayslipLines({ client, brand, payslip_id, lines }) {
  const run = exec(client);
  for (const l of lines) {
    await run(
      `INSERT INTO ${t(brand, "payslip_lines")}
         (payslip_id, line_type, description, amount_ngn, source_type, source_id, display_order, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        payslip_id,
        l.line_type,
        l.description,
        l.amount_ngn,
        l.source_type ?? null,
        l.source_id ?? null,
        l.display_order ?? 0,
        l.notes ?? null,
      ],
    );
  }
}

async function listPayslips({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 50,
}) {
  const where = ["1=1"];
  const params = [];
  let i = 1;
  if (filters.payroll_run_id) {
    where.push(`payroll_run_id = $${i++}`);
    params.push(filters.payroll_run_id);
  }
  if (filters.user_id) {
    where.push(`user_id = $${i++}`);
    params.push(filters.user_id);
  }
  if (filters.payment_status) {
    where.push(`payment_status = $${i++}`);
    params.push(filters.payment_status);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const offset = (page - 1) * page_size;
  const run = exec(client);
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "payslips")} ${whereSql}
      ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...params, page_size, offset],
  );
  const { rows: cr } = await run(
    `SELECT count(*)::int AS total FROM ${t(brand, "payslips")} ${whereSql}`,
    params,
  );
  return { data: rows, page, page_size, total: cr[0].total };
}

async function findPayslip({ client, brand, payslip_id }) {
  const run = exec(client);
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "payslips")} WHERE payslip_id = $1 LIMIT 1`,
    [payslip_id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await run(
    `SELECT * FROM ${t(brand, "payslip_lines")} WHERE payslip_id = $1 ORDER BY display_order ASC`,
    [payslip_id],
  );
  return { ...rows[0], lines };
}

async function setPayslipPayment({
  client,
  brand,
  payslip_id,
  payment_status,
  fields = {},
}) {
  const { rows } = await exec(client)(
    `UPDATE ${t(brand, "payslips")}
        SET payment_status = $2, payment_method = COALESCE($3, payment_method),
            payment_reference = COALESCE($4, payment_reference),
            paid_at = $5, failure_reason = $6
      WHERE payslip_id = $1 RETURNING *`,
    [
      payslip_id,
      payment_status,
      fields.payment_method ?? null,
      fields.payment_reference ?? null,
      fields.paid_at ?? null,
      fields.failure_reason ?? null,
    ],
  );
  return rows[0] || null;
}

// ── commission_earned ──────────────────────────────────────
async function listCommissions({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 50,
}) {
  const where = ["1=1"];
  const params = [];
  let i = 1;
  for (const col of ["user_id", "status", "sale_channel", "payroll_run_id"]) {
    if (filters[col] === undefined) continue;
    where.push(`${col} = $${i++}`);
    params.push(filters[col]);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const offset = (page - 1) * page_size;
  const run = exec(client);
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "commission_earned")} ${whereSql}
      ORDER BY earned_at DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...params, page_size, offset],
  );
  const { rows: cr } = await run(
    `SELECT count(*)::int AS total FROM ${t(brand, "commission_earned")} ${whereSql}`,
    params,
  );
  return { data: rows, page, page_size, total: cr[0].total };
}

async function findCommission({ client, brand, earning_id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "commission_earned")} WHERE earning_id = $1 LIMIT 1`,
    [earning_id],
  );
  return rows[0] || null;
}

async function createCommission({ client, brand, earning_number, input }) {
  const { rows } = await exec(client)(
    `INSERT INTO ${t(brand, "commission_earned")}
       (earning_number, user_id, order_id, order_line_id, invoice_id, sale_channel,
        commission_rule_id, basis_amount_ngn, rate_pct, rate_fixed_ngn, commission_amount_ngn,
        reverses_earning_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      earning_number,
      input.user_id,
      input.order_id ?? null,
      input.order_line_id ?? null,
      input.invoice_id ?? null,
      input.sale_channel,
      input.commission_rule_id ?? null,
      input.basis_amount_ngn,
      input.rate_pct ?? null,
      input.rate_fixed_ngn ?? null,
      input.commission_amount_ngn,
      input.reverses_earning_id ?? null,
    ],
  );
  return rows[0];
}

async function setCommissionStatus({
  client,
  brand,
  earning_id,
  status,
  fields = {},
}) {
  const { rows } = await exec(client)(
    `UPDATE ${t(brand, "commission_earned")}
        SET status = $2, payroll_run_id = COALESCE($3, payroll_run_id), paid_at = COALESCE($4, paid_at)
      WHERE earning_id = $1 RETURNING *`,
    [earning_id, status, fields.payroll_run_id ?? null, fields.paid_at ?? null],
  );
  return rows[0] || null;
}

/** Sum payable (accrued|approved) commission per user, for the run. */
async function payableCommissionByUser({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT user_id, COALESCE(sum(commission_amount_ngn),0)::numeric AS total
       FROM ${t(brand, "commission_earned")}
      WHERE status IN ('accrued','approved')
      GROUP BY user_id`,
  );
  return rows;
}

async function markCommissionsPaidForUser({
  client,
  brand,
  user_id,
  run_id,
  paid_at,
}) {
  await exec(client)(
    `UPDATE ${t(brand, "commission_earned")}
        SET status = 'paid', payroll_run_id = $2, paid_at = $3
      WHERE user_id = $1 AND status IN ('accrued','approved')`,
    [user_id, run_id, paid_at],
  );
}

// ── bonuses_awarded ────────────────────────────────────────
async function listBonuses({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 50,
}) {
  const where = ["1=1"];
  const params = [];
  let i = 1;
  for (const col of ["user_id", "status", "bonus_type", "payroll_run_id"]) {
    if (filters[col] === undefined) continue;
    where.push(`${col} = $${i++}`);
    params.push(filters[col]);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const offset = (page - 1) * page_size;
  const run = exec(client);
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "bonuses_awarded")} ${whereSql}
      ORDER BY awarded_at DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...params, page_size, offset],
  );
  const { rows: cr } = await run(
    `SELECT count(*)::int AS total FROM ${t(brand, "bonuses_awarded")} ${whereSql}`,
    params,
  );
  return { data: rows, page, page_size, total: cr[0].total };
}

async function findBonus({ client, brand, bonus_id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "bonuses_awarded")} WHERE bonus_id = $1 LIMIT 1`,
    [bonus_id],
  );
  return rows[0] || null;
}

async function createBonus({ client, brand, bonus_number, input, awarded_by }) {
  const { rows } = await exec(client)(
    `INSERT INTO ${t(brand, "bonuses_awarded")}
       (bonus_number, user_id, bonus_rule_id, bonus_type, performance_cycle_id,
        performance_review_id, amount_ngn, reason, awarded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      bonus_number,
      input.user_id,
      input.bonus_rule_id ?? null,
      input.bonus_type,
      input.performance_cycle_id ?? null,
      input.performance_review_id ?? null,
      input.amount_ngn,
      input.reason,
      awarded_by ?? null,
    ],
  );
  return rows[0];
}

async function setBonusStatus({
  client,
  brand,
  bonus_id,
  status,
  fields = {},
}) {
  const { rows } = await exec(client)(
    `UPDATE ${t(brand, "bonuses_awarded")}
        SET status = $2,
            workflow_instance_id = COALESCE($3, workflow_instance_id),
            approved_by = COALESCE($4, approved_by), approved_at = COALESCE($5, approved_at),
            rejected_at = COALESCE($6, rejected_at), rejection_reason = COALESCE($7, rejection_reason),
            payroll_run_id = COALESCE($8, payroll_run_id), paid_at = COALESCE($9, paid_at)
      WHERE bonus_id = $1 RETURNING *`,
    [
      bonus_id,
      status,
      fields.workflow_instance_id ?? null,
      fields.approved_by ?? null,
      fields.approved_at ?? null,
      fields.rejected_at ?? null,
      fields.rejection_reason ?? null,
      fields.payroll_run_id ?? null,
      fields.paid_at ?? null,
    ],
  );
  return rows[0] || null;
}

async function payableBonusByUser({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT user_id, COALESCE(sum(amount_ngn),0)::numeric AS total
       FROM ${t(brand, "bonuses_awarded")}
      WHERE status = 'approved'
      GROUP BY user_id`,
  );
  return rows;
}

async function markBonusesPaidForUser({
  client,
  brand,
  user_id,
  run_id,
  paid_at,
}) {
  await exec(client)(
    `UPDATE ${t(brand, "bonuses_awarded")}
        SET status = 'paid', payroll_run_id = $2, paid_at = $3
      WHERE user_id = $1 AND status = 'approved'`,
    [user_id, run_id, paid_at],
  );
}

// ── Active deduction configs (effective as of a date), keyed by type ───
async function activeDeductionConfigs({ client, brand, as_of }) {
  const { rows } = await exec(client)(
    `SELECT DISTINCT ON (deduction_type) *
       FROM ${t(brand, "payroll_deductions")}
      WHERE is_active = true AND effective_from <= $1
        AND (effective_to IS NULL OR effective_to >= $1)
      ORDER BY deduction_type, effective_from DESC`,
    [as_of],
  );
  const byType = {};
  for (const r of rows) byType[r.deduction_type] = r;
  return byType;
}

// ── Commission rule resolution (G-3: accrue on sale) ───────────
/**
 * Most-specific active commission rule for a rep + channel: prefer a
 * user-specific rule over a role/any rule, and a channel-specific rule over
 * an all-channels rule, then highest priority.
 */
async function findCommissionRule({ client, brand, user_id, sale_channel }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "commission_rules")}
      WHERE is_active = true
        AND (applies_to_user_id = $1 OR applies_to_user_id IS NULL)
        AND (sales_channel = $2 OR sales_channel IS NULL)
      ORDER BY (applies_to_user_id IS NOT NULL) DESC,
               (sales_channel IS NOT NULL) DESC,
               priority DESC
      LIMIT 1`,
    [user_id, sale_channel],
  );
  return rows[0] || null;
}

/** Idempotency guard: has commission already been accrued for this order? */
async function commissionExistsForOrder({ client, brand, order_id }) {
  const { rows } = await exec(client)(
    `SELECT 1 FROM ${t(brand, "commission_earned")}
      WHERE order_id = $1 AND status <> 'reversed' LIMIT 1`,
    [order_id],
  );
  return rows.length > 0;
}

// ── GL sums (policy Q3) ────────────────────────────────────
// Payslip-level sums so the accrual journal always ties to the slips, not
// to run totals that might have been patched independently.
async function sumRunPayslips({ client, brand, run_id }) {
  const { rows } = await exec(client)(
    `SELECT
        COALESCE(SUM(base_salary_ngn + allowances_ngn + overtime_ngn + reimbursements_ngn), 0) AS earnings_ngn,
        COALESCE(SUM(commission_ngn), 0)          AS commission_ngn,
        COALESCE(SUM(bonus_ngn), 0)               AS bonus_ngn,
        COALESCE(SUM(paye_ngn), 0)                AS paye_ngn,
        COALESCE(SUM(pension_employee_ngn), 0)    AS pension_employee_ngn,
        COALESCE(SUM(pension_employer_ngn), 0)    AS pension_employer_ngn,
        COALESCE(SUM(nhf_ngn), 0)                 AS nhf_ngn,
        COALESCE(SUM(loan_repayment_ngn + advance_recovery_ngn), 0) AS staff_recoveries_ngn,
        COALESCE(SUM(other_deductions_ngn), 0)    AS other_deductions_ngn,
        COALESCE(SUM(net_pay_ngn), 0)             AS net_pay_ngn
       FROM ${t(brand, "payslips")}
      WHERE payroll_run_id = $1`,
    [run_id],
  );
  return rows[0];
}

module.exports = {
  sumRunPayslips,
  listActiveStaffForPayroll,
  activeDeductionConfigs,
  listRuns,
  findRun,
  findRunByPeriod,
  createRun,
  updateRun,
  deletePayslipsForRun,
  insertPayslip,
  insertPayslipLines,
  listPayslips,
  findPayslip,
  setPayslipPayment,
  listCommissions,
  findCommission,
  createCommission,
  findCommissionRule,
  commissionExistsForOrder,
  setCommissionStatus,
  payableCommissionByUser,
  markCommissionsPaidForUser,
  listBonuses,
  findBonus,
  createBonus,
  setBonusStatus,
  payableBonusByUser,
  markBonusesPaidForUser,
};
