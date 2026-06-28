/**
 * Storefront sitemap.xml — PUBLIC (no auth).
 * Served by the backend (it has DB + host→brand) rather than the SSR app, since
 * this TanStack Start version has no server-route API. Mounted at /sitemap.xml;
 * nginx routes `location = /sitemap.xml` on each brand host to the backend.
 * Brand resolves from the host (hostBrandResolverMiddleware sets req.brand).
 */

"use strict";

const express = require("express");
const service = require("./storefront.service");
const { VALID_BRANDS } = require("../../config/brands");

const router = express.Router();

function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]),
  );

router.get("/", async (req, res, next) => {
  try {
    const brand = brandHint(req);
    const host = req.headers["x-forwarded-host"] || req.headers.host || "";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const base = host ? `${proto}://${host}` : "";

    const [productsRes, shades, collections] = await Promise.all([
      service.listProducts({ brand, page: 1, page_size: 1000 }).catch(() => ({
        data: [],
      })),
      service.listShades({ brand }).catch(() => []),
      service.listCollections({ brand }).catch(() => []),
    ]);
    const products = productsRes.data || [];

    const paths = [
      "",
      "/shop",
      "/shades",
      "/bundles",
      "/collections",
      "/about",
      "/contact",
      "/journal",
      ...products.map((p) => `/product/${p.slug}`),
      ...shades.map((s) => `/shades/${s.slug}`),
      ...collections.map((c) => `/collections/${c.slug}`),
    ];

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      paths
        .map((p) => `  <url><loc>${xmlEscape(base + p)}</loc></url>`)
        .join("\n") +
      `\n</urlset>\n`;

    res.type("application/xml").send(xml);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
