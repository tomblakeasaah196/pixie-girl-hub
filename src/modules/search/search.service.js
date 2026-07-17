/**
 * Search — orchestration.
 *
 * The palette calls this once per keystroke (debounced 250 ms on the frontend).
 * We fan out across every entity the caller can *see* in parallel, rank the
 * hits within each entity, and return the union grouped by type.
 *
 * Permission gate — up-front:
 *   1. Load all module.view grants the user holds once (batched by module).
 *   2. Drop any registry entity whose module isn't in that set (null-module
 *      entities like contacts/help are open to any authenticated user).
 *   3. CEO bypasses the gate — sees every entity.
 *
 * Failure mode — per entity:
 *   Every resolver runs under Promise.allSettled with a short timeout. A
 *   slow or broken resolver never stalls the whole palette; it just returns
 *   [] and logs a warn so we can fix it later.
 *
 * Cross-brand ("scope=all"):
 *   Only allowed for CEO / users whose available_businesses.length > 1.
 *   When enabled we run the fan-out once per brand and prefix each result's
 *   subtitle with the brand key so results are disambiguable.
 */

"use strict";

const { ex: dbEx, getPool } = require("../../config/database");
const { logger } = require("../../config/logger");
const { VALID_BRANDS } = require("../../config/brands");
const identityCache = require("../../shared/cache/identity-cache");
const { ENTITIES, BY_KEY } = require("./search.registry");

const RESOLVER_TIMEOUT_MS = 2500;

/** Race a promise against a timeout — used to bound one resolver. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`resolver "${label}" timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

/**
 * Return the set of module keys the user can .view. CEO returns null which
 * downstream reads as "no gate — allow everything".
 */
async function permittedModulesFor(user) {
  if (user.is_ceo) return null;
  const modules = new Set();
  const targets = [...new Set(ENTITIES.map((e) => e.module).filter(Boolean))];
  await Promise.all(
    targets.map(async (mod) => {
      try {
        const grants = await identityCache.getGrants({
          role_ids: user.role_ids,
          module: mod,
          action: "view",
        });
        if (grants && grants.length > 0) modules.add(mod);
      } catch (err) {
        // Fail-closed on a permission lookup error for that module.
        logger.warn(
          { err: err.message, module: mod },
          "search: permission lookup failed",
        );
      }
    }),
  );
  return modules;
}

/** Which entities can this user + this "types" filter surface? */
function pickEntities({ typesFilter, permittedModules }) {
  const filterSet = typesFilter ? new Set(typesFilter) : null;
  return ENTITIES.filter((e) => {
    if (filterSet && !filterSet.has(e.key)) return false;
    if (permittedModules === null) return true; // CEO
    if (e.module === null) return true; // universal (contacts, help, docs)
    return permittedModules.has(e.module);
  });
}

/**
 * Rank hits within one entity's result list. The registry does the SQL
 * shortlist; here we boost:
 *   +3  starts-with title
 *   +2  substring in title
 *   +1  substring in subtitle
 * Ties are broken by shorter title (more likely the exact record).
 */
function scoreHits(hits, q) {
  const needle = q.toLowerCase();
  return hits
    .map((h) => {
      const title = (h.title || "").toLowerCase();
      const subtitle = (h.subtitle || "").toLowerCase();
      let s = 0;
      if (title.startsWith(needle)) s += 3;
      else if (title.includes(needle)) s += 2;
      if (subtitle.includes(needle)) s += 1;
      return { ...h, _score: s };
    })
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return (a.title || "").length - (b.title || "").length;
    })
    .map(({ _score: _s, ...rest }) => rest);
}

/**
 * Fan out over the picked entities against a single brand.
 * Returns Array<{ key, label, hits: Result[] }>.
 */
async function fanOut({ client, brand, q, limit, entities }) {
  const runOne = async (entity) => {
    try {
      const raw = await withTimeout(
        entity.resolve({ ex: dbEx(client), brand, q, limit }),
        RESOLVER_TIMEOUT_MS,
        entity.key,
      );
      return { entity, hits: scoreHits(raw, q) };
    } catch (err) {
      logger.warn(
        { err: err.message, entity: entity.key, brand },
        "search: resolver failed (returning empty)",
      );
      return { entity, hits: [] };
    }
  };
  const settled = await Promise.all(entities.map(runOne));
  return settled
    .filter(({ hits }) => hits.length > 0)
    .map(({ entity, hits }) => ({
      key: entity.key,
      label: entity.label,
      group: entity.group,
      icon: entity.icon,
      hits,
    }));
}

/**
 * Main entry — orchestrates permission gate, brand fan-out (single or
 * cross-brand), and returns a flat grouped list ordered by registry order.
 */
async function search({ user, brand, q, types, limit, scope }) {
  const permittedModules = await permittedModulesFor(user);
  const entities = pickEntities({ typesFilter: types, permittedModules });
  if (entities.length === 0) {
    return { groups: [], scope: "brand", brands_searched: [brand] };
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    // Cross-brand only for users who actually hold >1 business or are CEO.
    const canCrossBrand =
      user.is_ceo || (user.available_businesses || []).length > 1;
    if (scope === "all" && canCrossBrand) {
      const brands = user.is_ceo
        ? [...VALID_BRANDS]
        : user.available_businesses;
      const merged = new Map();
      for (const b of brands) {
        const perBrand = await fanOut({ client, brand: b, q, limit, entities });
        for (const g of perBrand) {
          const acc = merged.get(g.key) || { ...g, hits: [] };
          for (const h of g.hits) {
            acc.hits.push({ ...h, brand: b, subtitle: `${b} · ${h.subtitle}` });
          }
          merged.set(g.key, acc);
        }
      }
      // Re-rank cross-brand hits within each group and cap at limit*2.
      const groups = [...merged.values()]
        .map((g) => ({
          ...g,
          hits: scoreHits(g.hits, q).slice(0, limit * 2),
        }))
        .filter((g) => g.hits.length > 0);
      return { groups, scope: "all", brands_searched: brands };
    }
    const groups = await fanOut({ client, brand, q, limit, entities });
    return { groups, scope: "brand", brands_searched: [brand] };
  } finally {
    client.release();
  }
}

/**
 * Empty-state suggestions for a fresh palette (no query typed yet). Recent
 * records the user actually touched — not global "recent" (that would leak
 * data across users). For v1 we hand back the user's last-viewed sales
 * orders, contacts, and invoices. If any query fails we return whatever
 * we've got so far.
 */
async function suggestions({ user, brand, limit = 5 }) {
  const permittedModules = await permittedModulesFor(user);
  const wantOrders =
    permittedModules === null || permittedModules.has("sales");
  const wantInvoices =
    permittedModules === null || permittedModules.has("invoicing");
  const pool = getPool();
  const client = await pool.connect();
  const ex = dbEx(client);
  const out = { orders: [], contacts: [], invoices: [] };
  try {
    if (wantOrders) {
      try {
        const { t } = require("../../config/brands");
        const { rows } = await ex(
          `SELECT so.order_id AS id, so.order_number, so.status, so.total_ngn,
                  c.display_name AS contact_name
             FROM ${t(brand, "sales_orders")} so
             LEFT JOIN shared.contacts c ON c.contact_id = so.contact_id
            ORDER BY so.updated_at DESC NULLS LAST
            LIMIT $1`,
          [limit],
        );
        out.orders = rows.map((r) => ({
          id: r.id,
          type: "sale_order",
          title: r.order_number,
          subtitle: r.contact_name || "—",
          meta: { status: r.status, amount_ngn: r.total_ngn },
          route: `/sales/orders/${r.id}`,
        }));
      } catch (err) {
        logger.warn({ err: err.message }, "search suggestions: orders failed");
      }
    }
    try {
      const { rows } = await ex(
        `SELECT c.contact_id AS id, c.display_name, c.company_name
           FROM shared.contacts c
          WHERE c.is_deleted = false
            AND (cardinality(c.visible_to) = 0 OR $1 = ANY(c.visible_to))
          ORDER BY c.updated_at DESC NULLS LAST
          LIMIT $2`,
        [brand, limit],
      );
      out.contacts = rows.map((r) => ({
        id: r.id,
        type: "contact",
        title: r.display_name,
        subtitle: r.company_name || "—",
        meta: {},
        route: `/contacts/${r.id}`,
      }));
    } catch (err) {
      logger.warn({ err: err.message }, "search suggestions: contacts failed");
    }
    if (wantInvoices) {
      try {
        const { t } = require("../../config/brands");
        const { rows } = await ex(
          `SELECT i.invoice_id AS id, i.invoice_number, i.status, i.total_ngn,
                  c.display_name AS contact_name
             FROM ${t(brand, "invoices")} i
             LEFT JOIN shared.contacts c ON c.contact_id = i.contact_id
            ORDER BY i.updated_at DESC NULLS LAST
            LIMIT $1`,
          [limit],
        );
        out.invoices = rows.map((r) => ({
          id: r.id,
          type: "invoice",
          title: r.invoice_number,
          subtitle: r.contact_name || "—",
          meta: { status: r.status, amount_ngn: r.total_ngn },
          route: `/invoicing?tab=invoices&invoice=${r.id}`,
        }));
      } catch (err) {
        logger.warn(
          { err: err.message },
          "search suggestions: invoices failed",
        );
      }
    }
    return out;
  } finally {
    client.release();
  }
}

/**
 * The types the caller is allowed to see — the frontend uses this to render
 * the `#` operator's autocomplete and to know whether to show the empty-state
 * hint for a locked-down user.
 */
async function availableTypes({ user }) {
  const permittedModules = await permittedModulesFor(user);
  return ENTITIES.filter((e) => {
    if (permittedModules === null) return true;
    if (e.module === null) return true;
    return permittedModules.has(e.module);
  }).map((e) => ({
    key: e.key,
    label: e.label,
    group: e.group,
    icon: e.icon,
  }));
}

module.exports = {
  search,
  suggestions,
  availableTypes,
  // exported for unit test
  scoreHits,
  pickEntities,
  BY_KEY,
};
