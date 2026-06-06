-- ============================================================
-- 000106_shared_supplier_numbering
-- Adds the 'supplier' document-numbering sequence per business so
-- {{BUSINESS}}.suppliers.supplier_code (NOT NULL UNIQUE) can be issued via
-- fn_next_document_number('supplier'). The base seed (000035) shipped PO/RFQ/
-- GRN/SI sequences but not the supplier master code.
-- Idempotent: ON CONFLICT (business, document_type) DO NOTHING.
-- ============================================================

INSERT INTO shared.document_numbering (business, document_type, prefix, padding, next_number)
VALUES
  ('pixiegirl',   'supplier', 'PXG-SUP', 4, 1),
  ('faitlynhair', 'supplier', 'FLH-SUP', 4, 1)
ON CONFLICT (business, document_type) DO NOTHING;
