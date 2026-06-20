/**
 * Purchasing & Procurement (V2.2 §6.8) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const money = z.coerce.number();
const nonNeg = z.coerce.number().nonnegative();
const rate = z.coerce.number().min(0).max(1);

// ── Suppliers ────────────────────────────────────────────
const supplierProduct = z
  .object({
    variant_id: z.string().uuid(),
    supplier_sku: z.string().max(120).optional(),
    supplier_description: z.string().max(500).optional(),
    last_unit_cost: money.optional(),
    last_unit_cost_currency: z.string().length(3).optional(),
    last_unit_cost_ngn: money.optional(),
    lead_time_days: z.coerce.number().int().nonnegative().optional(),
    minimum_order_qty: z.coerce.number().int().nonnegative().optional(),
    preferred: z.boolean().optional(),
    is_active: z.boolean().optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const supplierCreate = z
  .object({
    // Link an existing contact (contact_id) OR pass supplier_name to auto-create
    // a 'supplier' contact (the "either/or" is enforced in the service).
    contact_id: z.string().uuid().optional(),
    display_name: z.string().min(1).max(200).optional(),
    supplier_name: z.string().min(1).max(200).optional(),
    email: z.string().email().optional(),
    country: z.string().max(80).optional(),
    currency: z.string().length(3).optional(),
    supplier_type: z
      .enum([
        "goods",
        "services",
        "factory",
        "3pl",
        "customs_broker",
        "utility",
      ])
      .optional(),
    country_of_origin: z.string().max(80).optional(),
    city: z.string().max(120).optional(),
    default_currency: z.string().length(3).optional(),
    tax_treatment: z
      .enum(["standard", "zero_rated", "exempt", "foreign", "reverse_charge"])
      .optional(),
    vat_applicable: z.boolean().optional(),
    wht_applicable: z.boolean().optional(),
    wht_rate: rate.optional(),
    payment_terms_days: z.coerce.number().int().nonnegative().optional(),
    credit_limit_ngn: money.optional(),
    bank_name: z.string().max(160).optional(),
    bank_account_number: z.string().max(40).optional(),
    bank_swift: z.string().max(20).optional(),
    bank_routing: z.string().max(40).optional(),
    bank_address: z.string().max(300).optional(),
    preferred: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
    products: z.array(supplierProduct).optional(),
  })
  .strict();

const supplierUpdate = supplierCreate
  .omit({ contact_id: true, products: true })
  .extend({
    on_hold: z.boolean().optional(),
    hold_reason: z.string().max(500).optional(),
    is_active: z.boolean().optional(),
    performance_rating: z.coerce.number().min(0).max(5).optional(),
  })
  .partial()
  .strict();

const supplierContactAdd = z
  .object({
    contact_id: z.string().uuid(),
    role: z.string().max(40).optional(),
    is_primary: z.boolean().optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const supplierProductUpdate = supplierProduct
  .omit({ variant_id: true })
  .partial()
  .strict();

// ── RFQ ──────────────────────────────────────────────────
const rfqLine = z
  .object({
    variant_id: z.string().uuid().optional(),
    description: z.string().min(1).max(500),
    quantity: z.coerce.number().int().positive(),
    unit_of_measure: z.string().max(20).optional(),
    target_unit_price_ngn: money.optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();
const rfqCreate = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    response_deadline: z.string().date().optional(),
    lines: z.array(rfqLine).min(1),
  })
  .strict();
const quoteCreate = z
  .object({
    supplier_id: z.string().uuid(),
    quote_currency: z.string().length(3),
    total_quoted: money,
    total_quoted_ngn: money,
    fx_rate_used: money.optional(),
    line_prices: z.array(z.record(z.any())).optional(),
    payment_terms_days: z.coerce.number().int().nonnegative().optional(),
    lead_time_days: z.coerce.number().int().nonnegative().optional(),
    validity_until: z.string().date().optional(),
    shipping_terms: z.string().max(120).optional(),
    quote_document_id: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
const award = z.object({ quote_id: z.string().uuid() }).strict();

// ── Purchase orders ──────────────────────────────────────
const poLine = z
  .object({
    variant_id: z.string().uuid().optional(),
    description: z.string().min(1).max(500),
    supplier_sku: z.string().max(120).optional(),
    qty_ordered: z.coerce.number().int().positive(),
    unit_price: money,
    tax_rate: rate.optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();
const poCreate = z
  .object({
    supplier_id: z.string().uuid(),
    rfq_id: z.string().uuid().optional(),
    awarded_quote_id: z.string().uuid().optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    delivery_location_id: z.string().uuid().optional(),
    po_currency: z.string().length(3),
    fx_rate: money.optional(),
    shipping: nonNeg.optional(),
    payment_terms_days: z.coerce.number().int().nonnegative().optional(),
    expected_delivery: z.string().date().optional(),
    shipping_terms: z.string().max(120).optional(),
    lines: z.array(poLine).min(1),
  })
  .strict();
const poAdvance = z
  .object({
    to_status: z.enum([
      "in_production",
      "quality_check",
      "ready_to_ship",
      "in_transit",
      "arrived_lagos",
      "cleared_customs",
      "partially_received",
      "received",
      "closed",
    ]),
    notes: z.string().max(500).optional(),
    source: z.enum(["user", "system", "webhook"]).optional(),
  })
  .strict();
const poCancel = z.object({ reason: z.string().max(500).optional() }).strict();

// ── GRN ──────────────────────────────────────────────────
const grnLine = z
  .object({
    po_line_id: z.string().uuid(),
    variant_id: z.string().uuid().optional(),
    qty_expected: z.coerce.number().int().nonnegative(),
    qty_received: z.coerce.number().int().nonnegative(),
    qty_rejected: z.coerce.number().int().nonnegative().optional(),
    inspection_result: z
      .enum(["pass", "partial_pass", "fail", "pending"])
      .optional(),
    rejection_reason: z.string().max(500).optional(),
    unit_cost_ngn: money.optional(),
  })
  .strict();
const grnCreate = z
  .object({
    po_id: z.string().uuid(),
    received_at_location_id: z.string().uuid(),
    inbound_shipment_id: z.string().uuid().optional(),
    delivery_note_ref: z.string().max(120).optional(),
    inspected_by: z.string().uuid().optional(),
    rejection_reason: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    lines: z.array(grnLine).min(1),
  })
  .strict();

// ── Supplier invoices ────────────────────────────────────
const supplierInvoiceLine = z
  .object({
    po_line_id: z.string().uuid().optional(),
    description: z.string().min(1).max(500),
    quantity: z.coerce.number().positive(),
    unit_price: money,
    tax_rate: rate.optional(),
  })
  .strict();
const supplierInvoiceCreate = z
  .object({
    invoice_number: z.string().min(1).max(120),
    supplier_id: z.string().uuid(),
    po_id: z.string().uuid().optional(),
    invoice_currency: z.string().length(3),
    fx_rate: money.optional(),
    invoice_date: z.string().date(),
    due_date: z.string().date(),
    shipping: nonNeg.optional(),
    wht_amount: nonNeg.optional(),
    invoice_document_id: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
    lines: z.array(supplierInvoiceLine).min(1),
  })
  .strict();
const invoiceApprove = z
  .object({ override_reason: z.string().max(500).optional() })
  .strict();
const invoicePay = z
  .object({
    amount_ngn: z.coerce.number().positive(),
    payment_account_code: z.string().max(20).optional(),
  })
  .strict();
const invoiceVoid = z
  .object({ reason: z.string().max(500).optional() })
  .strict();

const mw = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

module.exports = {
  validateSupplierCreate: mw(supplierCreate),
  validateSupplierUpdate: mw(supplierUpdate),
  validateSupplierContactAdd: mw(supplierContactAdd),
  validateSupplierProductAdd: mw(supplierProduct),
  validateSupplierProductUpdate: mw(supplierProductUpdate),
  validateRfqCreate: mw(rfqCreate),
  validateQuoteCreate: mw(quoteCreate),
  validateAward: mw(award),
  validatePoCreate: mw(poCreate),
  validatePoAdvance: mw(poAdvance),
  validatePoCancel: mw(poCancel),
  validateGrnCreate: mw(grnCreate),
  validateSupplierInvoiceCreate: mw(supplierInvoiceCreate),
  validateInvoiceApprove: mw(invoiceApprove),
  validateInvoicePay: mw(invoicePay),
  validateInvoiceVoid: mw(invoiceVoid),
};
