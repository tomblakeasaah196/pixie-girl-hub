-- ============================================================
-- 000312_shared_org_position_role
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- The organigramme becomes the single source of truth for "who does what
-- and what they can do". A position now carries the RBAC role it grants, so
-- slotting a person into a seat (org_positions.profile_id) can automatically
-- grant that person's login the position's role — and reassigning revokes the
-- old one. Job title + department flow from the position too, killing the
-- free-text fields in HR.
--
-- role_id is nullable: a position with no role grants nothing (structure-only),
-- and ON DELETE SET NULL means retiring a role never orphans a position row.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE shared.org_positions
  ADD COLUMN IF NOT EXISTS role_id UUID
    REFERENCES shared.roles (role_id) ON DELETE SET NULL;

COMMENT ON COLUMN shared.org_positions.role_id IS
  'RBAC role this position grants. When a person is assigned to the position '
  '(profile_id) their login is granted this role for the position''s brand; '
  'reassigning revokes the prior grant. NULL = structure-only position.';

CREATE INDEX IF NOT EXISTS idx_org_positions_role
  ON shared.org_positions (role_id);

-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='shared' AND table_name='org_positions'
--     AND column_name='role_id';   -- 1 row
-- ============================================================
