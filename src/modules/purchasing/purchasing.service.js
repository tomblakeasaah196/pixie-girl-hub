/**
 * Purchasing & Procurement (V2.2 §6.8) — procurement service.
 * Covers supplier master data, RFQ → quotes → award, and purchase orders
 * (with the §3 approval workflow + factory-tracking state machine).
 * Goods receipt + supplier invoices/payables live in purchasing.payables.service.
 */

"use strict";

const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const wf = require("../../workflows/engine");
const repo = require("./purchasing.repo");
const events = require("./purchasing.events");
const {
  NotFoundError,
  ConflictError,
  ValidationError,
} = require("../../utils/errors");
const pdf = require("../../services/pdf.service");

const PO_TABLE = "purchase_orders";
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

// Allowed PO factory-tracking transitions (after approval). Mirrors inbound_shipments.
const PO_FLOW = {
  approved: ["in_production", "ready_to_ship", "in_transit", "cancelled"],
  in_production: ["quality_check", "ready_to_ship", "cancelled"],
  quality_check: ["ready_to_ship", "in_production", "cancelled"],
  ready_to_ship: ["in_transit", "cancelled"],
  in_transit: ["arrived_lagos", "cancelled"],
  arrived_lagos: ["cleared_customs"],
  cleared_customs: ["partially_received", "received"],
  partially_received: ["partially_received", "received", "closed"],
  received: ["closed"],
};

// ── Suppliers ────────────────────────────────────────────
async function createSupplier({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const supplier_code = await repo.nextNumber({
      client,
      brand,
      type: "supplier",
    });
    const supplier = await repo.createSupplier({
      client,
      brand,
      row: { ...input, supplier_code, created_by: user?.user_id },
    });
    if (input.products) {
      for (const p of input.products)
        await repo.addSupplierProduct({
          client,
          brand,
          row: { ...p, supplier_id: supplier.supplier_id },
        });
    }
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier.create",
      "supplier",
      supplier.supplier_id,
      { supplier_code },
      request_id,
    );
    events.emit("supplier.created", {
      brand,
      supplier_id: supplier.supplier_id,
    });
    return supplier;
  });
}
async function getSupplier({ brand, id }) {
  const supplier = await repo.getSupplier({ client: null, brand, id });
  if (!supplier) throw new NotFoundError("Supplier not found");
  const [contacts, products] = await Promise.all([
    repo.listSupplierContacts({ client: null, brand, supplier_id: id }),
    repo.listSupplierProducts({ client: null, brand, supplier_id: id }),
  ]);
  return { ...supplier, contacts, products };
}
const listSuppliers = ({ brand, filters, page, page_size }) =>
  repo.listSuppliers({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });
async function updateSupplier({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getSupplier({ client, brand, id });
    if (!existing) throw new NotFoundError("Supplier not found");
    const updated = await repo.updateSupplier({
      client,
      brand,
      id,
      patch: input,
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier.update",
      "supplier",
      id,
      { fields: Object.keys(input) },
      request_id,
    );
    return updated;
  });
}

// ── Supplier contacts ────────────────────────────────────
async function addSupplierContact({
  brand,
  user,
  request_id,
  supplier_id,
  input,
}) {
  return transaction(async (client) => {
    if (input.is_primary)
      await repo.clearPrimaryContacts({ client, brand, supplier_id });
    const link = await repo.addSupplierContact({
      client,
      brand,
      link: { ...input, supplier_id },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier.contact.add",
      "supplier",
      supplier_id,
      { contact_id: input.contact_id },
      request_id,
    );
    return link;
  });
}
const listSupplierContacts = ({ brand, supplier_id }) =>
  repo.listSupplierContacts({ client: null, brand, supplier_id });
async function removeSupplierContact({
  brand,
  user,
  request_id,
  supplier_id,
  contact_link_id,
}) {
  return transaction(async (client) => {
    const ok = await repo.removeSupplierContact({
      client,
      brand,
      supplier_id,
      contact_link_id,
    });
    if (!ok) throw new NotFoundError("Supplier contact not found");
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier.contact.remove",
      "supplier",
      supplier_id,
      { contact_link_id },
      request_id,
    );
    return { removed: true };
  });
}

// ── Supplier products ────────────────────────────────────
async function addSupplierProduct({
  brand,
  user,
  request_id,
  supplier_id,
  input,
}) {
  return transaction(async (client) => {
    const row = await repo.addSupplierProduct({
      client,
      brand,
      row: { ...input, supplier_id },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier.product.add",
      "supplier",
      supplier_id,
      { variant_id: input.variant_id },
      request_id,
    );
    return row;
  });
}
const listSupplierProducts = ({ brand, supplier_id, variant_id }) =>
  repo.listSupplierProducts({ client: null, brand, supplier_id, variant_id });
async function updateSupplierProduct({
  brand,
  user,
  request_id,
  link_id,
  input,
}) {
  return transaction(async (client) => {
    const row = await repo.updateSupplierProduct({
      client,
      brand,
      link_id,
      patch: input,
    });
    if (!row) throw new NotFoundError("Supplier product link not found");
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier.product.update",
      "supplier_product",
      link_id,
      { fields: Object.keys(input) },
      request_id,
    );
    return row;
  });
}
async function removeSupplierProduct({ brand, user, request_id, link_id }) {
  return transaction(async (client) => {
    const ok = await repo.removeSupplierProduct({ client, brand, link_id });
    if (!ok) throw new NotFoundError("Supplier product link not found");
    await A(
      brand,
      user?.user_id,
      "purchasing.supplier.product.remove",
      "supplier_product",
      link_id,
      null,
      request_id,
    );
    return { removed: true };
  });
}

// ── RFQ ──────────────────────────────────────────────────
async function createRfq({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const rfq_number = await repo.nextNumber({ client, brand, type: "rfq" });
    const rfq = await repo.createRfq({
      client,
      brand,
      row: { ...input, rfq_number, created_by: user?.user_id },
    });
    let order = 0;
    for (const l of input.lines || [])
      await repo.addRfqLine({
        client,
        brand,
        line: { ...l, rfq_id: rfq.rfq_id, display_order: order++ },
      });
    await A(
      brand,
      user?.user_id,
      "purchasing.rfq.create",
      "rfq",
      rfq.rfq_id,
      { rfq_number },
      request_id,
    );
    return repo.getRfq({ client, brand, id: rfq.rfq_id });
  });
}
const getRfq = async ({ brand, id }) => {
  const rfq = await repo.getRfq({ client: null, brand, id });
  if (!rfq) throw new NotFoundError("RFQ not found");
  return rfq;
};
const listRfqs = ({ brand, filters, page, page_size }) =>
  repo.listRfqs({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });
async function sendRfq({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const rfq = await repo.getRfq({ client, brand, id });
    if (!rfq) throw new NotFoundError("RFQ not found");
    if (rfq.status !== "draft")
      throw new ConflictError(`Cannot send a '${rfq.status}' RFQ`);
    const updated = await repo.setRfqStatus({
      client,
      brand,
      id,
      status: "sent",
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.rfq.send",
      "rfq",
      id,
      null,
      request_id,
    );
    return updated;
  });
}
async function recordQuote({ brand, user, request_id, rfq_id, input }) {
  return transaction(async (client) => {
    const rfq = await repo.getRfq({ client, brand, id: rfq_id });
    if (!rfq) throw new NotFoundError("RFQ not found");
    if (["awarded", "cancelled"].includes(rfq.status))
      throw new ConflictError(`RFQ is ${rfq.status}`);
    const quote = await repo.addQuote({
      client,
      brand,
      quote: { ...input, rfq_id },
    });
    if (rfq.status === "sent")
      await repo.setRfqStatus({
        client,
        brand,
        id: rfq_id,
        status: "responding",
      });
    await A(
      brand,
      user?.user_id,
      "purchasing.rfq.quote",
      "rfq",
      rfq_id,
      { quote_id: quote.quote_id, supplier_id: input.supplier_id },
      request_id,
    );
    return quote;
  });
}
async function awardQuote({ brand, user, request_id, rfq_id, quote_id }) {
  return transaction(async (client) => {
    const rfq = await repo.getRfq({ client, brand, id: rfq_id });
    if (!rfq) throw new NotFoundError("RFQ not found");
    if (rfq.status === "awarded")
      throw new ConflictError("RFQ already awarded");
    const quote = await repo.getQuote({ client, brand, id: quote_id });
    if (!quote || quote.rfq_id !== rfq_id)
      throw new NotFoundError("Quote not found for this RFQ");
    await repo.setQuoteStatus({
      client,
      brand,
      id: quote_id,
      status: "awarded",
      extra: {
        reviewed_by: user?.user_id,
        reviewed_at: new Date().toISOString(),
      },
    });
    const updated = await repo.setRfqStatus({
      client,
      brand,
      id: rfq_id,
      status: "awarded",
      extra: {
        awarded_supplier_id: quote.supplier_id,
        awarded_quote_id: quote_id,
        awarded_at: new Date().toISOString(),
        awarded_by: user?.user_id,
      },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.rfq.award",
      "rfq",
      rfq_id,
      { quote_id, supplier_id: quote.supplier_id },
      request_id,
    );
    return updated;
  });
}

// ── Purchase orders ──────────────────────────────────────
function computePoTotals(lines, { fx_rate, shipping }) {
  const fx = money(fx_rate || 1);
  const ship = money(shipping || 0);
  let subtotal = money(0),
    subtotalNgn = money(0),
    taxPo = money(0),
    taxNgn = money(0),
    qty = 0;
  const computed = lines.map((l, idx) => {
    const q = Number(l.qty_ordered);
    const unitPrice = money(l.unit_price);
    const unitPriceNgn = unitPrice.times(fx);
    const lineTotal = unitPrice.times(q);
    const lineTotalNgn = unitPriceNgn.times(q);
    const rate = money(l.tax_rate || 0);
    const lineTaxNgn = lineTotalNgn.times(rate);
    subtotal = subtotal.plus(lineTotal);
    subtotalNgn = subtotalNgn.plus(lineTotalNgn);
    taxPo = taxPo.plus(lineTotal.times(rate));
    taxNgn = taxNgn.plus(lineTaxNgn);
    qty += q;
    return {
      ...l,
      unit_price: toCurrencyString(unitPrice),
      unit_price_ngn: toCurrencyString(unitPriceNgn),
      line_total: toCurrencyString(lineTotal),
      line_total_ngn: toCurrencyString(lineTotalNgn),
      tax_amount_ngn: toCurrencyString(lineTaxNgn),
      display_order: idx,
    };
  });
  const shipNgn = ship.times(fx);
  return {
    lines: computed,
    header: {
      subtotal: toCurrencyString(subtotal),
      tax_amount: toCurrencyString(taxPo),
      shipping_amount: toCurrencyString(ship),
      total: toCurrencyString(subtotal.plus(taxPo).plus(ship)),
      total_ngn: toCurrencyString(subtotalNgn.plus(taxNgn).plus(shipNgn)),
      fx_rate_used: toCurrencyString(fx),
      total_qty_ordered: qty,
    },
  };
}

async function createPo({ brand, user, request_id, input }) {
  if (!input.lines || input.lines.length === 0)
    throw new ValidationError("A purchase order needs at least one line");
  return transaction(async (client) => {
    const po_number = await repo.nextNumber({
      client,
      brand,
      type: "purchase_order",
    });
    const po = await repo.createPo({
      client,
      brand,
      row: { ...input, po_number, created_by: user?.user_id },
    });
    const { lines, header } = computePoTotals(input.lines, {
      fx_rate: input.fx_rate,
      shipping: input.shipping,
    });
    for (const l of lines)
      await repo.addPoLine({ client, brand, line: { ...l, po_id: po.po_id } });
    await repo.setPoTotals({ client, brand, id: po.po_id, totals: header });
    await repo.addPoHistory({
      client,
      brand,
      h: {
        po_id: po.po_id,
        from_status: null,
        to_status: "draft",
        changed_by: user?.user_id,
      },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.po.create",
      PO_TABLE,
      po.po_id,
      { po_number, total_ngn: header.total_ngn },
      request_id,
    );
    events.emit("po.created", { brand, po_id: po.po_id });
    return repo.getPo({ client, brand, id: po.po_id });
  });
}
const getPo = async ({ brand, id }) => {
  const po = await repo.getPo({ client: null, brand, id });
  if (!po) throw new NotFoundError("Purchase order not found");
  return po;
};
const listPos = ({ brand, filters, page, page_size }) =>
  repo.listPos({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

async function submitPo({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const po = await repo.getPo({ client, brand, id });
    if (!po) throw new NotFoundError("Purchase order not found");
    if (po.status !== "draft")
      throw new ConflictError(`Cannot submit a '${po.status}' purchase order`);
    const instance = await wf.openInstance({
      client,
      business: brand,
      trigger_module: "purchasing",
      trigger_action: "submit",
      reference_table: PO_TABLE,
      reference_id: id,
      opened_by: user?.user_id,
      context: { po_number: po.po_number, total_ngn: po.total_ngn },
    });
    const updated = await repo.setPoStatus({
      client,
      brand,
      id,
      status: "submitted",
      extra: { workflow_instance_id: instance.instance_id },
    });
    await repo.addPoHistory({
      client,
      brand,
      h: {
        po_id: id,
        from_status: "draft",
        to_status: "submitted",
        changed_by: user?.user_id,
      },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.po.submit",
      PO_TABLE,
      id,
      { workflow_instance_id: instance.instance_id },
      request_id,
    );
    events.emit("po.submitted", { brand, po_id: id });
    return updated;
  });
}
async function approvePo({ brand, user, request_id, id, notes }) {
  return transaction(async (client) => {
    const po = await repo.getPo({ client, brand, id });
    if (!po) throw new NotFoundError("Purchase order not found");
    if (po.status !== "submitted")
      throw new ConflictError(`Cannot approve a '${po.status}' purchase order`);
    const instance = await wf.findOpenInstance({
      client,
      business: brand,
      reference_table: PO_TABLE,
      reference_id: id,
    });
    if (instance)
      await wf.act({
        client,
        instance_id: instance.instance_id,
        user,
        action: "approve",
        notes,
      });
    const updated = await repo.setPoStatus({
      client,
      brand,
      id,
      status: "approved",
      extra: {
        approved_by: user?.user_id,
        approved_at: new Date().toISOString(),
      },
    });
    await repo.addPoHistory({
      client,
      brand,
      h: {
        po_id: id,
        from_status: "submitted",
        to_status: "approved",
        changed_by: user?.user_id,
        notes,
      },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.po.approve",
      PO_TABLE,
      id,
      null,
      request_id,
    );
    events.emit("po.approved", { brand, po_id: id });
    return updated;
  });
}
async function advancePo({
  brand,
  user,
  request_id,
  id,
  to_status,
  notes,
  source,
}) {
  return transaction(async (client) => {
    const po = await repo.getPo({ client, brand, id });
    if (!po) throw new NotFoundError("Purchase order not found");
    const allowed = PO_FLOW[po.status] || [];
    if (!allowed.includes(to_status))
      throw new ConflictError(
        `Cannot move a '${po.status}' PO to '${to_status}'`,
      );
    const updated = await repo.setPoStatus({
      client,
      brand,
      id,
      status: to_status,
    });
    await repo.addPoHistory({
      client,
      brand,
      h: {
        po_id: id,
        from_status: po.status,
        to_status,
        changed_by: user?.user_id,
        changed_by_source: source || "user",
        notes,
      },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.po.advance",
      PO_TABLE,
      id,
      { from: po.status, to: to_status },
      request_id,
    );
    events.emit("po.status", { brand, po_id: id, status: to_status });
    return updated;
  });
}
async function cancelPo({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const po = await repo.getPo({ client, brand, id });
    if (!po) throw new NotFoundError("Purchase order not found");
    if (["received", "closed", "cancelled"].includes(po.status))
      throw new ConflictError(`Cannot cancel a '${po.status}' PO`);
    const updated = await repo.setPoStatus({
      client,
      brand,
      id,
      status: "cancelled",
      extra: {
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || null,
      },
    });
    await repo.addPoHistory({
      client,
      brand,
      h: {
        po_id: id,
        from_status: po.status,
        to_status: "cancelled",
        changed_by: user?.user_id,
        notes: reason,
      },
    });
    await A(
      brand,
      user?.user_id,
      "purchasing.po.cancel",
      PO_TABLE,
      id,
      { reason },
      request_id,
    );
    return updated;
  });
}

/** Render a purchase order to PDF and persist it via Documents (§6.8 / 4.2). */
async function poPdf({ brand, user, id }) {
  const po = await getPo({ brand, id });
  const { purchaseOrderHtml } = require("../../services/pdf.templates");
  return pdf.renderAndStore({
    brand,
    user_id: user ? user.user_id : null,
    html: purchaseOrderHtml({ brand, po }),
    title: `Purchase Order ${po.po_number || po.po_id || id}`,
    document_type: "purchase_order",
    reference_type: "purchase_order",
    reference_id: po.po_id || id,
  });
}

module.exports = {
  createSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
  addSupplierContact,
  listSupplierContacts,
  removeSupplierContact,
  addSupplierProduct,
  listSupplierProducts,
  updateSupplierProduct,
  removeSupplierProduct,
  createRfq,
  getRfq,
  listRfqs,
  sendRfq,
  recordQuote,
  awardQuote,
  createPo,
  getPo,
  poPdf,
  listPos,
  submitPo,
  approvePo,
  advancePo,
  cancelPo,
};
