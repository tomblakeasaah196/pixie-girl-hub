-- ============================================================
-- MIGRATION 000014 — Shared triggers
-- Pixie Girl Hub · JBS Praxis · V2.0
--
-- Triggers that enforce invariants and maintain denormalised
-- summaries in the shared schema:
--
--   • audit_log:               block UPDATE/DELETE (immutable)
--   • documents:               block edits except soft-delete fields
--   • loyalty_ledger:          maintain customer_loyalty_state
--   • subscription_billing:    pause after N failures + notify
--   • intercompany:            prevent settlement on open recons
--   • workflow_instances:      cascade timeout from definitions
--   • ai_usage_ledger:         maintain ai_usage_daily + budget totals
--   • ai_budget_periods:       breach-detection notifications
--   • storefront published:    snapshot to storefront_revisions
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ AUDIT LOG IMMUTABILITY                                             ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_block_audit_modification()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; UPDATE/DELETE not permitted'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON shared.audit_log
  FOR EACH ROW EXECUTE FUNCTION shared.fn_block_audit_modification();

CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON shared.audit_log
  FOR EACH ROW EXECUTE FUNCTION shared.fn_block_audit_modification();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ DOCUMENT IMMUTABILITY                                              ║
-- ║ Only is_deleted, deleted_at, content_hash-verification-related     ║
-- ║ fields may change after creation.                                  ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_documents_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.document_id      <> NEW.document_id       THEN RAISE EXCEPTION 'document_id is immutable'; END IF;
  IF OLD.document_number  <> NEW.document_number   THEN RAISE EXCEPTION 'document_number is immutable'; END IF;
  IF OLD.business         <> NEW.business          THEN RAISE EXCEPTION 'business is immutable'; END IF;
  IF OLD.document_type    <> NEW.document_type     THEN RAISE EXCEPTION 'document_type is immutable'; END IF;
  IF OLD.file_path        <> NEW.file_path         THEN RAISE EXCEPTION 'file_path is immutable'; END IF;
  IF OLD.content_hash     <> NEW.content_hash      THEN RAISE EXCEPTION 'content_hash is immutable; tampering suspected'; END IF;
  IF OLD.file_size_bytes  <> NEW.file_size_bytes   THEN RAISE EXCEPTION 'file_size_bytes is immutable'; END IF;
  IF OLD.created_at       <> NEW.created_at        THEN RAISE EXCEPTION 'created_at is immutable'; END IF;
  IF OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by
    THEN RAISE EXCEPTION 'uploaded_by is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_documents_immutable
  BEFORE UPDATE ON shared.documents
  FOR EACH ROW EXECUTE FUNCTION shared.fn_documents_immutable();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ LOYALTY: maintain customer_loyalty_state from ledger              ║
-- ║ The ledger is the source of truth; this trigger maintains the      ║
-- ║ materialised summary on every INSERT.                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_loyalty_state_apply_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_earn_delta INTEGER := 0;
  v_redeem_delta INTEGER := 0;
BEGIN
  -- Positive points = earned (or reversal-out); negative = redeemed
  IF NEW.transaction_type LIKE 'earned_%' THEN
    v_earn_delta := GREATEST(NEW.points, 0);
  ELSIF NEW.transaction_type IN ('redeemed','expired') THEN
    v_redeem_delta := ABS(LEAST(NEW.points, 0));
  ELSIF NEW.transaction_type = 'adjustment' THEN
    IF NEW.points > 0 THEN
      v_earn_delta := NEW.points;
    ELSE
      v_redeem_delta := ABS(NEW.points);
    END IF;
  ELSIF NEW.transaction_type = 'reversal' THEN
    -- Reversal subtracts from earned counters
    v_earn_delta := LEAST(NEW.points, 0);     -- negative
  END IF;

  INSERT INTO shared.customer_loyalty_state
    (contact_id, business, current_balance, lifetime_earned, lifetime_redeemed, last_activity_at)
  VALUES
    (NEW.contact_id, NEW.business, NEW.points, GREATEST(v_earn_delta, 0), v_redeem_delta, NEW.created_at)
  ON CONFLICT (contact_id, business) DO UPDATE
    SET current_balance   = shared.customer_loyalty_state.current_balance + NEW.points,
        lifetime_earned   = shared.customer_loyalty_state.lifetime_earned + GREATEST(v_earn_delta, 0),
        lifetime_redeemed = shared.customer_loyalty_state.lifetime_redeemed + v_redeem_delta,
        last_activity_at  = NEW.created_at,
        updated_at        = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_loyalty_state_from_ledger
  AFTER INSERT ON shared.loyalty_ledger
  FOR EACH ROW EXECUTE FUNCTION shared.fn_loyalty_state_apply_ledger();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ SUBSCRIPTIONS: pause after 3 failed attempts in a row              ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_subscription_handle_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'success' THEN
    UPDATE shared.subscriptions
       SET status                  = 'active',
           failed_attempts_in_row  = 0,
           last_billed_at          = NEW.attempted_at,
           total_cycles_billed     = total_cycles_billed + 1,
           total_amount_billed_ngn = total_amount_billed_ngn + NEW.amount_ngn
     WHERE subscription_id = NEW.subscription_id;
  ELSE
    UPDATE shared.subscriptions
       SET failed_attempts_in_row = failed_attempts_in_row + 1,
           status = CASE
                     WHEN failed_attempts_in_row + 1 >= 3 THEN 'paused'
                     ELSE 'past_due'
                   END,
           paused_at = CASE
                        WHEN failed_attempts_in_row + 1 >= 3 THEN now()
                        ELSE paused_at
                      END,
           pause_reason = CASE
                           WHEN failed_attempts_in_row + 1 >= 3
                             THEN 'auto_paused_after_3_failures'
                           ELSE pause_reason
                          END
     WHERE subscription_id = NEW.subscription_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subscription_handle_attempt
  AFTER INSERT ON shared.subscription_billing_attempts
  FOR EACH ROW EXECUTE FUNCTION shared.fn_subscription_handle_attempt();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ INTERCOMPANY: prevent settlement on open reconciliations           ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_intercompany_settlement_check()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'settled' AND OLD.status <> 'settled' THEN
    IF EXISTS (
      SELECT 1
        FROM shared.intercompany_reconciliations
       WHERE ic_transaction_id = NEW.ic_transaction_id
         AND status = 'open'
    ) THEN
      RAISE EXCEPTION
        'Cannot settle intercompany transaction %; open reconciliation(s) exist',
        NEW.ic_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ic_settlement_check
  BEFORE UPDATE ON shared.intercompany_transactions
  FOR EACH ROW EXECUTE FUNCTION shared.fn_intercompany_settlement_check();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ WORKFLOW: compute stage_timeout_at from the definition on insert   ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_workflow_instance_set_timeout()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_timeout_hours INTEGER;
BEGIN
  -- Pull the timeout for the current stage from the definition JSON.
  SELECT (stage->>'timeout_hours')::INTEGER
    INTO v_timeout_hours
    FROM shared.workflow_definitions wd,
         jsonb_array_elements(wd.definition->'stages') AS stage
   WHERE wd.workflow_id = NEW.workflow_id
     AND (stage->>'order')::INTEGER = NEW.current_stage
   LIMIT 1;

  IF v_timeout_hours IS NOT NULL THEN
    NEW.stage_timeout_at := NEW.stage_entered_at + (v_timeout_hours || ' hours')::INTERVAL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_workflow_set_timeout
  BEFORE INSERT OR UPDATE OF current_stage, stage_entered_at
  ON shared.workflow_instances
  FOR EACH ROW EXECUTE FUNCTION shared.fn_workflow_instance_set_timeout();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ STOREFRONT: snapshot to revisions on publish                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_storefront_snapshot_on_publish()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_entity_type TEXT;
  v_snapshot    JSONB;
  v_entity_id   UUID;
BEGIN
  IF NEW.status <> 'published' OR (OLD IS NOT NULL AND OLD.status = 'published') THEN
    RETURN NEW;
  END IF;

  -- Snapshot once. We read the id from the JSON rather than NEW.<col>
  -- directly: a CASE over NEW.theme_id/NEW.page_id/NEW.nav_id forces
  -- Postgres to resolve every branch's column at plan time, which throws
  -- "record new has no field page_id" when the trigger fires on a table
  -- that lacks that column. JSON field access is null-safe per branch.
  v_snapshot := row_to_json(NEW)::jsonb;

  -- TG_TABLE_NAME drives the entity_type label
  v_entity_type := CASE TG_TABLE_NAME
                     WHEN 'storefront_themes'     THEN 'theme'
                     WHEN 'storefront_pages'      THEN 'page'
                     WHEN 'storefront_navigation' THEN 'navigation'
                   END;

  v_entity_id := COALESCE(
                   v_snapshot ->> 'theme_id',
                   v_snapshot ->> 'page_id',
                   v_snapshot ->> 'nav_id'
                 )::uuid;

  INSERT INTO shared.storefront_revisions
    (business, entity_type, entity_id, snapshot, published_by, published_at)
  VALUES
    (NEW.business, v_entity_type, v_entity_id, v_snapshot,
     NEW.published_by, COALESCE(NEW.published_at, now()));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_storefront_themes_snapshot
  AFTER INSERT OR UPDATE OF status ON shared.storefront_themes
  FOR EACH ROW EXECUTE FUNCTION shared.fn_storefront_snapshot_on_publish();

CREATE TRIGGER trg_storefront_pages_snapshot
  AFTER INSERT OR UPDATE OF status ON shared.storefront_pages
  FOR EACH ROW EXECUTE FUNCTION shared.fn_storefront_snapshot_on_publish();

CREATE TRIGGER trg_storefront_nav_snapshot
  AFTER INSERT OR UPDATE OF status ON shared.storefront_navigation
  FOR EACH ROW EXECUTE FUNCTION shared.fn_storefront_snapshot_on_publish();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ AI USAGE: maintain ai_usage_daily + ai_budget_periods totals       ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_ai_usage_rollup()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Upsert into the daily roll-up (now keyed by vendor too — see V2.2 §8.1)
  INSERT INTO shared.ai_usage_daily
    (metric_date, feature_key, vendor, user_id,
     calls_count, total_tokens, input_tokens, output_tokens, audio_seconds, cost_ngn,
     failed_calls_count, refreshed_at)
  VALUES
    (NEW.occurred_at::DATE, NEW.feature_key, NEW.provider, NEW.user_id,
     1, NEW.total_tokens, NEW.input_tokens, NEW.output_tokens, NEW.audio_seconds, NEW.cost_ngn,
     CASE WHEN NEW.was_successful THEN 0 ELSE 1 END, now())
  ON CONFLICT (metric_date, feature_key, vendor, user_id) DO UPDATE
    SET calls_count        = shared.ai_usage_daily.calls_count + 1,
        total_tokens       = shared.ai_usage_daily.total_tokens + EXCLUDED.total_tokens,
        input_tokens       = shared.ai_usage_daily.input_tokens + EXCLUDED.input_tokens,
        output_tokens      = shared.ai_usage_daily.output_tokens + EXCLUDED.output_tokens,
        audio_seconds      = shared.ai_usage_daily.audio_seconds + EXCLUDED.audio_seconds,
        cost_ngn           = shared.ai_usage_daily.cost_ngn + EXCLUDED.cost_ngn,
        failed_calls_count = shared.ai_usage_daily.failed_calls_count + EXCLUDED.failed_calls_count,
        refreshed_at       = now();

  -- Update the active budget period totals
  IF NEW.period_id IS NOT NULL THEN
    UPDATE shared.ai_budget_periods
       SET actual_spend_ngn  = actual_spend_ngn + NEW.cost_ngn,
           actual_calls_count = actual_calls_count + 1
     WHERE period_id = NEW.period_id;
  ELSE
    -- Fallback: find the active period covering this date
    UPDATE shared.ai_budget_periods
       SET actual_spend_ngn  = actual_spend_ngn + NEW.cost_ngn,
           actual_calls_count = actual_calls_count + 1
     WHERE is_active = true
       AND NEW.occurred_at::DATE BETWEEN period_start AND period_end;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ai_usage_rollup
  AFTER INSERT ON shared.ai_usage_ledger
  FOR EACH ROW EXECUTE FUNCTION shared.fn_ai_usage_rollup();

-- ── Budget breach detection on period total update ───────
CREATE OR REPLACE FUNCTION shared.fn_ai_budget_check_breach()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Soft cap newly breached
  IF NEW.actual_spend_ngn >= NEW.soft_cap_ngn
     AND OLD.actual_spend_ngn < NEW.soft_cap_ngn
     AND NEW.soft_cap_breached_at IS NULL THEN
    NEW.soft_cap_breached_at := now();
  END IF;

  -- Hard cap newly breached
  IF NEW.actual_spend_ngn >= NEW.hard_cap_ngn
     AND OLD.actual_spend_ngn < NEW.hard_cap_ngn
     AND NEW.hard_cap_breached_at IS NULL THEN
    NEW.hard_cap_breached_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ai_budget_check_breach
  BEFORE UPDATE OF actual_spend_ngn
  ON shared.ai_budget_periods
  FOR EACH ROW EXECUTE FUNCTION shared.fn_ai_budget_check_breach();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ AI PENDING ACTIONS: refuse confirmation past expiry                ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_ai_pending_action_confirm_check()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status = 'proposed' THEN
    IF OLD.expires_at < now() THEN
      RAISE EXCEPTION 'Cannot confirm expired pending action %; expired at %', OLD.pending_id, OLD.expires_at;
    END IF;
    -- Refuse confirmation by a user other than the proposer
    IF NEW.confirmed_by_user_id IS NULL THEN
      RAISE EXCEPTION 'Confirmation requires confirmed_by_user_id';
    END IF;
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ai_pending_action_confirm_check
  BEFORE UPDATE OF status
  ON shared.ai_pending_actions
  FOR EACH ROW EXECUTE FUNCTION shared.fn_ai_pending_action_confirm_check();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ STYLIST CERTIFICATIONS: keep partners.current_tier_* in sync       ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_stylist_partner_refresh_tier()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_tier_key TEXT;
  v_expires  TIMESTAMPTZ;
BEGIN
  SELECT tier_key, expires_at
    INTO v_tier_key, v_expires
    FROM shared.stylist_certifications
   WHERE stylist_id = COALESCE(NEW.stylist_id, OLD.stylist_id)
     AND is_current = true
     AND revoked_at IS NULL
     AND expires_at > now()
   ORDER BY
     CASE tier_key
       WHEN 'master'    THEN 3
       WHEN 'senior'    THEN 2
       WHEN 'certified' THEN 1
       ELSE 0
     END DESC,
     awarded_at DESC
   LIMIT 1;

  UPDATE shared.stylist_partners
     SET current_tier_key       = v_tier_key,
         current_tier_expires_at = v_expires
   WHERE stylist_id = COALESCE(NEW.stylist_id, OLD.stylist_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_stylist_cert_refresh_partner
  AFTER INSERT OR UPDATE OR DELETE ON shared.stylist_certifications
  FOR EACH ROW EXECUTE FUNCTION shared.fn_stylist_partner_refresh_tier();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ STYLIST ASSIGNMENTS: keep current_active_count in sync             ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION shared.fn_stylist_partner_refresh_load()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_stylist UUID;
BEGIN
  v_stylist := COALESCE(NEW.stylist_id, OLD.stylist_id);
  IF v_stylist IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE shared.stylist_partners
     SET current_active_count = (
       SELECT COUNT(*)
         FROM shared.stylist_assignments
        WHERE stylist_id = v_stylist
          AND status IN ('accepted','in_progress')
     )
   WHERE stylist_id = v_stylist;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_stylist_assignments_refresh_load
  AFTER INSERT OR UPDATE OF status, stylist_id OR DELETE
  ON shared.stylist_assignments
  FOR EACH ROW EXECUTE FUNCTION shared.fn_stylist_partner_refresh_load();
