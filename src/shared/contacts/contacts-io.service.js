/**
 * Contacts import/export engine — bulk onboarding for clients (customers) and
 * suppliers via CSV / Excel.
 *
 * Flow the owner asked for:
 *   1. Download a TEMPLATE (CSV) — pick "Clients" or "Suppliers". Each carries
 *      the column headers + one sample row so the layout is unambiguous.
 *   2. Fill it in Excel (or any spreadsheet app) and IMPORT it back — the file
 *      may be .csv OR .xlsx (auto-detected). Rows become real contacts.
 *   3. EXPORT (owner/CEO only) — pick a period and download every client /
 *      supplier created in that window.
 *
 * Composition over duplication: imports delegate to the existing contacts
 * service (create + addAddress), so an imported row fires the SAME audit and
 * domain events as a row typed into the UI. The spreadsheet plumbing (CSV
 * build/parse, .xlsx parse) lives in services/spreadsheet.service.js.
 */

"use strict";

const repo = require("./contacts.repo");
const service = require("./contacts.service");
const { contactCreate, addressCreate } = require("./contacts.validator");
const { buildCsv, parseUpload } = require("../../services/spreadsheet.service");

// ── small coercion helpers ───────────────────────────────
const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const str = (v) => (isBlank(v) ? undefined : String(v).trim());
const lc = (v) => (isBlank(v) ? undefined : String(v).trim().toLowerCase());

/** Normalise a free-typed gender into the stored enum (M/F/other/prefer_not). */
function gender(v) {
  const s = lc(v);
  if (!s) return undefined;
  if (["m", "male"].includes(s)) return "M";
  if (["f", "female"].includes(s)) return "F";
  if (["prefer_not", "prefer not", "n/a", "na"].includes(s))
    return "prefer_not";
  return "other";
}

/** ISO date → YYYY-MM-DD (Excel hands us a full ISO string; CSV a plain date). */
function isoDate(v) {
  const s = str(v);
  if (!s) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s; // leave odd values intact → Zod reports a clean error
}

const source = (v) => {
  const s = lc(v);
  return s ? s.replace(/\s+/g, "_") : undefined;
};

// ════════════════════════════════════════════════════════════
// Column model — ONE source of truth. Each field knows which template(s) it
// belongs to, its sample value, and whether it targets the contact or its
// (optional) default delivery address.
// ════════════════════════════════════════════════════════════
/**
 * @typedef {Object} FieldSpec
 * @property {string}  header     Column header (the "*" suffix flags required).
 * @property {string}  field      Target key on the contact / address input.
 * @property {"contact"|"address"} group
 * @property {boolean} client     Appears on the Clients template.
 * @property {boolean} supplier   Appears on the Suppliers template.
 * @property {string}  [clientSample]
 * @property {string}  [supplierSample]
 * @property {string}  [note]     Header comment / guidance.
 * @property {(v:any)=>any} [clean] Pre-Zod normaliser (enums, dates…).
 */

/** @type {FieldSpec[]} */
const FIELDS = [
  {
    header: "Display Name*",
    field: "display_name",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "Adaeze Okafor",
    supplierSample: "Golden Hair Imports Ltd",
    note: "Required. Person or business name as it should appear in the directory.",
  },
  {
    header: "Company Name",
    field: "company_name",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "",
    supplierSample: "Golden Hair Imports Ltd",
  },
  {
    header: "First Name",
    field: "first_name",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "Adaeze",
    supplierSample: "Chidi",
    note: "For a supplier this is the contact person's first name.",
  },
  {
    header: "Last Name",
    field: "last_name",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "Okafor",
    supplierSample: "Eze",
  },
  {
    header: "Gender",
    field: "gender",
    group: "contact",
    client: true,
    supplier: false,
    clientSample: "F",
    note: "One of: M, F, other, prefer_not.",
    clean: gender,
  },
  {
    header: "Date of Birth",
    field: "date_of_birth",
    group: "contact",
    client: true,
    supplier: false,
    clientSample: "1996-04-12",
    note: "Format YYYY-MM-DD.",
    clean: isoDate,
  },
  {
    header: "Primary Phone*",
    field: "primary_phone",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "+2348012345678",
    supplierSample: "+2348098765432",
    note: "Required. Include the country code (e.g. +234…).",
  },
  {
    header: "WhatsApp Number",
    field: "whatsapp_number",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "+2348012345678",
    supplierSample: "+2348098765432",
  },
  {
    header: "Email",
    field: "email",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "adaeze@example.com",
    supplierSample: "sales@goldenhair.example",
  },
  {
    header: "TIN",
    field: "tin",
    group: "contact",
    client: false,
    supplier: true,
    supplierSample: "12345678-0001",
    note: "Nigerian Tax ID. Must be unique across the directory.",
  },
  {
    header: "CAC Number",
    field: "cac_number",
    group: "contact",
    client: false,
    supplier: true,
    supplierSample: "RC123456",
  },
  {
    header: "Country Code",
    field: "country_code",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "NG",
    supplierSample: "NG",
    note: "ISO 2-letter country code.",
    clean: (v) => (str(v) ? String(v).trim().toUpperCase() : undefined),
  },
  {
    header: "Instagram Handle",
    field: "instagram_handle",
    group: "contact",
    client: true,
    supplier: false,
    clientSample: "adaeze.styles",
  },
  {
    header: "TikTok Handle",
    field: "tiktok_handle",
    group: "contact",
    client: true,
    supplier: false,
    clientSample: "",
  },
  {
    header: "Facebook Handle",
    field: "facebook_handle",
    group: "contact",
    client: true,
    supplier: false,
    clientSample: "",
  },
  {
    header: "Priority",
    field: "priority_level",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "regular",
    supplierSample: "regular",
    note: "One of: vip, regular, new.",
    clean: lc,
  },
  {
    header: "Source",
    field: "source",
    group: "contact",
    client: true,
    supplier: false,
    clientSample: "walk_in",
    note: "e.g. walk_in, social_media, referral, website, event, storefront.",
    clean: source,
  },
  {
    header: "Address Line 1",
    field: "line1",
    group: "address",
    client: true,
    supplier: true,
    clientSample: "12 Admiralty Way",
    supplierSample: "5 Balogun Market Road",
    note: "Optional. Fill to also save a default delivery address.",
  },
  {
    header: "Area",
    field: "area",
    group: "address",
    client: true,
    supplier: true,
    clientSample: "Lekki Phase 1",
    supplierSample: "Lagos Island",
  },
  {
    header: "City",
    field: "city",
    group: "address",
    client: true,
    supplier: true,
    clientSample: "Lagos",
    supplierSample: "Lagos",
  },
  {
    header: "State",
    field: "state",
    group: "address",
    client: true,
    supplier: true,
    clientSample: "Lagos",
    supplierSample: "Lagos",
  },
  {
    header: "Country",
    field: "country",
    group: "address",
    client: true,
    supplier: true,
    clientSample: "Nigeria",
    supplierSample: "Nigeria",
  },
  {
    header: "Notes",
    field: "notes",
    group: "contact",
    client: true,
    supplier: true,
    clientSample: "Prefers bob units.",
    supplierSample: "Bulk raw-hair supplier.",
  },
];

const BY_HEADER = new Map(FIELDS.map((f) => [f.header, f]));

/** Normalise the requested kind to a stable token. Defaults to clients. */
function normaliseKind(kind) {
  const k = lc(kind);
  if (k === "supplier" || k === "suppliers") return "suppliers";
  if (k === "all") return "all";
  return "clients";
}

const KIND_TYPE = { clients: "customer", suppliers: "supplier" };
const KIND_LABEL = {
  clients: "Clients",
  suppliers: "Suppliers",
  all: "Contacts",
};

/** Column list for a template ("clients" | "suppliers"). */
function templateColumns(kind) {
  const flag = kind === "suppliers" ? "supplier" : "client";
  return FIELDS.filter((f) => f[flag]).map((f) => ({
    header: f.header,
    key: f.header,
    note: f.note,
  }));
}

/** Sample row (header→value) for a template. */
function sampleRow(kind) {
  const sampleKey = kind === "suppliers" ? "supplierSample" : "clientSample";
  const row = {};
  for (const f of FIELDS) {
    if (!f[kind === "suppliers" ? "supplier" : "client"]) continue;
    row[f.header] = f[sampleKey] ?? "";
  }
  return row;
}

// ════════════════════════════════════════════════════════════
// Template
// ════════════════════════════════════════════════════════════
function template({ kind }) {
  const k = normaliseKind(kind) === "suppliers" ? "suppliers" : "clients";
  return buildCsv({ columns: templateColumns(k), rows: [sampleRow(k)] });
}

// ════════════════════════════════════════════════════════════
// Import
// ════════════════════════════════════════════════════════════
/** Turn one header-keyed sheet row into validated { contact, address }. */
function rowToInputs(raw, kind) {
  const contact = {};
  const address = {};
  for (const [header, value] of Object.entries(raw)) {
    const spec = BY_HEADER.get(header);
    if (!spec) continue; // unknown column → ignored, never fatal
    const cleaned = spec.clean ? spec.clean(value) : str(value);
    if (cleaned === undefined) continue;
    if (spec.group === "address") address[spec.field] = cleaned;
    else contact[spec.field] = cleaned;
  }
  contact.contact_type = [KIND_TYPE[kind] ?? "customer"];

  const parsedContact = contactCreate.parse(contact); // throws → reported per row
  let parsedAddress = null;
  if (address.line1) {
    parsedAddress = addressCreate.parse({
      address_type: "delivery",
      is_default: true,
      ...address,
    });
  }
  return { contact: parsedContact, address: parsedAddress };
}

const MAX_IMPORT_ROWS = 5000;

async function importContacts({
  brand,
  user,
  request_id,
  kind,
  buffer,
  filename,
}) {
  const k = normaliseKind(kind) === "suppliers" ? "suppliers" : "clients";
  const rows = await parseUpload({ buffer, filename });

  const results = [];
  let created = 0;
  let duplicates = 0;

  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      kind: k,
      created,
      duplicates,
      total: rows.length,
      results: [
        {
          row: 0,
          status: "error",
          reason: `File has ${rows.length} rows; the import limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`,
        },
      ],
    };
  }

  for (let i = 0; i < rows.length; i++) {
    const line = i + 2; // +1 header row, +1 to be 1-based like the spreadsheet
    let input;
    try {
      input = rowToInputs(rows[i], k);
    } catch (err) {
      results.push({
        row: line,
        status: "error",
        reason: zodMessage(err),
      });
      continue;
    }

    const { contact, address } = input;
    try {
      // De-dupe on phone: a contact already on file is not recreated — instead
      // we make sure they carry this kind's type (a client who also supplies).
      const existing = await repo.findByPhone({ phone: contact.primary_phone });
      if (existing) {
        await repo.addContactTypes({
          id: existing.contact_id,
          types: contact.contact_type,
        });
        duplicates++;
        results.push({
          row: line,
          status: "duplicate",
          name: existing.display_name,
          reason: `phone ${contact.primary_phone} already on file`,
        });
        continue;
      }

      const c = await service.create({
        brand,
        user,
        request_id,
        input: contact,
      });
      created++;
      results.push({ row: line, status: "created", name: c.display_name });

      if (address) {
        try {
          await service.addAddress({
            brand,
            user,
            request_id,
            id: c.contact_id,
            input: address,
          });
        } catch (err) {
          results.push({
            row: line,
            status: "warn",
            name: c.display_name,
            reason: `address skipped: ${err.user_message || err.message}`,
          });
        }
      }
    } catch (err) {
      results.push({
        row: line,
        status: "error",
        name: contact.display_name,
        reason: err.user_message || err.message,
      });
    }
  }

  return { kind: k, created, duplicates, total: rows.length, results };
}

/** Flatten a Zod error into a short, row-friendly message. */
function zodMessage(err) {
  if (err && Array.isArray(err.issues) && err.issues.length) {
    return err.issues
      .map((iss) => {
        const path =
          iss.path && iss.path.length ? `${iss.path.join(".")}: ` : "";
        return `${path}${iss.message}`;
      })
      .join("; ");
  }
  return err.user_message || err.message || "invalid row";
}

// ════════════════════════════════════════════════════════════
// Export (owner / CEO only — enforced at the route)
// ════════════════════════════════════════════════════════════
const EXPORT_COLUMNS = [
  ...FIELDS.map((f) => ({ header: f.header.replace(/\*$/, ""), key: f.field })),
  { header: "Contact Type", key: "contact_type" },
  { header: "Created At", key: "created_at" },
];

async function exportContacts({ kind, from, to }) {
  const k = normaliseKind(kind);
  const contacts = await repo.exportRows({
    type: KIND_TYPE[k] || null, // null → all (customers + suppliers)
    from: str(from),
    to: str(to),
  });
  const rows = contacts.map((c) => ({
    ...c,
    contact_type: Array.isArray(c.contact_type)
      ? c.contact_type.join(", ")
      : c.contact_type,
    created_at: c.created_at
      ? new Date(c.created_at).toISOString().slice(0, 10)
      : "",
  }));
  return buildCsv({ columns: EXPORT_COLUMNS, rows });
}

/** Filename stem for an export download, e.g. "clients-2026-01-01_2026-06-21". */
function exportFilename({ kind, from, to }) {
  const k = normaliseKind(kind);
  const period = [str(from), str(to)].filter(Boolean).join("_");
  const stem = (KIND_LABEL[k] || "Contacts").toLowerCase();
  return `${stem}${period ? `-${period}` : ""}.csv`;
}

module.exports = {
  template,
  importContacts,
  exportContacts,
  exportFilename,
  normaliseKind,
  // Exported for unit tests (column fidelity + row mapping).
  FIELDS,
  BY_HEADER,
  KIND_TYPE,
  templateColumns,
  sampleRow,
  rowToInputs,
  EXPORT_COLUMNS,
};
