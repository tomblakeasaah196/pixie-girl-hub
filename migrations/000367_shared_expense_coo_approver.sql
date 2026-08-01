-- ============================================================
-- 000367 — Expense approval: add the Chief Operating Officer as
--          a co-approver alongside the CEO.
-- Pixie Girl Hub · JBS Praxis
--
-- Follow-up to 000365 (which made expenses a single CEO-approval
-- stage). The owner runs sign-off through the COO, whose account is
-- not flagged is_ceo — so the CEO-only stage silently 403'd the COO
-- (Approve/Reject appeared to do nothing). This widens the single
-- executive stage to accept EITHER the `ceo` role (is_ceo holders)
-- OR the `chief_operating_officer` role; either one acting completes
-- the stage.
--
-- `chief_operating_officer` is resolved by role NAME at act time
-- (workflows/engine.js → userCanActOnStage → roleIdsForNames), so no
-- role seeding is needed here — the business's existing custom role
-- of that name is picked up automatically. Businesses without such a
-- role simply fall back to the CEO, unchanged.
--
-- Idempotent: a straight overwrite of the canonical single-stage
-- definition for every brand's expenses:submit route.
-- ============================================================

BEGIN;

UPDATE shared.workflow_definitions
   SET definition = jsonb_build_object(
         'trigger', jsonb_build_object('module', 'expenses', 'action', 'submit'),
         'stages', jsonb_build_array(
           jsonb_build_object(
             'order', 1,
             'name', 'Executive approval (CEO or COO)',
             'approvers', jsonb_build_array(
               jsonb_build_object('type', 'role', 'value', 'ceo'),
               jsonb_build_object('type', 'role', 'value', 'chief_operating_officer')
             ),
             'timeout_hours', 48,
             'on_timeout', 'escalate',
             'fallback_to_deputy', false
           )
         )
       ),
       description = 'The CEO or the Chief Operating Officer approves (or rejects) every expense, of any amount. '
                     || 'Edit this workflow in Org & Workflow to add a manager tier or amount thresholds.',
       updated_at = now()
 WHERE trigger_module = 'expenses'
   AND trigger_action = 'submit';

COMMIT;
