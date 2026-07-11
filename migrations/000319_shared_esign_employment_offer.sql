-- ============================================================
-- MIGRATION 000319 — Add 'employment_offer' to signature_requests.request_type
-- Pixie Girl Hub · JBS Praxis
--
-- The recruitment module sends offers with request_type = 'employment_offer',
-- but migration 000101 only allows seven values in the CHECK constraint.
-- This adds the missing value so offer-send no longer hits a 23514 violation.
-- ============================================================

ALTER TABLE shared.signature_requests
  DROP CONSTRAINT IF EXISTS signature_requests_request_type_check;

ALTER TABLE shared.signature_requests
  ADD CONSTRAINT signature_requests_request_type_check
  CHECK (request_type IN (
    'stylist_partner_agreement',
    'employment_contract',
    'employment_offer',
    'nda',
    'supplier_agreement',
    'service_agreement',
    'investor_document',
    'other'
  ));
