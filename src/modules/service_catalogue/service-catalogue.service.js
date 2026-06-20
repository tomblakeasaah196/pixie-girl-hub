/**
 * Service Catalogue — business logic. Admin CRUD, the public storefront
 * (visible/bookable services + booking-request capture), and single-sheet
 * import/export (full create, same shape as the base-product importer).
 */

"use strict";

const repo = require("./service-catalogue.repo");
const {
  buildWorkbook,
  parseWorkbook,
} = require("../../services/spreadsheet.service");
const { audit } = require("../../middleware/audit");
const { NotFoundError } = require("../../utils/errors");

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const toBool = (v) =>
  isBlank(v) ? undefined : /^(y|yes|true|1)$/i.test(String(v).trim());
const toNum = (v) => (isBlank(v) ? undefined : Number(v));
const toArr = (v) =>
  isBlank(v)
    ? undefined
    : String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
const yn = (v) => (v ? "yes" : "no");

const SERVICE_SHEET = "Services";

// One spec drives the template, the export, and the import parse. `parse`
// converts an inbound cell to the field value; `format` renders a stored value
// back to a cell; `list` makes the column a dropdown.
const SERVICE_COLUMNS = [
  { header: "Name*", key: "name", width: 28, parse: (v) => (isBlank(v) ? undefined : String(v).trim()) },
  { header: "Short description", key: "short_description", width: 32 },
  { header: "Long description", key: "long_description", width: 40 },
  { header: "Base price (NGN)", key: "base_price_ngn", width: 16, parse: toNum },
  { header: "Compare-at price", key: "compare_at_price_ngn", width: 16, parse: toNum },
  { header: "Price is 'from'?", key: "price_is_from", width: 14, list: ["yes", "no"], parse: toBool, format: yn },
  { header: "Duration (mins)", key: "duration_minutes", width: 14, parse: toNum },
  { header: "Tags (comma-separated)", key: "tags", width: 24, parse: toArr, format: (v) => (Array.isArray(v) ? v.join(", ") : v) },
  { header: "Image URL", key: "image_url", width: 30 },
  { header: "Sale mode", key: "sale_mode", width: 12, list: ["book", "buy", "enquire"] },
  { header: "Location", key: "location_type", width: 12, list: ["in_studio", "home", "virtual"] },
  { header: "Deposit required?", key: "deposit_required", width: 14, list: ["yes", "no"], parse: toBool, format: yn },
  { header: "Deposit %", key: "deposit_pct", width: 10, parse: toNum },
  { header: "Buffer (mins)", key: "buffer_minutes", width: 12, parse: toNum },
  { header: "Stylist tier", key: "required_stylist_tier", width: 16 },
  { header: "Visible on website?", key: "is_visible_storefront", width: 16, list: ["yes", "no"], parse: toBool, format: yn },
  { header: "Featured?", key: "is_featured", width: 10, list: ["yes", "no"], parse: toBool, format: yn },
  { header: "Meta title", key: "meta_title", width: 24 },
  { header: "Meta description", key: "meta_description", width: 32 },
];

const templateColumns = () =>
  SERVICE_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    list: c.list,
  }));

// ── Admin CRUD ───────────────────────────────────────────
function listServices({ brand, category, active_only }) {
  return repo.listServices({ brand, category, active_only });
}

async function getService({ brand, id }) {
  const s = await repo.getService({ brand, id });
  if (!s) throw new NotFoundError("Service");
  return s;
}

async function createService({ brand, user, request_id, input }) {
  const s = await repo.createService({ brand, user_id: user.user_id, input });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "service_catalogue.create",
    target_type: "service_offering",
    target_id: s.service_id,
    after: { name: s.name, slug: s.slug, price: s.base_price_ngn },
    request_id,
  });
  return s;
}

async function updateService({ brand, user, request_id, id, input }) {
  const s = await repo.updateService({ brand, id, input });
  if (!s) throw new NotFoundError("Service");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "service_catalogue.update",
    target_type: "service_offering",
    target_id: id,
    request_id,
  });
  return s;
}

async function deleteService({ brand, user, request_id, id }) {
  const s = await repo.deleteService({ brand, id });
  if (!s) throw new NotFoundError("Service");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "service_catalogue.delete",
    target_type: "service_offering",
    target_id: id,
    request_id,
  });
}

// ── Storefront (public) ──────────────────────────────────
function listStorefront({ brand }) {
  return repo.listStorefrontServices({ brand });
}

async function getStorefront({ brand, slug }) {
  const s = await repo.getStorefrontServiceBySlug({ brand, slug });
  if (!s) throw new NotFoundError("Service");
  return s;
}

async function submitBooking({ brand, slug, input, request_id }) {
  const svc = await repo.getStorefrontServiceBySlug({ brand, slug });
  if (!svc) throw new NotFoundError("Service");
  const booking = await repo.createBookingRequest({
    brand,
    service_id: svc.service_id,
    contact_id: null,
    input,
  });
  await audit({
    business: brand,
    user_id: null,
    action_key: "service_catalogue.booking_request",
    target_type: "service_booking_request",
    target_id: booking.request_id,
    after: { service: svc.name, name: input.full_name },
    request_id,
  });
  return { ...booking, service_name: svc.name };
}

// ── Import / Export (single sheet, full create — like base) ──
async function importTemplate() {
  const example = {
    name: "Wig Revamp",
    short_description: "Refresh, wash and restyle your unit.",
    base_price_ngn: 25000,
    price_is_from: "yes",
    duration_minutes: 120,
    tags: "revamp, styling",
    sale_mode: "book",
    location_type: "in_studio",
    deposit_required: "yes",
    deposit_pct: 30,
    is_visible_storefront: "yes",
  };
  return buildWorkbook({
    sheets: [{ name: SERVICE_SHEET, columns: templateColumns(), rows: [example] }],
  });
}

async function exportServices({ brand }) {
  const services = await repo.listServices({ brand, active_only: false });
  const rows = services.map((s) => {
    const row = {};
    for (const c of SERVICE_COLUMNS) {
      const v = s[c.key];
      row[c.key] = c.format ? c.format(v) : (v ?? null);
    }
    return row;
  });
  return buildWorkbook({
    sheets: [{ name: SERVICE_SHEET, columns: templateColumns(), rows }],
  });
}

async function importServices({ brand, user, request_id, buffer }) {
  const sheets = await parseWorkbook(buffer);
  const rows = sheets[SERVICE_SHEET] ?? Object.values(sheets)[0] ?? [];
  const results = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const input = {};
    for (const c of SERVICE_COLUMNS) {
      const cell = raw[c.header];
      const val = c.parse ? c.parse(cell) : isBlank(cell) ? undefined : cell;
      if (val !== undefined) input[c.key] = val;
    }
    const line = i + 2; // header is row 1
    if (!input.name) {
      results.push({ row: line, status: "skipped", reason: "missing name" });
      continue;
    }
    try {
      const existing = await repo.findServiceByName({ brand, name: input.name });
      if (existing) {
        await repo.updateService({ brand, id: existing.service_id, input });
        updated++;
        results.push({ row: line, status: "updated", name: input.name });
      } else {
        input.slug = slugify(input.name);
        const svc = await repo.createService({
          brand,
          user_id: user.user_id,
          input,
        });
        created++;
        results.push({
          row: line,
          status: "created",
          name: input.name,
          service_id: svc.service_id,
        });
      }
    } catch (err) {
      results.push({
        row: line,
        status: "error",
        name: input.name,
        reason: err.userMessage || err.message || "row failed",
      });
    }
  }

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "service_catalogue.import",
    target_type: "service_offering",
    target_id: brand,
    after: { total: rows.length, created, updated },
    request_id,
  });
  return { total: rows.length, created, updated, results };
}

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  listStorefront,
  getStorefront,
  submitBooking,
  importTemplate,
  exportServices,
  importServices,
};
