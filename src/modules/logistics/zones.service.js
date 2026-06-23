/**
 * Delivery zones — business logic + geometry.
 *
 * A point (lng/lat) resolves to a delivery fee by finding the highest-priority
 * active zone that contains it (point-in-polygon for polygons, haversine for
 * radius zones). No PostGIS — the maths lives here.
 */

"use strict";

const repo = require("./zones.repo");
const { audit } = require("../../middleware/audit");
const { NotFoundError, AppError } = require("../../utils/errors");

// ── Rate card helpers ──────────────────────────────────────

/**
 * Compute the delivery fee for a given wig quantity from a zone's rate_card.
 * Falls back to fee_ngn (zone flat rate) when rate_card has no tiers.
 *
 * rate_card shape:
 *   { tiers: [{ label, min_qty, max_qty, fee_ngn }], add_on_per_2_ngn }
 * For qty > last tier's max_qty:
 *   fee = last_tier.fee_ngn + ceil((qty - last_max) / 2) * add_on_per_2_ngn
 */
function computeFeeForQty(zone, qty) {
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const rc = zone.rate_card;
  const tiers = rc && Array.isArray(rc.tiers) ? rc.tiers : [];
  if (!tiers.length) return Number(zone.fee_ngn) || 0;

  for (const tier of tiers) {
    if (n >= tier.min_qty && (tier.max_qty == null || n <= tier.max_qty)) {
      return Number(tier.fee_ngn);
    }
  }
  // Beyond the last defined tier — apply progressive add-on.
  const last = tiers[tiers.length - 1];
  const addOn = Number(rc.add_on_per_2_ngn) || 0;
  const extraGroups = Math.ceil((n - (last.max_qty || n)) / 2);
  return Number(last.fee_ngn) + extraGroups * addOn;
}

// ── Geometry helpers ───────────────────────────────────────

/** Ray-casting point-in-polygon. `points` are [lng,lat] pairs. */
function pointInPolygon(lng, lat, points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function zoneContains(zone, lat, lng, country) {
  // Whole-country zone: match by country, no coordinates needed.
  if (zone.geometry_type === "country") {
    return (
      !!country &&
      !!zone.country_code &&
      String(country).toUpperCase() === String(zone.country_code).toUpperCase()
    );
  }
  // Coordinate zones need a valid point.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const g = zone.geometry || {};
  if (zone.geometry_type === "polygon") {
    return pointInPolygon(lng, lat, g.points || []);
  }
  if (zone.geometry_type === "radius") {
    const c = g.center || [];
    if (c.length < 2 || !(g.radius_km > 0)) return false;
    return haversineKm(lat, lng, c[1], c[0]) <= g.radius_km;
  }
  return false;
}

// ── CRUD ───────────────────────────────────────────────────

const list = ({ brand }) => repo.list({ brand });

async function getById({ brand, id }) {
  const z = await repo.getById({ brand, id });
  if (!z) throw new NotFoundError("Delivery zone");
  return z;
}

function validateGeometry(input) {
  if (input.geometry_type === "country") return; // matched by country_code
  const g = input.geometry || {};
  if (input.geometry_type === "polygon") {
    if (!Array.isArray(g.points) || g.points.length < 3)
      throw new AppError(
        "INVALID_GEOMETRY",
        "A polygon zone needs at least 3 [lng,lat] points",
        422,
      );
  } else if (input.geometry_type === "radius") {
    if (!Array.isArray(g.center) || g.center.length < 2 || !(g.radius_km > 0))
      throw new AppError(
        "INVALID_GEOMETRY",
        "A radius zone needs a [lng,lat] center and a positive radius_km",
        422,
      );
  }
}

async function create({ brand, user, request_id, input }) {
  validateGeometry(input);
  if (input.geometry_type === "country" && !input.country_code)
    throw new AppError(
      "COUNTRY_REQUIRED",
      "A country zone needs a country_code",
      422,
    );
  const zone = await repo.create({
    brand,
    z: { ...input, geometry: input.geometry || {} },
    user_id: user ? user.user_id : null,
  });
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "logistics.zone.create",
    target_type: "delivery_zone",
    target_id: zone.zone_id,
    after: { name: zone.name, fee_ngn: zone.fee_ngn },
    request_id,
  });
  return zone;
}

async function update({ brand, user, request_id, id, patch }) {
  if (patch.geometry_type || patch.geometry) {
    validateGeometry({
      geometry_type: patch.geometry_type,
      geometry: patch.geometry,
    });
  }
  const zone = await repo.update({ brand, id, patch });
  if (!zone) throw new NotFoundError("Delivery zone");
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "logistics.zone.update",
    target_type: "delivery_zone",
    target_id: id,
    request_id,
  });
  return zone;
}

async function remove({ brand, user, request_id, id }) {
  const ok = await repo.remove({ brand, id });
  if (!ok) throw new NotFoundError("Delivery zone");
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "logistics.zone.delete",
    target_type: "delivery_zone",
    target_id: id,
    request_id,
  });
}

/**
 * Resolve the delivery fee for a coordinate or country code.
 * Pass `qty` (wig count) to get the tier-appropriate fee; omit for the base
 * (1-2 wigs) rate. Returns the matching zone's fee + full rate card so the
 * storefront can display all tiers and auto-select based on basket size.
 */
async function quote({ brand, lat, lng, country_code, qty }) {
  const la = Number(lat);
  const ln = Number(lng);
  const hasPoint = Number.isFinite(la) && Number.isFinite(ln);
  if (!hasPoint && !country_code)
    throw new AppError(
      "INVALID_QUOTE",
      "Provide coordinates (lat/lng) or a country_code",
      422,
    );
  // Highest priority first; a local coordinate zone should out-rank the
  // whole-country fallback (set its priority higher).
  const zones = await repo.listActive({ brand, country_code });
  for (const z of zones) {
    if (zoneContains(z, la, ln, country_code)) {
      const fee = qty != null ? computeFeeForQty(z, qty) : Number(z.fee_ngn);
      return {
        zone_id: z.zone_id,
        zone_name: z.name,
        country_code: z.country_code || null,
        geometry_type: z.geometry_type,
        courier_key: z.courier_key || null,
        fee_ngn: fee,
        rate_card: z.rate_card || { tiers: [] },
        currency: "NGN",
      };
    }
  }
  return {
    zone_id: null,
    zone_name: null,
    country_code: null,
    courier_key: null,
    fee_ngn: null,
    rate_card: null,
    currency: "NGN",
  };
}

/**
 * Public-facing rate card: active zones grouped into whole-country flat fees
 * and local (geofenced) zones. Powers the storefront "shipping rates" table.
 * No coordinates leaked — just names, country codes and NGN fees.
 */
async function shippingRates({ brand }) {
  const all = await repo.list({ brand });
  const active = all.filter((z) => z.is_active);
  const shape = (z) => ({
    zone_id: z.zone_id,
    name: z.name,
    country_code: z.country_code || null,
    courier_key: z.courier_key || null,
    fee_ngn: z.fee_ngn === null ? null : Number(z.fee_ngn),
    rate_card: z.rate_card || { tiers: [] },
    priority: Number(z.priority) || 0,
  });
  return {
    countries: active
      .filter((z) => z.geometry_type === "country")
      .map(shape)
      .sort((a, b) => a.name.localeCompare(b.name)),
    local: active
      .filter((z) => z.geometry_type !== "country")
      .map((z) => ({ ...shape(z), geometry_type: z.geometry_type }))
      .sort((a, b) => b.priority - a.priority),
    currency: "NGN",
  };
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  quote,
  shippingRates,
  zoneContains,
  computeFeeForQty,
};
