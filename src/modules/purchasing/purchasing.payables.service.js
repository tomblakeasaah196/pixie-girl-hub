/**
 * Purchasing & Procurement (V2.2 §6.8) — goods receipt + payables service.
 *
 * GRN: receive against a PO → posts 'receive' stock movements (SSOT) and rolls
 * received quantities up to the PO, capturing the actual unit cost at receipt.
 * Supplier invoices: three-way match (PO line ↔ GRN line ↔ invoice line) →
 * approve (DR Inventory 1300 + DR VAT-input 2110 / CR AP 2000) → pay
 * (DR AP / CR Cash, withholding to WHT Payable 2240). Invoice-driven inventory
 * valuation per the as-shipped COA (no GRNI account).
 */

"use strict";

const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const repo = require("./purchasing.repo");
const events = require("./purchasing.events");
const accounting = require("../accounting/accounting.service");
const stock = require("../stock/stock.service");
const {
  NotFoundError,
  ConflictError,
  ValidationError,
} = require("../../utils/errors");

const PRICE_TOLERANCE_NGN = money("1.00"); // accept ≤ ₦1 rounding drift on price match
const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  metadata,
  request_id,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    metadata,
    request_id,
  });

// ── Goods received notes ─────────────────────────────────
async function createGrn({ brand, user, request_id, input }) {
  if (!input.lines || input.lines.length === 0)
    throw new ValidationError("A GRN needs at least one line");
  return transaction(async (client) => {
    const po = await repo.getPo({ client, brand, id: input.po_id });
    if (!po) throw new NotFoundError("Purchase order not found");
    let expected = 0,
      received = 0,
      rejected = 0;
    for (const l of input.lines) {
      expected += Number(l.qty_expected || 0);
      received += Number(l.qty_received || 0);
      rejected += Number(l.qty_rejected || 0);
    }
    const grn_number = await repo.nextNumber({
      client,
      brand,
      type: "goods_received_note",
    });
    const grn = await repo.createGrn({
      client,
      brand,
      row: {
        grn_number,
        po_id: input.po_id,
        inbound_shipment_id: input.inbound_shipment_id,
        received_at_location_id: input.received_at_location_id,
        delivery_note_ref: input.delivery_note_ref,
        received_by: user?.user_id,
        inspected_by: input.inspected_by,
        total_qty_expected: expected,
        total_qty_received: received,
        total_qty_rejected: rejected,
        rejection_reason: input.rejection_reason,
        notes: input.notes,
      },
    });
    let order = 0;
    for (const l of input.lines) {
      await repo.addGrnLine({
        client,
        brand,
        line: { ...l, grn_id: grn.grn_id, display_order: order++ },
      });
    }
    await A(
      brand,
      user?.user_id,
      "purchasing.grn.create",
      "goods_received_note",
      grn.grn_id,
      { grn_number, po_id: input.po_id },
      request_id,
    );
    return repo.getGrn({ client, brand, id: grn.grn_id });
  });
}
const getGrn = async ({ brand, id }) => {
  const grn = await repo.getGrn({ client: null, brand, id });
  if (!grn) throw new NotFoundError("GRN not found");
  return grn;
};
const listGrns = ({ brand, filters, page, page_size }) =>
  repo.listGrns({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

/** Post a GRN: move stock in, roll received qty to the PO, refresh last cost. */
async function postGrn({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const grn = await repo.getGrn({ client, brand, id });
    if (!grn) throw new NotFoundError("GRN not found");
    if (["posted", "reversed", "rejected"].includes(grn.status))
      throw new ConflictError(`GRN is already '${grn.status}'`);
    const po = await repo.getPo({ client, brand, id: grn.po_id });
    if (!po) throw new NotFoundError("Purchase order not found");

    for (const line of grn.lines) {
      if (Number(line.qty_received) > 0 && line.variant_id) {
        await stock.receiveStock({
          client,
          brand,
          variant_id: line.variant_id,
          location_id: grn.received_at_location_id,
          quantity: Number(line.qty_received),
          reference_id: grn.grn_id,
          reference_type: "goods_received_note",
          unit_cost_ngn: line.unit_cost_ngn,
          user_id: user?.user_id,
        });
        // Keep the supplier's last cost fresh for future RFQ/PO pre-fill.
        if (line.unit_cost_ngn !== null) {
          await repo.addSupplierProduct({
            client,
            brand,
            row: {
              supplier_id: po.supplier_id,
              variant_id: line.variant_id,
              last_unit_cost_ngn: line.unit_cost_ngn,
              last_unit_cost: line.unit_cost_ngn,
              last_unit_cost_currency: "NGN",
            },
          });
        }
      }
      await repo.incrementPoLineReceived({
        client,
        brand,
        po_line_id: line.po_line_id,
        qty_received: Number(line.qty_received),
        qty_rejected: Number(line.qty_rejected || 0),
      });
    }
    await repo.rollupPoReceived({ client, brand, po_id: grn.po_id });

    // PO status: fully received when no line has outstanding qty, else partial.
    const poLines = await repo.listPoLines({ client, brand, po_id: grn.po_id });
    const fullyReceived = poLines.every((l) => Number(l.qty_outstanding) <= 0);
    const newPoStatus = fullyReceived ? "received" : "partially_received";
    if (po.status !== newPoStatus) {
      await repo.setPoStatus({
        client,
        brand,
        id: grn.po_id,
        status: newPoStatus,
      });
      await repo.addPoHistory({
        client,
        brand,
        h: {
          po_id: grn.po_id,
          from_status: po.status,
          to_status: newPoStatus,
          changed_by: user?.user_id,
          changed_by_source: "system",
          notes: `GRN ${grn.grn_number} posted`,
        },
      });
    }
    await repo.setGrnStatus({
      client,
      brand,
      id,
      status: "posted",
      extra: { posted_at: new Date().toISOString() },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.grn.post",
      "goods_received_note",
      id,
      { po_id: grn.po_id, po_status: newPoStatus },
      request_id,
    );
    events.emit("grn.posted", { brand, grn_id: id, po_id: grn.po_id });
    return repo.getGrn({ client, brand, id });
  });
}

// ── Supplier invoices + three-way matching ───────────────
function computeInvoiceTotals(lines, { fx_rate, shipping, wht_amount }) {
  const fx = money(fx_rate || 1);
  const ship = money(shipping || 0);
  let subtotal = money(0),
    tax = money(0);
  const computed = lines.map((l, idx) => {
    const q = money(l.quantity);
    const unit = money(l.unit_price);
    const lineTotal = unit.times(q);
    const rate = money(l.tax_rate || 0);
    subtotal = subtotal.plus(lineTotal);
    tax = tax.plus(lineTotal.times(rate));
    return {
      ...l,
      line_total: toCurrencyString(lineTotal),
      line_total_ngn: toCurrencyString(lineTotal.times(fx)),
      display_order: idx,
    };
  });
  const total = subtotal.plus(tax).plus(ship);
  return {
    lines: computed,
    header: {
      subtotal: toCurrencyString(subtotal),
      tax_amount: toCurrencyString(tax),
      shipping: toCurrencyString(ship),
      wht_amount: toCurrencyString(money(wht_amount || 0)),
      total: toCurrencyString(total),
      total_ngn: toCurrencyString(total.times(fx)),
      fx_rate_used: toCurrencyString(fx),
    },
  };
}

async function createSupplierInvoice({ brand, user, request_id, input }) {
  if (!input.lines || input.lines.length === 0)
    throw new ValidationError("A supplier invoice needs at least one line");
  return transaction(async (client) => {
    const internal_reference = await repo.nextNumber({
      client,
      brand,
      type: "supplier_invoice",
    });
    const { lines, header } = computeInvoiceTotals(input.lines, {
      fx_rate: input.fx_rate,
      shipping: input.shipping,
      wht_amount: input.wht_amount,
    });
    const invoice = await repo.createSupplierInvoice({
      client,
      brand,
      row: {
        invoice_number: input.invoice_number,
        internal_reference,
        supplier_id: input.supplier_id,
        po_id: input.po_id,
        invoice_currency: input.invoice_currency,
        subtotal: header.subtotal,
        tax_amount: header.tax_amount,
        wht_amount: header.wht_amount,
        shipping: header.shipping,
        total: header.total,
        total_ngn: header.total_ngn,
        fx_rate_used: header.fx_rate_used,
        invoice_date: input.invoice_date,
        due_date: input.due_date,
        invoice_document_id: input.invoice_document_id,
        notes: input.notes,
      },
    });
    for (const l of lines) {
      await repo.addSupplierInvoiceLine({
        client,
        brand,
        line: { ...l, supplier_invoice_id: invoice.supplier_invoice_id },
      });
    }
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier_invoice.create",
      "supplier_invoice",
      invoice.supplier_invoice_id,
      { internal_reference, total_ngn: header.total_ngn },
      request_id,
    );
    return repo.getSupplierInvoice({
      client,
      brand,
      id: invoice.supplier_invoice_id,
    });
  });
}
const getSupplierInvoice = async ({ brand, id }) => {
  const inv = await repo.getSupplierInvoice({ client: null, brand, id });
  if (!inv) throw new NotFoundError("Supplier invoice not found");
  return inv;
};
const listSupplierInvoices = ({ brand, filters, page, page_size }) =>
  repo.listSupplierInvoices({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

/** Three-way match each PO-linked invoice line against PO + GRN. */
async function matchSupplierInvoice({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const inv = await repo.getSupplierInvoice({ client, brand, id });
    if (!inv) throw new NotFoundError("Supplier invoice not found");
    if (["paid", "void"].includes(inv.status))
      throw new ConflictError(`Cannot match a '${inv.status}' invoice`);
    let allMatched = true;
    let worst = "matched";
    for (const line of inv.lines) {
      if (!line.po_line_id) {
        allMatched = false;
        if (worst === "matched") worst = "no_grn";
        continue;
      }
      const poLine = await repo.getPoLine({
        client,
        brand,
        line_id: line.po_line_id,
      });
      const grnLine = await repo.findGrnLineForPoLine({
        client,
        brand,
        po_line_id: line.po_line_id,
      });
      const received = poLine ? Number(poLine.qty_received) : 0;
      const qtyMatch = poLine ? Number(line.quantity) <= received : false;
      const poUnitNgn = poLine ? money(poLine.unit_price_ngn) : money(0);
      const invUnitNgn = money(line.line_total_ngn).div(money(line.quantity));
      const priceMatch = invUnitNgn
        .minus(poUnitNgn)
        .abs()
        .lte(PRICE_TOLERANCE_NGN);
      const variance = money(line.line_total_ngn).minus(
        poUnitNgn.times(money(line.quantity)),
      );
      let status;
      if (!grnLine || received === 0) status = "no_grn";
      else if (!qtyMatch) status = "quantity_variance";
      else if (!priceMatch) status = "price_variance";
      else status = "matched";
      if (status !== "matched") {
        allMatched = false;
        if (worst === "matched") worst = status;
      }
      await repo.addMatch({
        client,
        brand,
        match: {
          supplier_invoice_id: id,
          supplier_invoice_line_id: line.line_id,
          po_line_id: line.po_line_id,
          grn_line_id: grnLine ? grnLine.line_id : null,
          quantity_match: qtyMatch,
          price_match: priceMatch,
          match_status: status,
          variance_ngn: toCurrencyString(variance),
        },
      });
    }
    const matchStatus = allMatched
      ? "matched"
      : worst === "no_grn"
        ? "no_grn"
        : worst === "quantity_variance"
          ? "quantity_mismatch"
          : "price_mismatch";
    await repo.setSupplierInvoiceStatus({
      client,
      brand,
      id,
      status: allMatched ? "matched" : "matching",
      extra: { match_status: matchStatus },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier_invoice.match",
      "supplier_invoice",
      id,
      { match_status: matchStatus },
      request_id,
    );
    return repo.getSupplierInvoice({ client, brand, id });
  });
}

/** Approve a matched (or overridden) invoice and post it to the GL. */
async function approveSupplierInvoice({
  brand,
  user,
  request_id,
  id,
  override_reason,
}) {
  return transaction(async (client) => {
    const inv = await repo.getSupplierInvoice({ client, brand, id });
    if (!inv) throw new NotFoundError("Supplier invoice not found");
    if (!["matched", "matching", "received"].includes(inv.status))
      throw new ConflictError(`Cannot approve a '${inv.status}' invoice`);
    if (inv.match_status !== "matched" && !override_reason) {
      throw new ConflictError(
        "Invoice has match variances; an override reason is required to approve",
      );
    }
    const fx = money(inv.fx_rate_used);
    const totalNgn = money(inv.total_ngn);
    const taxNgn = money(inv.tax_amount).times(fx);
    const inventoryNgn = totalNgn.minus(taxNgn); // subtotal + shipping, capitalised into inventory
    const lines = [
      {
        account_code: "1300",
        debit_ngn: toCurrencyString(inventoryNgn),
        description: `Inventory — ${inv.internal_reference}`,
      },
    ];
    if (taxNgn.gt(0))
      lines.push({
        account_code: "2110",
        debit_ngn: toCurrencyString(taxNgn),
        description: "VAT input",
      });
    lines.push({
      account_code: "2000",
      credit_ngn: toCurrencyString(totalNgn),
      description: `AP — supplier invoice ${inv.invoice_number}`,
    });
    const journal = await accounting.postEntry({
      client,
      brand,
      user_id: user?.user_id,
      entry: {
        source_type: "purchase",
        source_table: `${brand}.supplier_invoices`,
        source_id: id,
        reference: inv.internal_reference,
        description: `Supplier invoice ${inv.internal_reference}`,
      },
      lines,
    });
    const updated = await repo.setSupplierInvoiceStatus({
      client,
      brand,
      id,
      status: "approved",
      extra: {
        journal_entry_id: journal.entry_id,
        approved_by: user?.user_id,
        approved_at: new Date().toISOString(),
        ...(override_reason ? { match_status: "overridden" } : {}),
      },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier_invoice.approve",
      "supplier_invoice",
      id,
      { journal_entry_id: journal.entry_id, override: !!override_reason },
      request_id,
    );
    events.emit("supplier_invoice.approved", {
      brand,
      supplier_invoice_id: id,
    });
    return updated;
  });
}

/** Record a payment against an approved invoice; withholds WHT proportionally. */
async function paySupplierInvoice({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const inv = await repo.getSupplierInvoice({ client, brand, id });
    if (!inv) throw new NotFoundError("Supplier invoice not found");
    if (!["approved", "partially_paid"].includes(inv.status))
      throw new ConflictError(`Cannot pay a '${inv.status}' invoice`);
    const totalNgn = money(inv.total_ngn);
    const amount = money(input.amount_ngn);
    const alreadyPaid = money(inv.amount_paid_ngn);
    if (amount.plus(alreadyPaid).gt(totalNgn.plus(money("0.01"))))
      throw new ValidationError("Payment exceeds the invoice balance");
    const fx = money(inv.fx_rate_used);
    const whtTotalNgn = money(inv.wht_amount).times(fx);
    const proportion = totalNgn.gt(0) ? amount.div(totalNgn) : money(0);
    const whtThis = whtTotalNgn.times(proportion);
    const cashOut = amount.minus(whtThis);
    const lines = [
      {
        account_code: "2000",
        debit_ngn: toCurrencyString(amount),
        description: `AP settled — ${inv.internal_reference}`,
      },
      {
        account_code: input.payment_account_code || "1100",
        credit_ngn: toCurrencyString(cashOut),
        description: `Paid supplier ${inv.invoice_number}`,
      },
    ];
    if (whtThis.gt(0))
      lines.push({
        account_code: "2240",
        credit_ngn: toCurrencyString(whtThis),
        description: "WHT withheld",
      });
    const journal = await accounting.postEntry({
      client,
      brand,
      user_id: user?.user_id,
      entry: {
        source_type: "payment",
        source_table: `${brand}.supplier_invoices`,
        source_id: id,
        reference: inv.internal_reference,
        description: `Payment for ${inv.internal_reference}`,
      },
      lines,
    });
    const afterPay = await repo.applySupplierPayment({
      client,
      brand,
      id,
      amount_ngn: toCurrencyString(amount),
    });
    const fullyPaid = money(afterPay.amount_paid_ngn).gte(
      totalNgn.minus(money("0.01")),
    );
    const updated = await repo.setSupplierInvoiceStatus({
      client,
      brand,
      id,
      status: fullyPaid ? "paid" : "partially_paid",
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier_invoice.pay",
      "supplier_invoice",
      id,
      {
        amount_ngn: toCurrencyString(amount),
        wht_ngn: toCurrencyString(whtThis),
        journal_entry_id: journal.entry_id,
        fully_paid: fullyPaid,
      },
      request_id,
    );
    events.emit("supplier_invoice.paid", {
      brand,
      supplier_invoice_id: id,
      fully_paid: fullyPaid,
    });
    return { ...updated, journal_entry_id: journal.entry_id };
  });
}

async function voidSupplierInvoice({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const inv = await repo.getSupplierInvoice({ client, brand, id });
    if (!inv) throw new NotFoundError("Supplier invoice not found");
    if (["paid", "partially_paid"].includes(inv.status))
      throw new ConflictError(
        "Cannot void an invoice with payments; reverse the journal instead",
      );
    const updated = await repo.setSupplierInvoiceStatus({
      client,
      brand,
      id,
      status: "void",
      extra: { notes: reason || inv.notes },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier_invoice.void",
      "supplier_invoice",
      id,
      { reason },
      request_id,
    );
    return updated;
  });
}

module.exports = {
  createGrn,
  getGrn,
  listGrns,
  postGrn,
  createSupplierInvoice,
  getSupplierInvoice,
  listSupplierInvoices,
  matchSupplierInvoice,
  approveSupplierInvoice,
  paySupplierInvoice,
  voidSupplierInvoice,
};
