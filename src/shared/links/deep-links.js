/**
 * Deep links — the ONE place that knows where a record lives in the admin UI.
 *
 * WHY THIS EXISTS: every module raises notifications and tasks that carry
 * `reference_type` + `reference_id`, but almost none of them carried a link.
 * An approver got "Approve stock write-off FLH-ADJ-0007" and had to go and
 * find it: which module, which tab, which row. The approval then sat there
 * while the task stayed open, because nothing tied the decision back to it.
 *
 * A link belongs with the reference, not with the sender. Every notify() and
 * every task now resolves its link HERE, so:
 *   - one route change updates every notification and task that points at it;
 *   - a module that forgets to pass a link still gets one;
 *   - the same reference always lands on the same screen, whoever raised it.
 *
 * The `?<param>=<id>` convention is the house pattern already used by
 * `/service-jobs?tab=board&job=<id>`: the page reads the param, opens that
 * record, and clears it from the URL (see useDeepLinkedRecord on the client).
 *
 * Adding a reference type: add it here and nowhere else. If a type is
 * unknown, callers get null and fall back to their own link (or none) —
 * never a broken route.
 */

"use strict";

/**
 * reference_type → (id) => route.
 *
 * Keys are the `reference_type` values modules already write on tasks,
 * notifications and workflow instances — including the plural table names the
 * workflow engine stores in `reference_table`, so an instance resolves too.
 */
const ROUTES = {
  // ── Approvals that route through a queue ──
  stock_adjustment: (id) => `/stock?tab=adjustments&adjustment=${id}`,
  stock_adjustments: (id) => `/stock?tab=adjustments&adjustment=${id}`,
  cash_request: (id) => `/cash-requests?tab=approval-queue&request=${id}`,
  cash_requests: (id) => `/cash-requests?tab=approval-queue&request=${id}`,
  expense: (id) => `/expenses?expense=${id}`,
  expenses: (id) => `/expenses?expense=${id}`,
  purchase_order: (id) => `/purchasing?order=${id}`,
  purchase_orders: (id) => `/purchasing?order=${id}`,
  price_change: (id) => `/pricing?change=${id}`,
  intercompany_transaction: (id) => `/intercompany?transaction=${id}`,
  sales_campaign: (id) => `/sales-campaigns/${id}`,

  // ── Records people get pointed at for reasons other than approval ──
  sales_order: (id) => `/sales/orders/${id}`,
  service_job: (id) => `/service-jobs?tab=board&job=${id}`,
  service_jobs: (id) => `/service-jobs?tab=board&job=${id}`,
  stock_transfer: (id) => `/stock?tab=transfers&transfer=${id}`,
  stock_movement: (id) => `/stock?tab=movements&movement=${id}`,
  inbound_shipment: (id) => `/stock?tab=receive&shipment=${id}`,
  stock_alert: () => `/stock?tab=alerts`,
  invoice: (id) => `/invoicing?invoice=${id}`,
  contact: (id) => `/crm/clients/${id}`,
  crm_deal: (id) => `/crm/deals/${id}`,
  task: (id) => `/workspace?tab=tasks&task=${id}`,
  goal: (id) => `/workspace?tab=goals&goal=${id}`,
  social_post: (id) => `/social?tab=board&post=${id}`,

  // The generic approval instance — used when a workflow has no better home.
  workflow_instance: (id) => `/org-workflow?tab=approvals&instance=${id}`,
  workflow_instances: (id) => `/org-workflow?tab=approvals&instance=${id}`,
};

/** Human label for a reference type, for notification/task copy. */
const LABELS = {
  stock_adjustment: "stock adjustment",
  cash_request: "cash request",
  expense: "expense",
  purchase_order: "purchase order",
  price_change: "price change",
  intercompany_transaction: "intercompany transaction",
  sales_campaign: "campaign",
  workflow_instance: "approval",
};

/**
 * Route for a record, or null when the type has no home yet.
 * Never throws — a bad link must not break the write that carries it.
 */
function deepLinkFor(reference_type, reference_id) {
  if (!reference_type) return null;
  const build = ROUTES[String(reference_type).toLowerCase()];
  if (!build) return null;
  try {
    const route = build(reference_id);
    // A route needing an id but given none would render "/stock?...=undefined".
    return route && !route.includes("undefined") && !route.includes("null")
      ? route
      : null;
  } catch {
    return null;
  }
}

/** "stock adjustment" / "cash request" — falls back to the raw type. */
function labelFor(reference_type) {
  if (!reference_type) return "record";
  const key = String(reference_type).toLowerCase();
  return LABELS[key] || key.replace(/_/g, " ");
}

/** True when this reference type has a screen to open. */
function hasDeepLink(reference_type) {
  return Boolean(
    reference_type && ROUTES[String(reference_type).toLowerCase()],
  );
}

module.exports = { deepLinkFor, labelFor, hasDeepLink, ROUTES, LABELS };
