/**
 * Search — the registry of searchable entity types.
 *
 * Each entry declares:
 *   key          stable id used by the frontend & the ?types= filter
 *   label        human label shown as the results group header
 *   group        run/operate/finance/people/grow/system (matches modules.ts)
 *   module       permission module (RBAC gate)
 *   action       'view' — required to see any of these records
 *   scoped       'brand' (uses req.brand + brand schema) or 'shared'
 *   resolve      async (deps) => Result[]
 *
 * A resolver returns an array of `Result` objects — see search.service.js for
 * the shape. Resolvers must be **fully parameterised** and permission-safe:
 * downstream filtering by req.permission_scope (all/team/own) belongs here
 * when the target table supports it. If a resolver throws, the fan-out logs
 * a warn and returns [] for that entity — the palette stays useful even if
 * one entity's SQL breaks.
 *
 * Adding a v2 entity = one new entry here. No other backend file changes.
 */

"use strict";

const { t } = require("../../config/brands");

/** Wrap the user's raw query for ILIKE. Escapes SQL wildcards. */
function likeToken(raw) {
  return `%${raw.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}

/** Extract only the entities the caller is allowed to invoke. */
function filterByPermission(entities, permittedModules) {
  return entities.filter(
    (e) => permittedModules.has(e.module) || e.module === null,
  );
}

/**
 * The full v1 catalogue — 16 checked items from the palette scope decision.
 * Order here is the order results are grouped in the response.
 */
const ENTITIES = [
  // ── Run ────────────────────────────────────────────────
  {
    key: "sale_order",
    label: "Sales orders",
    group: "run",
    icon: "ShoppingBag",
    module: "sales",
    action: "view",
    scoped: "brand",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT so.order_id AS id,
                so.order_number,
                so.status,
                so.order_type,
                so.total_ngn,
                c.display_name AS contact_name,
                c.primary_phone AS contact_phone
           FROM ${t(brand, "sales_orders")} so
           LEFT JOIN shared.contacts c ON c.contact_id = so.contact_id
          WHERE so.order_number ILIKE $1
             OR c.display_name  ILIKE $1
             OR c.primary_phone ILIKE $1
             OR c.email         ILIKE $1
          ORDER BY so.created_at DESC
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "sale_order",
        title: r.order_number,
        subtitle: r.contact_name || r.contact_phone || "—",
        meta: {
          status: r.status,
          amount_ngn: r.total_ngn,
          order_type: r.order_type,
        },
        // Order detail lives at /sales/orders/:orderId (see router.tsx). A bare
        // /sales/:id falls through to the not-found placeholder.
        route: `/sales/orders/${r.id}`,
      }));
    },
  },
  {
    key: "crm_deal",
    label: "CRM deals",
    group: "run",
    icon: "Users",
    module: "crm",
    action: "view",
    scoped: "brand",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT d.deal_id AS id,
                d.deal_number,
                d.title,
                d.expected_value_ngn,
                d.status
           FROM ${t(brand, "crm_deals")} d
          WHERE d.is_deleted = false
            AND (d.title ILIKE $1 OR d.deal_number ILIKE $1)
          ORDER BY d.created_at DESC
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "crm_deal",
        title: r.title || r.deal_number,
        subtitle: r.deal_number,
        meta: { amount_ngn: r.expected_value_ngn, status: r.status },
        route: `/crm/deals/${r.id}`,
      }));
    },
  },
  {
    key: "smartcomm_thread",
    label: "Conversations",
    group: "people",
    icon: "MessageSquare",
    module: "smartcomm",
    action: "view",
    scoped: "shared",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT ch.channel_id AS id,
                ch.channel_type,
                ch.display_name,
                ch.external_thread_ref,
                ch.last_message_at
           FROM shared.message_channels ch
          WHERE ch.business = $1
            AND (ch.display_name ILIKE $2 OR ch.external_thread_ref ILIKE $2)
          ORDER BY ch.last_message_at DESC NULLS LAST
          LIMIT $3`,
        [brand, like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "smartcomm_thread",
        title: r.display_name || r.external_thread_ref || "Conversation",
        subtitle: r.channel_type,
        meta: { last_message_at: r.last_message_at },
        // The Messaging workstation selects a channel via ?channel=, not a
        // path segment (/smartcomm/:id doesn't exist).
        route: `/smartcomm?channel=${r.id}`,
      }));
    },
  },

  // ── Operate ────────────────────────────────────────────
  {
    key: "product",
    label: "Products",
    group: "operate",
    icon: "Package",
    module: "catalogue",
    action: "view",
    scoped: "brand",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      // SKU lives on product_variants — join to surface a SKU hit as its
      // parent product. product_code is the human-visible product-level id.
      const { rows } = await ex(
        `SELECT DISTINCT ON (p.product_id)
                p.product_id AS id,
                p.name,
                p.product_code,
                p.is_visible_storefront,
                v.sku AS matched_sku
           FROM ${t(brand, "products")} p
           LEFT JOIN ${t(brand, "product_variants")} v
             ON v.product_id = p.product_id AND v.sku ILIKE $1
          WHERE p.is_deleted = false
            AND (p.name         ILIKE $1
                 OR p.product_code ILIKE $1
                 OR v.sku         ILIKE $1)
          ORDER BY p.product_id, p.updated_at DESC
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "product",
        title: r.name,
        subtitle: r.matched_sku
          ? `SKU ${r.matched_sku}`
          : r.product_code || "—",
        meta: { visible: r.is_visible_storefront },
        // Products are base (stock-bearing) records — their detail page is
        // /catalogue/base/:id. There is no /catalogue/:id route.
        route: `/catalogue/base/${r.id}`,
      }));
    },
  },
  {
    key: "stock_variant",
    label: "Stock (SKU)",
    group: "operate",
    icon: "Boxes",
    module: "stock",
    action: "view",
    scoped: "brand",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT v.variant_id AS id,
                v.sku,
                v.variant_label,
                v.product_id,
                p.name AS product_name
           FROM ${t(brand, "product_variants")} v
           JOIN ${t(brand, "products")} p ON p.product_id = v.product_id
          WHERE COALESCE(v.is_deleted, false) = false
            AND (v.sku ILIKE $1 OR v.variant_label ILIKE $1 OR p.name ILIKE $1)
          ORDER BY p.name ASC
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "stock_variant",
        title: r.sku || r.variant_label || r.product_name,
        subtitle: r.product_name,
        meta: { variant_label: r.variant_label },
        // A SKU belongs to a base product; its detail page shows the variant
        // and its live stock. (The Stock module has no per-SKU deep-link.)
        route: `/catalogue/base/${r.product_id}`,
      }));
    },
  },
  {
    key: "delivery",
    label: "Deliveries",
    group: "operate",
    icon: "Truck",
    module: "logistics",
    action: "view",
    scoped: "brand",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT d.delivery_id AS id,
                d.delivery_number,
                d.courier_tracking_ref,
                d.status,
                so.order_number,
                c.display_name AS contact_name
           FROM ${t(brand, "deliveries")} d
           LEFT JOIN ${t(brand, "sales_orders")} so ON so.order_id = d.order_id
           LEFT JOIN shared.contacts c ON c.contact_id = so.contact_id
          WHERE d.delivery_number      ILIKE $1
             OR d.courier_tracking_ref ILIKE $1
             OR so.order_number        ILIKE $1
             OR c.display_name         ILIKE $1
          ORDER BY d.created_at DESC
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "delivery",
        title: r.delivery_number || r.courier_tracking_ref || "Delivery",
        subtitle: [r.order_number, r.contact_name].filter(Boolean).join(" · "),
        meta: { status: r.status, tracking: r.courier_tracking_ref },
        // Logistics opens delivery detail from an in-page drawer (no URL id);
        // land on the "All" tab where the delivery is listed.
        route: `/logistics?tab=all`,
      }));
    },
  },

  // ── Finance ────────────────────────────────────────────
  {
    key: "invoice",
    label: "Invoices",
    group: "finance",
    icon: "FileText",
    module: "invoicing",
    action: "view",
    scoped: "brand",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT i.invoice_id AS id,
                i.invoice_number,
                i.status,
                i.total_ngn,
                i.amount_paid_ngn,
                c.display_name AS contact_name
           FROM ${t(brand, "invoices")} i
           LEFT JOIN shared.contacts c ON c.contact_id = i.contact_id
          WHERE i.invoice_number ILIKE $1
             OR c.display_name   ILIKE $1
          ORDER BY i.created_at DESC
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "invoice",
        title: r.invoice_number,
        subtitle: r.contact_name || "—",
        meta: {
          status: r.status,
          amount_ngn: r.total_ngn,
          paid_ngn: r.amount_paid_ngn,
        },
        // Invoicing has no /invoicing/:id route — the Invoices tab opens a
        // detail drawer keyed off ?invoice=. Deep-link straight to it.
        route: `/invoicing?tab=invoices&invoice=${r.id}`,
      }));
    },
  },
  {
    key: "payment",
    label: "Payments",
    group: "finance",
    icon: "Wallet",
    module: "sales",
    action: "view",
    scoped: "brand",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT p.payment_id AS id,
                p.payment_number,
                p.method,
                p.provider_reference,
                p.amount_ngn,
                p.order_id,
                so.order_number,
                c.display_name AS contact_name
           FROM ${t(brand, "sales_order_payments")} p
           LEFT JOIN ${t(brand, "sales_orders")} so ON so.order_id = p.order_id
           LEFT JOIN shared.contacts c ON c.contact_id = so.contact_id
          WHERE p.payment_number      ILIKE $1
             OR p.provider_reference  ILIKE $1
             OR so.order_number       ILIKE $1
             OR c.display_name        ILIKE $1
          ORDER BY p.created_at DESC
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "payment",
        title: r.payment_number || r.provider_reference || "Payment",
        subtitle: [r.order_number, r.contact_name].filter(Boolean).join(" · "),
        meta: { amount_ngn: r.amount_ngn, method: r.method },
        // Payments open on their parent order's detail page.
        route: `/sales/orders/${r.order_id}`,
      }));
    },
  },
  {
    key: "expense",
    label: "Expenses",
    group: "finance",
    icon: "Receipt",
    module: "expenses",
    action: "view",
    scoped: "brand",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      // Claimant is stored as submitted_by (users.user_id). Join to
      // staff_profiles → contacts to get a display name.
      const { rows } = await ex(
        `SELECT e.expense_id AS id,
                e.expense_number,
                e.title,
                e.status,
                e.total_amount_ngn,
                c.display_name AS claimant_name
           FROM ${t(brand, "expenses")} e
           LEFT JOIN shared.users u           ON u.user_id = e.submitted_by
           LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
           LEFT JOIN shared.contacts c        ON c.contact_id = sp.contact_id
          WHERE e.expense_number ILIKE $1
             OR e.title          ILIKE $1
             OR c.display_name   ILIKE $1
          ORDER BY e.created_at DESC
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "expense",
        title: r.title || r.expense_number,
        subtitle: [r.expense_number, r.claimant_name]
          .filter(Boolean)
          .join(" · "),
        meta: { status: r.status, amount_ngn: r.total_amount_ngn },
        // Expenses open in an in-page drawer (no URL id) — land on the list.
        route: `/expenses`,
      }));
    },
  },
  {
    key: "cash_request",
    label: "Cash requests",
    group: "finance",
    icon: "Wallet",
    module: "cash_request",
    action: "view",
    scoped: "shared",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      // Submitter is a user; join through staff_profiles → contacts for a name.
      const { rows } = await ex(
        `SELECT cr.cash_request_id AS id,
                cr.request_number,
                cr.purpose,
                cr.status,
                cr.amount_requested_ngn,
                c.display_name AS requestor_name
           FROM shared.cash_requests cr
           LEFT JOIN shared.users u           ON u.user_id = cr.submitted_by
           LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
           LEFT JOIN shared.contacts c        ON c.contact_id = sp.contact_id
          WHERE cr.business = $1
            AND (cr.request_number ILIKE $2
                 OR cr.purpose      ILIKE $2
                 OR c.display_name  ILIKE $2)
          ORDER BY cr.submitted_at DESC
          LIMIT $3`,
        [brand, like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "cash_request",
        title: r.purpose || r.request_number,
        subtitle: [r.request_number, r.requestor_name]
          .filter(Boolean)
          .join(" · "),
        meta: { status: r.status, amount_ngn: r.amount_requested_ngn },
        // Cash requests open in an in-page drawer (no URL id) — land on the list.
        route: `/cash-requests`,
      }));
    },
  },

  // ── People ─────────────────────────────────────────────
  {
    key: "contact",
    label: "Contacts",
    group: "people",
    icon: "Contact",
    // Contacts are shared and not module-gated in the classic sense; anyone
    // with an authenticated session inside the brand can search them.
    module: null,
    action: "view",
    scoped: "shared",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      // contacts.visible_to is a per-brand allowlist; an empty array means
      // "visible to every brand" (schema convention on this table).
      const { rows } = await ex(
        `SELECT c.contact_id AS id,
                c.display_name,
                c.company_name,
                c.primary_phone,
                c.email,
                c.contact_type
           FROM shared.contacts c
          WHERE c.is_deleted = false
            AND (cardinality(c.visible_to) = 0 OR $1 = ANY(c.visible_to))
            AND (c.display_name  ILIKE $2
                 OR c.company_name ILIKE $2
                 OR c.primary_phone ILIKE $2
                 OR c.email         ILIKE $2)
          ORDER BY c.updated_at DESC NULLS LAST
          LIMIT $3`,
        [brand, like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "contact",
        title: r.display_name,
        subtitle: r.company_name || r.primary_phone || r.email || "—",
        meta: { contact_type: r.contact_type },
        route: `/contacts/${r.id}`,
      }));
    },
  },
  {
    key: "employee",
    label: "Employees",
    group: "people",
    icon: "UserCog",
    // RBAC key must match the access catalog (src/shared/access/access.catalog.js):
    // it is "hr_payroll", not "hr" — the old value failed closed and hid
    // employees from every non-CEO user.
    module: "hr_payroll",
    action: "view",
    scoped: "shared",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT sp.profile_id AS id,
                sp.employee_number,
                sp.job_title,
                sp.contact_id,
                c.display_name,
                c.primary_phone
           FROM shared.staff_profiles sp
           LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
          WHERE sp.business = $1
            AND (c.display_name    ILIKE $2
                 OR sp.employee_number ILIKE $2
                 OR sp.job_title    ILIKE $2)
          ORDER BY c.display_name ASC NULLS LAST
          LIMIT $3`,
        [brand, like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "employee",
        title: r.display_name || r.employee_number,
        subtitle: [r.job_title, r.employee_number].filter(Boolean).join(" · "),
        meta: { phone: r.primary_phone },
        // Employee 360 lives at /hr/employees/:profileId (see router.tsx).
        route: `/hr/employees/${r.id}`,
      }));
    },
  },

  // ── Grow ───────────────────────────────────────────────
  {
    key: "sales_campaign",
    label: "Sales campaigns",
    group: "grow",
    icon: "Megaphone",
    module: "sales_campaigns",
    action: "view",
    scoped: "brand",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT sc.campaign_id AS id,
                sc.name,
                sc.slug,
                sc.status,
                sc.starts_at,
                sc.ends_at
           FROM ${t(brand, "sales_campaigns")} sc
          WHERE sc.name ILIKE $1
             OR sc.slug ILIKE $1
          ORDER BY sc.created_at DESC
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "sales_campaign",
        title: r.name,
        subtitle: r.slug,
        meta: {
          status: r.status,
          starts_at: r.starts_at,
          ends_at: r.ends_at,
        },
        route: `/sales-campaigns/${r.id}`,
      }));
    },
  },

  // ── System ─────────────────────────────────────────────
  {
    key: "help_article",
    label: "Help articles",
    group: "system",
    icon: "HelpCircle",
    module: null, // help center is universally accessible
    action: "view",
    scoped: "shared",
    async resolve({ ex, brand: _brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT a.article_id AS id,
                a.slug,
                a.title,
                a.summary
           FROM shared.help_articles a
          WHERE a.is_active = true
            AND (a.title ILIKE $1 OR a.summary ILIKE $1)
          ORDER BY a.updated_at DESC NULLS LAST
          LIMIT $2`,
        [like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "help_article",
        title: r.title,
        subtitle: r.summary,
        meta: {},
        route: `/help/${r.slug || r.id}`,
      }));
    },
  },
  {
    key: "document",
    label: "Documents",
    group: "system",
    icon: "FolderArchive",
    module: null, // documents are role-scoped; the row check happens in-repo
    action: "view",
    scoped: "shared",
    async resolve({ ex, brand, q, limit }) {
      const like = likeToken(q);
      const { rows } = await ex(
        `SELECT d.document_id AS id,
                d.title,
                d.document_number,
                d.document_type,
                d.file_size_bytes
           FROM shared.documents d
          WHERE d.business = $1
            AND d.is_deleted = false
            AND (d.title           ILIKE $2
                 OR d.document_number ILIKE $2)
          ORDER BY d.created_at DESC
          LIMIT $3`,
        [brand, like, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        type: "document",
        title: r.title || r.document_number,
        subtitle: r.document_type,
        meta: { file_size_bytes: r.file_size_bytes },
        // Documents open in an in-page preview (no URL id) — land on the Vault.
        route: `/documents`,
      }));
    },
  },
];

const BY_KEY = Object.fromEntries(ENTITIES.map((e) => [e.key, e]));

module.exports = { ENTITIES, BY_KEY, filterByPermission, likeToken };
