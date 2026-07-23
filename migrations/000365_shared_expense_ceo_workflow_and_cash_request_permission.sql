-- ============================================================
-- 000365 — Expense approval → "CEO approves all", and split the
--          Cash Request permission out of Expenses.
-- Pixie Girl Hub · JBS Praxis
--
-- Two independent, owner-requested changes bundled here because both
-- reshape how expenses/cash-requests are governed:
--
-- 1. EXPENSE WORKFLOW (§6.7 / §6.27)
--    The seeded "Expense Approval" route used a two-tier split
--    (manager ≤ ₦200k, CEO above). Any approver who was neither the
--    CEO nor a literal `manager`-role holder was silently blocked by
--    the workflow engine — the Approve/Reject buttons showed (they are
--    gated on the expenses.approve PERMISSION) but the action 403'd,
--    so "Reject" appeared to do nothing.
--    New route: a single unconditional CEO-approval stage — the CEO
--    approves (or rejects) every expense, of any amount. Editable in
--    Org & Workflow afterwards.
--    In-flight expense instances are realigned to stage 1 so the
--    definition swap never orphans one at a now-missing stage 2.
--
-- 2. CASH REQUEST PERMISSION (§6.32)
--    Cash Requests rode on the `expenses` permission key, so one grant
--    governed both. This copies every role's current `expenses` grant
--    to a new `cash_request` module (same actions/scope/fields) so
--    nobody loses access, then the two can be tuned apart in the
--    permissions matrix. The cash-request routes now enforce
--    `cash_request` (see cash-request.routes.js).
--
-- Idempotent: the workflow UPDATE is a straight overwrite of the
-- canonical definition; the permission copy is INSERT … ON CONFLICT
-- DO NOTHING keyed on (role_id, module, action).
-- ============================================================

BEGIN;

-- ── 1. Expense workflow → single-stage CEO approval ─────────
UPDATE shared.workflow_definitions
   SET definition = jsonb_build_object(
         'trigger', jsonb_build_object('module', 'expenses', 'action', 'submit'),
         'stages', jsonb_build_array(
           jsonb_build_object(
             'order', 1,
             'name', 'CEO approval',
             'approvers', jsonb_build_array(
               jsonb_build_object('type', 'role', 'value', 'ceo')
             ),
             'timeout_hours', 48,
             'on_timeout', 'escalate',
             'fallback_to_deputy', false
           )
         )
       ),
       description = 'The CEO approves (or rejects) every expense, of any amount. '
                     || 'Edit this workflow in Org & Workflow to add a manager tier or amount thresholds.',
       updated_at = now()
 WHERE trigger_module = 'expenses'
   AND trigger_action = 'submit';

-- Realign any open expense approvals to the single remaining stage so a
-- pending instance opened at the old CEO tier (stage 2) still resolves.
UPDATE shared.workflow_instances
   SET current_stage = 1,
       stage_entered_at = now()
 WHERE reference_table = 'expenses'
   AND status = 'pending'
   AND current_stage <> 1;

-- ── 2. Copy each role's Expenses access to Cash Requests ────
INSERT INTO shared.permissions
  (role_id, module, action, record_scope, hidden_fields)
SELECT role_id, 'cash_request', action, record_scope, hidden_fields
  FROM shared.permissions
 WHERE module = 'expenses'
ON CONFLICT (role_id, module, action) DO NOTHING;

COMMIT;
