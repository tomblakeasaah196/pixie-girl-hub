/**
 * Accounting & Finance (V2.2 §6.6) — Zod validators for bank rec & tax filings.
 */

"use strict";

const { z } = require("zod");
const money = z.coerce.number();
const nonNeg = z.coerce.number().nonnegative();

const statementLine = z
  .object({
    transaction_date: z.string().date(),
    value_date: z.string().date().optional(),
    reference: z.string().max(120).optional(),
    narration: z.string().min(1).max(500),
    credit_amount: nonNeg.optional(),
    debit_amount: nonNeg.optional(),
    running_balance: money.optional(),
    notes: z.string().max(500).optional(),
  })
  .strict()
  .refine((l) => (l.credit_amount || 0) > 0 !== (l.debit_amount || 0) > 0, {
    message: "Each line must be either a credit or a debit, not both",
  });

const statementImport = z
  .object({
    bank_account_id: z.string().uuid(),
    statement_number: z.string().max(80).optional(),
    statement_date: z.string().date(),
    period_start: z.string().date(),
    period_end: z.string().date(),
    currency: z.string().length(3).optional(),
    opening_balance: money,
    closing_balance: money,
    total_credits: nonNeg.optional(),
    total_debits: nonNeg.optional(),
    source: z
      .enum([
        "manual",
        "paystack_settlement",
        "opay_settlement",
        "nomba",
        "bank_csv",
        "open_banking",
        "pdf_ocr",
      ])
      .optional(),
    source_document_id: z.string().uuid().optional(),
    lines: z.array(statementLine).default([]),
  })
  .strict();

const reconOpen = z
  .object({
    bank_account_id: z.string().uuid(),
    statement_id: z.string().uuid().optional(),
    fiscal_period_id: z.string().uuid().optional(),
    as_of_date: z.string().date().optional(),
    book_balance_ngn: money,
    statement_balance_ngn: money,
    notes: z.string().max(1000).optional(),
  })
  .strict();

const reconMatch = z
  .object({
    statement_line_id: z.string().uuid(),
    match_type: z.enum([
      "sales_order_payment",
      "journal_entry",
      "supplier_invoice_payment",
      "fee",
      "transfer_in",
      "transfer_out",
      "unidentified",
    ]),
    sales_order_payment_id: z.string().uuid().optional(),
    journal_entry_id: z.string().uuid().optional(),
    amount_matched_ngn: z.coerce.number().positive(),
    confidence: z.coerce.number().min(0).max(1).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const filingCreate = z
  .object({
    tax_type: z.enum(["VAT", "WHT", "PAYE", "CIT", "EDT", "other"]),
    fiscal_period_id: z.string().uuid().optional(),
    taxable_amount_ngn: nonNeg.optional(),
    tax_amount_ngn: nonNeg.optional(),
    due_date: z.string().date(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
const filingDraftFromPeriod = z
  .object({
    tax_type: z.enum(["VAT", "WHT", "PAYE"]),
    fiscal_period_id: z.string().uuid(),
  })
  .strict();
const filingFile = z
  .object({
    filing_reference: z.string().max(120).optional(),
    filing_document_id: z.string().uuid().optional(),
  })
  .strict();
const filingPay = z
  .object({
    payment_reference: z.string().max(120).optional(),
    receipt_document_id: z.string().uuid().optional(),
  })
  .strict();

const mw = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

module.exports = {
  validateStatementImport: mw(statementImport),
  validateReconOpen: mw(reconOpen),
  validateReconMatch: mw(reconMatch),
  validateFilingCreate: mw(filingCreate),
  validateFilingDraftFromPeriod: mw(filingDraftFromPeriod),
  validateFilingFile: mw(filingFile),
  validateFilingPay: mw(filingPay),
};
