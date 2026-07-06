/**
 * Search — thin HTTP handlers. Contract:
 *
 *   GET /api/v1/search?q=...&types=csv&limit=N&scope=brand|all
 *     → { data: { groups: [{ key, label, hits: [Result] }, ...],
 *                 scope, brands_searched } }
 *
 *   GET /api/v1/search/suggestions
 *     → { data: { orders, contacts, invoices } }
 *
 *   GET /api/v1/search/types
 *     → { data: [{ key, label, group, icon }, ...] }
 *
 * NOTE: no `meta` sibling — the admin `api.get` unwraps `{data}` to the inner
 * value ONLY when `meta` is absent. Adding a bare `meta: {}` here made the
 * client return the wrapper instead of the payload, crashing the palette on
 * open (`suggested.orders.slice(...)` on undefined). The frontend/backend
 * contract for non-paginated singletons is: `{ data: <value> }` — nothing else.
 */

"use strict";

const service = require("./search.service");
const { querySchema } = require("./search.validator");

async function search(req, res) {
  const parsed = querySchema.parse(req.query);
  const result = await service.search({
    user: req.user,
    brand: req.brand,
    q: parsed.q,
    types: parsed.types,
    limit: parsed.limit,
    scope: parsed.scope,
  });
  res.json({ data: result });
}

async function suggestions(req, res) {
  const result = await service.suggestions({
    user: req.user,
    brand: req.brand,
  });
  res.json({ data: result });
}

async function types(req, res) {
  const result = await service.availableTypes({ user: req.user });
  res.json({ data: result });
}

module.exports = { search, suggestions, types };
