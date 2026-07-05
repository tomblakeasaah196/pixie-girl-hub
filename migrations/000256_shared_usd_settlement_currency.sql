-- ============================================================
-- MIGRATION 000256 — Mark USD as a settlement currency
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- The launch seed (000015) set is_settlement = true only for NGN, but the
-- storefront + campaign checkout have always SETTLED foreign orders in USD via
-- Nomba's USD account. The new parametric currency layer gates "can we CHARGE
-- in this currency?" on shared.currencies.is_settlement, so USD must reflect
-- reality: it is a settlement currency today.
--
-- With this flag set, a shopper who views USD settles in USD (unchanged); a
-- shopper who views a non-settlement currency (e.g. GBP/EUR) still settles in
-- USD until that currency is itself marked is_settlement (i.e. once its own
-- Nomba/Stripe account is linked). NGN is unaffected.
--
-- Idempotent: a plain UPDATE, safe to re-run.
-- ============================================================

UPDATE shared.currencies
   SET is_settlement = true
 WHERE currency_code = 'USD';
