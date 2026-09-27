-- ============================================================
-- MIGRATION 000390 — Nomba USD wallet settlement account (1141)
-- Pixie Girl Hub · Nomba NGN/USD books
--
-- Applies template 000098 to the EXISTING brand schemas (template migrations
-- only run at bootstrap for new brands). Adds GL account 1141 "Nomba
-- Settlement — USD Wallet" (USD-denominated), which USD Nomba captures debit
-- instead of the Naira 1140 Nomba Settlement.
--
-- Both brand schemas carry the identical chart (template 000035 + 000075), so
-- walk both. Idempotent.
-- ============================================================

DO $$
DECLARE
  v_schema TEXT;
  g_assets UUID;
  usd      TEXT;
BEGIN
  SELECT currency_code INTO usd FROM shared.currencies WHERE currency_code = 'USD';
  FOREACH v_schema IN ARRAY ARRAY['pixiegirl','faitlynhair'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = v_schema AND table_name = 'chart_of_accounts'
    ) THEN
      EXECUTE format(
        'SELECT group_id FROM %I.account_groups WHERE group_code = ''1''',
        v_schema
      ) INTO g_assets;
      EXECUTE format(
        'INSERT INTO %I.chart_of_accounts
           (account_code, account_name, group_id, is_control_account,
            control_subledger, account_currency, description)
         VALUES ($1, $2, $3, false, NULL, $4, $5)
         ON CONFLICT (account_code) DO NOTHING',
        v_schema
      ) USING
        '1141',
        'Nomba Settlement — USD Wallet',
        g_assets,
        usd,
        'Nomba USD wallet float: dollar checkouts land here until paid out or converted';
    END IF;
  END LOOP;
END $$;
