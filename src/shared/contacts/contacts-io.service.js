/**
 * Contacts import/export engine — bulk onboarding for every stakeholder kind
 * (clients, suppliers, retail partners, stylists, subscribers) via CSV / Excel.
 *
 * Flow the owner asked for (mirrors Catalogue → Base Products "Import"):
 *   1. Pick a KIND (Clients / Suppliers / Retail partners / Stylists /
 *      Subscribers) and download that kind's TEMPLATE — a CSV carrying the
 *      column headers + one sample row so the layout is unambiguous.
 *   2. Fill it in Excel (or any spreadsheet app). The admin app then PREVIEWS
 *      it in the browser (SheetJS) so every row can be reviewed before anything
 *      is written, and on CONFIRM posts the parsed rows to /contacts/import-rows.
 *   3. EXPORT (owner/CEO only) — pick a period and download the records created
 *      in that window.
 *
 * Two ingest paths share ONE processor (`importParsedRows`):
 *   • POST /contacts/import       — multipart file, parsed server-side.
 *   • POST /contacts/import-rows  — already-parsed JSON rows from the preview.
 * Both delegate to the existing contacts service (create + addAddress), so an
 * imported row fires the SAME audit and domain events as a row typed into the
 * UI. The spreadsheet plumbing (CSV build/parse, .xlsx parse) lives in
 * services/spreadsheet.service.js.
 *
 * The FIELDS column model below is the ONE source of truth: it drives the
 * template, the server-side validation, AND the browser preview (served to the
 * admin app via GET /contacts/import-spec). Add a kind by tagging fields with
 * its token in `kinds` — no other file needs to change.
 */

"use strict";

const repo = require("./contacts.repo");
const service = require("./contacts.service");
const { contactCreateChecked, addressCreate } = require("./contacts.validator");
const { buildCsv, parseUpload } = require("../../services/spreadsheet.service");
const { PermissionDeniedError } = require("../../utils/errors");

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
// Kind registry — each import kind maps to a contact_type. "all" is an export
// pseudo-kind only. Add a kind here + tag fields in FIELDS and the whole engine
// (template · spec · preview · import) picks it up.
// ════════════════════════════════════════════════════════════
const KINDS = {
  clients: { type: "customer", label: "Clients" },
  suppliers: { type: "supplier", label: "Suppliers" },
  retail_partners: { type: "retail_partner", label: "Retail partners" },
  stylists: { type: "stylist_partner", label: "Stylists" },
  subscribers: { type: "subscriber", label: "Subscribers" },
};
const KIND_TOKENS = Object.keys(KINDS);

const KIND_TYPE = Object.fromEntries(
  Object.entries(KINDS).map(([k, v]) => [k, v.type]),
);
const KIND_LABEL = {
  ...Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])),
  all: "Contacts",
};

// Convenience groupings for tagging fields.
const ALL = KIND_TOKENS;
const PERSONS = ["clients", "stylists"]; // personal + social identity
const BUSINESSES = ["suppliers", "retail_partners"]; // TIN / CAC / company
const WITH_ADDRESS = ["clients", "suppliers", "retail_partners", "stylists"];

// ════════════════════════════════════════════════════════════
// Column model — ONE source of truth. Each field knows which kind(s) it belongs
// to, its per-kind sample value, whether it targets the contact or its
// (optional) default delivery address, and a `type` the browser preview uses to
// validate before the row is ever sent to the server.
// ════════════════════════════════════════════════════════════
/**
 * @typedef {Object} FieldSpec
 * @property {string}  header   Column header (a trailing "*" flags required).
 * @property {string}  field    Target key on the contact / address input.
 * @property {"contact"|"address"} group
 * @property {"text"|"phone"|"email"|"date"|"gender"|"enum"|"handle"} type
 *           Hint the browser preview uses to validate the cell.
 * @property {string[]} kinds   Import kinds this column appears on.
 * @property {boolean} [required] Row is invalid in the preview if this is blank.
 * @property {boolean} [channel]  Counts toward the "phone OR email" rule.
 * @property {string[]} [options] Allowed values for gender/enum types.
 * @property {Object.<string,string>} [samples] Per-kind sample cell value.
 * @property {string}  [note]   Header guidance shown in the preview.
 * @property {(v:any)=>any} [clean] Pre-Zod normaliser (enums, dates…).
 */

/** @type {FieldSpec[]} */
const FIELDS = [
  {
    header: "Display Name*",
    field: "display_name",
    group: "contact",
    type: "text",
    required: true,
    kinds: ALL,
    samples: {
      clients: "Adaeze Okafor",
      suppliers: "Golden Hair Imports Ltd",
      retail_partners: "Bloom Beauty Store",
      stylists: "Ngozi Adeleke",
      subscribers: "Chidinma Umeh",
    },
    note: "Required. Person or business name as it should appear in the directory.",
  },
  {
    header: "Company Name",
    field: "company_name",
    group: "contact",
    type: "text",
    kinds: ["clients", "suppliers", "retail_partners", "stylists"],
    samples: {
      suppliers: "Golden Hair Imports Ltd",
      retail_partners: "Bloom Beauty Store",
      stylists: "Ngozi Hair Studio",
    },
  },
  {
    header: "First Name",
    field: "first_name",
    group: "contact",
    type: "text",
    kinds: ALL,
    samples: {
      clients: "Adaeze",
      suppliers: "Chidi",
      retail_partners: "Amaka",
      stylists: "Ngozi",
      subscribers: "Chidinma",
    },
    note: "For a business this is the contact person's first name.",
  },
  {
    header: "Last Name",
    field: "last_name",
    group: "contact",
    type: "text",
    kinds: ALL,
    samples: {
      clients: "Okafor",
      suppliers: "Eze",
      retail_partners: "Bello",
      stylists: "Adeleke",
      subscribers: "Umeh",
    },
  },
  {
    header: "Gender",
    field: "gender",
    group: "contact",
    type: "gender",
    options: ["M", "F", "other", "prefer_not"],
    kinds: PERSONS,
    samples: { clients: "F", stylists: "F" },
    note: "One of: M, F, other, prefer_not.",
    clean: gender,
  },
  {
    header: "Date of Birth",
    field: "date_of_birth",
    group: "contact",
    type: "date",
    kinds: PERSONS,
    samples: { clients: "1996-04-12", stylists: "1992-08-03" },
    note: "Format YYYY-MM-DD.",
    clean: isoDate,
  },
  {
    header: "Primary Phone*",
    field: "primary_phone",
    group: "contact",
    type: "phone",
    channel: true,
    kinds: ALL,
    samples: {
      clients: "+2348012345678",
      suppliers: "+2348098765432",
      retail_partners: "+2348023456789",
      stylists: "+2348034567890",
      subscribers: "+2348045678901",
    },
    note: "Include the country code (e.g. +234…). A phone OR an email is required.",
  },
  {
    header: "WhatsApp Number",
    field: "whatsapp_number",
    group: "contact",
    type: "phone",
    kinds: ALL,
    samples: {
      clients: "+2348012345678",
      suppliers: "+2348098765432",
      retail_partners: "+2348023456789",
      stylists: "+2348034567890",
    },
  },
  {
    header: "Email",
    field: "email",
    group: "contact",
    type: "email",
    channel: true,
    kinds: ALL,
    samples: {
      clients: "adaeze@example.com",
      suppliers: "sales@goldenhair.example",
      retail_partners: "hello@bloombeauty.example",
      stylists: "ngozi@example.com",
      subscribers: "chidinma@example.com",
    },
    note: "A phone OR an email is required.",
  },
  {
    header: "TIN",
    field: "tin",
    group: "contact",
    type: "text",
    kinds: BUSINESSES,
    samples: { suppliers: "12345678-0001", retail_partners: "87654321-0001" },
    note: "Nigerian Tax ID. Must be unique across the directory.",
  },
  {
    header: "CAC Number",
    field: "cac_number",
    group: "contact",
    type: "text",
    kinds: BUSINESSES,
    samples: { suppliers: "RC123456", retail_partners: "RC654321" },
  },
  {
    header: "Country Code",
    field: "country_code",
    group: "contact",
    type: "text",
    kinds: ALL,
    samples: {
      clients: "NG",
      suppliers: "NG",
      retail_partners: "NG",
      stylists: "NG",
      subscribers: "NG",
    },
    note: "ISO 2-letter country code.",
    clean: (v) => (str(v) ? String(v).trim().toUpperCase() : undefined),
  },
  {
    header: "Instagram Handle",
    field: "instagram_handle",
    group: "contact",
    type: "handle",
    kinds: ["clients", "stylists", "retail_partners"],
    samples: {
      clients: "adaeze.styles",
      stylists: "ngozi.hair",
      retail_partners: "bloombeauty",
    },
  },
  {
    header: "TikTok Handle",
    field: "tiktok_handle",
    group: "contact",
    type: "handle",
    kinds: PERSONS,
    samples: {},
  },
  {
    header: "Facebook Handle",
    field: "facebook_handle",
    group: "contact",
    type: "handle",
    kinds: ["clients", "stylists", "retail_partners"],
    samples: {},
  },
  {
    header: "Priority",
    field: "priority_level",
    group: "contact",
    type: "enum",
    options: ["vip", "regular", "new"],
    kinds: ["clients", "suppliers", "retail_partners", "stylists"],
    samples: {
      clients: "regular",
      suppliers: "regular",
      retail_partners: "regular",
      stylists: "regular",
    },
    note: "One of: vip, regular, new.",
    clean: lc,
  },
  {
    header: "Source",
    field: "source",
    group: "contact",
    type: "text",
    kinds: ["clients", "stylists", "subscribers"],
    samples: {
      clients: "walk_in",
      stylists: "referral",
      subscribers: "website",
    },
    note: "e.g. walk_in, social_media, referral, website, event, storefront.",
    clean: source,
  },
  {
    header: "Address Line 1",
    field: "line1",
    group: "address",
    type: "text",
    kinds: WITH_ADDRESS,
    samples: {
      clients: "12 Admiralty Way",
      suppliers: "5 Balogun Market Road",
      retail_partners: "20 Allen Avenue",
      stylists: "8 Freedom Way",
    },
    note: "Optional. Fill to also save a default delivery address.",
  },
  {
    header: "Area",
    field: "area",
    group: "address",
    type: "text",
    kinds: WITH_ADDRESS,
    samples: {
      clients: "Lekki Phase 1",
      suppliers: "Lagos Island",
      retail_partners: "Ikeja",
      stylists: "Lekki",
    },
  },
  {
    header: "City",
    field: "city",
    group: "address",
    type: "text",
    kinds: WITH_ADDRESS,
    samples: {
      clients: "Lagos",
      suppliers: "Lagos",
      retail_partners: "Lagos",
      stylists: "Lagos",
    },
  },
  {
    header: "State",
    field: "state",
    group: "address",
    type: "text",
    kinds: WITH_ADDRESS,
    samples: {
      clients: "Lagos",
      suppliers: "Lagos",
      retail_partners: "Lagos",
      stylists: "Lagos",
    },
  },
  {
    header: "Country",
    field: "country",
    group: "address",
    type: "text",
    kinds: WITH_ADDRESS,
    samples: {
      clients: "Nigeria",
      suppliers: "Nigeria",
      retail_partners: "Nigeria",
      stylists: "Nigeria",
    },
  },
  {
    header: "Notes",
    field: "notes",
    group: "contact",
    type: "text",
    kinds: ALL,
    samples: {
      clients: "Prefers bob units.",
      suppliers: "Bulk raw-hair supplier.",
      retail_partners: "Stocks our closures.",
      stylists: "Specialises in frontals.",
      subscribers: "Signed up at the pop-up.",
    },
  },
];

const BY_HEADER = new Map(FIELDS.map((f) => [f.header, f]));

/** The sample cell value for a field in a given kind (empty string if none). */
function sampleFor(field, kind) {
  return (field.samples && field.samples[kind]) ?? "";
}

/**
 * Normalise a requested kind to a stable token. Accepts singular/plural and a
 * few aliases (contact_type values, "retail", "stylist"). Unknown → clients.
 * Returns the export pseudo-kind "all" verbatim.
 */
function normaliseKind(kind) {
  const k = lc(kind);
  if (!k) return "clients";
  if (k === "all") return "all";
  if (["supplier", "suppliers"].includes(k)) return "suppliers";
  if (
    [
      "retail_partner",
      "retail_partners",
      "retail partner",
      "retail partners",
      "retail",
    ].includes(k)
  )
    return "retail_partners";
  if (
    [
      "stylist",
      "stylists",
      "stylist_partner",
      "stylist_partners",
      "stylist partner",
      "stylist partners",
    ].includes(k)
  )
    return "stylists";
  if (["subscriber", "subscribers"].includes(k)) return "subscribers";
  if (["client", "clients", "customer", "customers"].includes(k))
    return "clients";
  return "clients";
}

/** Resolve to a concrete IMPORT kind (never "all") — the default is clients. */
function importKind(kind) {
  const k = normaliseKind(kind);
  return k === "all" ? "clients" : k;
}

/** Column list for a template / import ("clients" | "suppliers" | …). */
function templateColumns(kind) {
  const k = importKind(kind);
  return FIELDS.filter((f) => f.kinds.includes(k)).map((f) => ({
    header: f.header,
    key: f.header,
    note: f.note,
  }));
}

/** Sample row (header→value) for a template. */
function sampleRow(kind) {
  const k = importKind(kind);
  const row = {};
  for (const f of FIELDS) {
    if (!f.kinds.includes(k)) continue;
    row[f.header] = sampleFor(f, k);
  }
  return row;
}

/**
 * Column spec served to the admin app (GET /contacts/import-spec). Drives the
 * browser preview: expected-columns chips, per-row required/channel validation,
 * and enum hints — so the preview matches the server without hard-coding a copy.
 */
function importSpec(kind) {
  const k = importKind(kind);
  const columns = FIELDS.filter((f) => f.kinds.includes(k)).map((f) => ({
    header: f.header,
    field: f.field,
    group: f.group,
    type: f.type,
    required: !!f.required,
    channel: !!f.channel,
    options: f.options,
    note: f.note,
    sample: sampleFor(f, k),
  }));
  return { kind: k, label: KINDS[k].label, columns };
}

// ════════════════════════════════════════════════════════════
// Template
// ════════════════════════════════════════════════════════════
function template({ kind }) {
  const k = importKind(kind);
  return buildCsv({ columns: templateColumns(k), rows: [sampleRow(k)] });
}

// ════════════════════════════════════════════════════════════
// Import
// ════════════════════════════════════════════════════════════
/** Turn one header-keyed sheet row into validated { contact, address }. */
function rowToInputs(raw, kind) {
  const k = importKind(kind);
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
  contact.contact_type = [KIND_TYPE[k] ?? "customer"];

  const parsedContact = contactCreateChecked.parse(contact); // throws → reported per row
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

/**
 * Shared processor for both ingest paths. `rows` is an array of header-keyed
 * objects (exactly what parseUpload yields and what the browser preview posts).
 */
async function importParsedRows({
  brand,
  user,
  request_id,
  kind,
  rows,
  allowedTypes = null,
}) {
  const k = importKind(kind);
  // Contact-type visibility (contacts §6.12): a role that can't see a kind may
  // not bulk-create it either (it would import contacts it then can't view).
  if (Array.isArray(allowedTypes) && !allowedTypes.includes(KIND_TYPE[k])) {
    throw new PermissionDeniedError(
      `You don't have access to import ${KIND_LABEL[k].toLowerCase()}`,
    );
  }

  const list = Array.isArray(rows) ? rows : [];
  const results = [];
  let created = 0;
  let duplicates = 0;

  if (list.length > MAX_IMPORT_ROWS) {
    return {
      kind: k,
      created,
      duplicates,
      total: list.length,
      results: [
        {
          row: 0,
          status: "error",
          reason: `File has ${list.length} rows; the import limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`,
        },
      ],
    };
  }

  for (let i = 0; i < list.length; i++) {
    const line = i + 2; // +1 header row, +1 to be 1-based like the spreadsheet
    let input;
    try {
      input = rowToInputs(list[i], k);
    } catch (err) {
      results.push({ row: line, status: "error", reason: zodMessage(err) });
      continue;
    }

    const { contact, address } = input;
    try {
      // De-dupe on phone OR email: a contact already on file is not recreated —
      // instead we make sure they carry this kind's type (a client who also
      // supplies). Either channel can be the match key now that one suffices.
      const existing = await repo.findByPhoneOrEmail({
        phone: contact.primary_phone,
        email: contact.email,
      });
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
          reason: `already on file: ${contact.primary_phone || contact.email}`,
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

  return { kind: k, created, duplicates, total: list.length, results };
}

/** File ingest path (multipart) — parse the upload, then run the processor. */
async function importContacts({
  brand,
  user,
  request_id,
  kind,
  buffer,
  filename,
  allowedTypes = null,
}) {
  const rows = await parseUpload({ buffer, filename });
  return importParsedRows({
    brand,
    user,
    request_id,
    kind,
    rows,
    allowedTypes,
  });
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
  importParsedRows,
  importSpec,
  exportContacts,
  exportFilename,
  normaliseKind,
  importKind,
  KINDS,
  KIND_LABEL,
  // Exported for unit tests (column fidelity + row mapping).
  FIELDS,
  BY_HEADER,
  KIND_TYPE,
  templateColumns,
  sampleRow,
  rowToInputs,
  EXPORT_COLUMNS,
};
