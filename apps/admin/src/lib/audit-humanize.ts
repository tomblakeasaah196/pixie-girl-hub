/**
 * Audit humaniser — turns a raw audit row into plain English a non-technical
 * user understands.
 *
 * The audit `action` column stores the full action key emitted by the backend
 * (see src/middleware/audit.js): sometimes a bare verb ("login", "logout"),
 * usually a dotted key ("sales.order.create", "smartcomm.message.post",
 * "access.grant_role"). This module maps those onto friendly sentences like
 * "You signed in" or "You sent a message on Instagram to Jane" — instead of
 * showing the raw key and a JSON blob.
 *
 * It is deliberately heuristic + defensive: an unknown action still produces a
 * readable sentence rather than throwing or dumping the key. Both the Audit Log
 * page and the Command Center "My activity" feed render from here so the two
 * always speak the same language.
 */

export interface AuditLike {
  action: string;
  module?: string | null;
  table_name?: string | null;
  metadata?: Record<string, unknown> | null;
  user_name?: string | null;
}

/** Coarse category — drives the icon + colour tone in the UI. */
export type AuditKind =
  | "security"
  | "message"
  | "send"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "money"
  | "export"
  | "view"
  | "generic";

export interface Humanized {
  /** Friendly one-line sentence, e.g. "You sent a message on Instagram". */
  text: string;
  kind: AuditKind;
}

/* ── Verb dictionary ─────────────────────────────────────────
 * Maps an action verb token to (past-tense phrase, kind). */
const VERBS: Record<string, { word: string; kind: AuditKind }> = {
  create: { word: "created", kind: "create" },
  created: { word: "created", kind: "create" },
  store: { word: "saved", kind: "create" },
  upload: { word: "uploaded", kind: "create" },
  add: { word: "added", kind: "create" },
  generate: { word: "generated", kind: "create" },
  duplicate: { word: "duplicated", kind: "create" },
  import: { word: "imported", kind: "create" },
  update: { word: "updated", kind: "update" },
  edit: { word: "edited", kind: "update" },
  upsert: { word: "updated", kind: "update" },
  set: { word: "updated", kind: "update" },
  configure: { word: "set up", kind: "update" },
  assign: { word: "assigned", kind: "update" },
  schedule: { word: "scheduled", kind: "update" },
  reopen: { word: "reopened", kind: "update" },
  resolve: { word: "resolved", kind: "update" },
  restore: { word: "restored", kind: "update" },
  delete: { word: "deleted", kind: "delete" },
  remove: { word: "removed", kind: "delete" },
  archive: { word: "archived", kind: "delete" },
  retire: { word: "retired", kind: "delete" },
  deactivate: { word: "deactivated", kind: "delete" },
  detach: { word: "removed", kind: "delete" },
  void: { word: "voided", kind: "delete" },
  cancel: { word: "cancelled", kind: "delete" },
  demote: { word: "removed", kind: "delete" },
  send: { word: "sent", kind: "send" },
  post: { word: "sent", kind: "message" },
  forward: { word: "forwarded", kind: "message" },
  reveal: { word: "viewed", kind: "security" },
  view: { word: "viewed", kind: "view" },
  grant: { word: "granted", kind: "security" },
  revoke: { word: "revoked", kind: "security" },
  reactivate: { word: "reactivated", kind: "security" },
  provision: { word: "set up", kind: "security" },
  approve: { word: "approved", kind: "approve" },
  accept: { word: "accepted", kind: "approve" },
  reject: { word: "rejected", kind: "reject" },
  decline: { word: "declined", kind: "reject" },
  submit: { word: "submitted", kind: "update" },
  disburse: { word: "paid out", kind: "money" },
  settle: { word: "settled", kind: "money" },
  pay: { word: "paid", kind: "money" },
  accrue: { word: "recorded", kind: "money" },
  reverse: { word: "reversed", kind: "money" },
  award: { word: "awarded", kind: "money" },
  promote: { word: "promoted", kind: "update" },
  retry: { word: "retried", kind: "send" },
  export: { word: "exported", kind: "export" },
  sale: { word: "recorded", kind: "money" },
  receive: { word: "received", kind: "create" },
  capture: { word: "captured", kind: "create" },
  winner: { word: "chose a winner for", kind: "update" },
  build: { word: "built", kind: "create" },
  calculate: { word: "calculated", kind: "money" },
  save: { word: "saved", kind: "create" },
};

/* ── Noun dictionary ─────────────────────────────────────────
 * Maps an entity token (from the action key or table_name) to a friendly noun
 * complete with its article. Keep singular + plural / table-name aliases. */
const NOUNS: Record<string, string> = {
  order: "an order",
  order_capture: "an order",
  sales_orders: "an order",
  sales_order: "an order",
  message: "a message",
  thread: "a conversation",
  channel: "a conversation",
  invoice: "an invoice",
  invoices: "an invoice",
  expense: "an expense",
  expenses: "an expense",
  product: "a product",
  products: "a product",
  product_variants: "a product",
  contact: "a contact",
  contacts: "a contact",
  role: "a role",
  roles: "a role",
  user: "a login",
  users: "a login",
  login: "a login",
  external: "an external login",
  employee: "an employee",
  payroll_run: "a payroll run",
  payroll_runs: "a payroll run",
  commission: "a commission",
  bonus: "a bonus",
  campaign: "a campaign",
  sales_campaigns: "a campaign",
  email_campaigns: "an email campaign",
  template: "a template",
  variant: "a campaign variant",
  segment: "an audience segment",
  audience: "an audience",
  delivery: "a delivery",
  deliveries: "a delivery",
  location: "a stock location",
  movement: "a stock movement",
  document: "a document",
  documents: "a document",
  documents_store: "a document",
  geofence: "a clock-in zone",
  unit: "a team",
  position: "a role position",
  dotted_line: "a reporting line",
  reward_rule: "a reward rule",
  reward: "a reward",
  target: "a target",
  article: "a help article",
  category: "a category",
  quick_reply: "a quick reply",
  member: "a member",
  session: "a device session",
  device: "a device",
  geofences: "a clock-in zone",
  cost_vault: "cost data",
  service_catalogue: "a service",
  cash_request: "a cash request",
  bundle: "a bundle",
  tier: "a tier",
  upsell: "an upsell",
  ambassador: "an ambassador",
  payment_gateway: "a payment method",
  signature_request: "a signature request",
  media: "a file",
  attachment: "an attachment",
  access_review: "an access review",
};

/** Human labels for module keys, used as a last-resort object. */
const MODULE_LABELS: Record<string, string> = {
  auth: "your account",
  iam: "security",
  access: "access control",
  smartcomm: "messaging",
  sales: "sales",
  stock: "stock",
  hr_payroll: "HR & payroll",
  org_workflow: "the org chart",
  email_campaigns: "email campaigns",
  sales_campaigns: "campaigns",
  cash_request: "cash requests",
  messaging_accounts: "messaging accounts",
  platform_settings: "platform settings",
  business_setup: "business setup",
  ai_insights: "AI insights",
  calls: "calls",
  catalogue: "the catalogue",
  documents: "documents",
  help_center: "the help centre",
  service_catalogue: "services",
  attendance: "attendance",
};

/** Nicely-cased platform names for message channels. */
const PLATFORMS: Record<string, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  messenger: "Messenger",
  email: "email",
  sms: "SMS",
  tiktok: "TikTok",
  telegram: "Telegram",
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "a"/"an {word}" from a raw token. */
function genericNoun(token: string): string {
  const word = token.replace(/_/g, " ").trim();
  if (!word) return "a record";
  const article = /^[aeiou]/i.test(word) ? "an" : "a";
  return `${article} ${word}`;
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Resolve the object noun for an action from its entity token / table_name. */
function resolveObject(
  entityToken: string | null,
  tableName: string | null | undefined,
  moduleKey: string,
): string {
  if (entityToken && NOUNS[entityToken]) return NOUNS[entityToken];
  if (tableName && NOUNS[tableName]) return NOUNS[tableName];
  // A 2-segment key ("email_campaigns.send") has no entity token — the module
  // itself is the object, so try a noun for it before any generic fallback.
  if (!entityToken && NOUNS[moduleKey]) return NOUNS[moduleKey];
  if (entityToken) return genericNoun(entityToken);
  if (tableName) return genericNoun(tableName);
  const label = MODULE_LABELS[moduleKey];
  return label ? `something in ${label}` : "a record";
}

/** Look up a verb from a token that may itself be compound ("grant_role"). */
function resolveVerb(
  lastSegment: string,
): { verb: { word: string; kind: AuditKind }; entityFromVerb: string | null } | null {
  if (VERBS[lastSegment]) return { verb: VERBS[lastSegment], entityFromVerb: null };
  const parts = lastSegment.split("_");
  // "create_role", "grant_role", "set_active" → leading verb.
  if (parts.length > 1 && VERBS[parts[0]]) {
    return { verb: VERBS[parts[0]], entityFromVerb: parts.slice(1).join("_") || null };
  }
  // "finance_approve", "ceo_approve" → trailing verb.
  const tail = parts[parts.length - 1];
  if (parts.length > 1 && VERBS[tail]) {
    return { verb: VERBS[tail], entityFromVerb: null };
  }
  return null;
}

/* ── Exact/near-exact specials ───────────────────────────────
 * Highest-value actions get a hand-written sentence. `$who` is substituted
 * with the subject ("You" / actor name). */
function special(
  entry: AuditLike,
  who: string,
): Humanized | null {
  const a = entry.action;
  const meta = entry.metadata ?? null;

  switch (a) {
    case "login": {
      const failed = metaString(meta, "success") === "false";
      return failed
        ? { text: `${who} had a failed sign-in attempt`, kind: "security" }
        : { text: `${who} signed in`, kind: "security" };
    }
    case "logout":
      return { text: `${who} signed out`, kind: "security" };
    case "email_verified":
      return { text: `${who} verified ${who === "You" ? "your" : "their"} email`, kind: "security" };
    case "session_revoked":
      return { text: `${who} signed out a device`, kind: "security" };
    case "all_sessions_revoked":
      return { text: `${who} signed out of all devices`, kind: "security" };
    case "totp_enabled":
      return { text: `${who} turned on two-factor authentication`, kind: "security" };
    case "totp_disabled":
      return { text: `${who} turned off two-factor authentication`, kind: "security" };
    case "admin_reset_password":
      return { text: `${who} reset a teammate's password`, kind: "security" };
    case "send_reset_link":
      return { text: `${who} sent a password-reset link`, kind: "security" };
    case "provision_login":
      return { text: `${who} set up a login for a teammate`, kind: "security" };
    case "provision_external":
      return { text: `${who} set up an external login`, kind: "security" };
    case "deactivate_login":
      return { text: `${who} deactivated a login`, kind: "security" };
    case "reactivate_login":
      return { text: `${who} reactivated a login`, kind: "security" };
    case "smartcomm.message.post": {
      const platform = metaString(meta, "platform");
      const to = metaString(meta, "channel_name") || metaString(meta, "recipient");
      const on = platform ? ` on ${PLATFORMS[platform] ?? titleCase(platform)}` : "";
      const toPart = to ? ` to ${to}` : "";
      return { text: `${who} sent a message${on}${toPart}`, kind: "message" };
    }
    case "attendance.clock_event": {
      const dir = metaString(meta, "event_type") || metaString(meta, "direction");
      const verb =
        dir === "clock_out"
          ? "clocked out"
          : dir === "clock_in"
            ? "clocked in"
            : "recorded attendance";
      return { text: `${who} ${verb}`, kind: "generic" };
    }
    case "media.upload":
      return { text: `${who} uploaded a file`, kind: "create" };
    case "access.set_permissions":
      return { text: `${who} changed a role's permissions`, kind: "security" };
    case "access.set_user_access":
      return { text: `${who} changed a teammate's access`, kind: "security" };
    default:
      return null;
  }
}

/**
 * Humanise one audit row.
 * @param entry  the audit row (action + module + table_name + metadata)
 * @param opts.self  true when the row is the viewer's own action → "You …"
 */
export function humanizeAudit(
  entry: AuditLike,
  opts: { self?: boolean } = {},
): Humanized {
  const who = opts.self ? "You" : entry.user_name?.trim() || "Someone";

  const exact = special(entry, who);
  if (exact) return exact;

  const segments = (entry.action || "").split(".").filter(Boolean);
  const moduleKey = entry.module || segments[0] || "system";

  if (segments.length === 0) {
    return { text: `${who} made a change`, kind: "generic" };
  }

  const last = segments[segments.length - 1];
  const resolved = resolveVerb(last);

  // Entity token: prefer the middle segment ("sales.order.create" → "order"),
  // else any entity implied by the verb ("grant_role" → "role").
  const entityToken =
    segments.length >= 3
      ? segments[segments.length - 2]
      : resolved?.entityFromVerb ?? (segments.length === 2 ? null : null);

  if (resolved) {
    const object = resolveObject(entityToken, entry.table_name, moduleKey);
    return {
      text: `${who} ${resolved.verb.word} ${object}`,
      kind: resolved.verb.kind,
    };
  }

  // Unknown verb — humanise the raw last segment but keep it readable.
  const object = resolveObject(entityToken, entry.table_name, moduleKey);
  const verbWords = last.replace(/_/g, " ");
  return { text: `${who} ${verbWords} ${object}`, kind: "generic" };
}

/** A short, friendly label for the module a row belongs to. */
export function friendlyModule(moduleKey: string | null | undefined): string {
  if (!moduleKey) return "System";
  const label = MODULE_LABELS[moduleKey];
  if (label) return titleCase(label);
  return titleCase(moduleKey.replace(/_/g, " "));
}
