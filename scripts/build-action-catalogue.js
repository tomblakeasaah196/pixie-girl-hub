#!/usr/bin/env node
"use strict";

/**
 * Build shared.ai_action_catalogue from the live OpenAPI spec (docs/openapi.yaml)
 * so Praxis can PROPOSE actions across EVERY module — and any module added in
 * future appears automatically on the next run (CI runs this on deploy).
 *
 * Why OpenAPI and not hand-seeding: the catalogue was only ever seeded with a
 * handful of actions, so Praxis could act in almost no module. The spec already
 * enumerates every write endpoint (method, path, summary, module tag, request
 * body schema) — so we derive the whole action surface from it in one pass.
 *
 * SAFETY: nothing here lets Praxis act unsupervised. Every catalogued write is
 *   (a) confirm-gated — it becomes a pending action a human must approve, and
 *   (b) executed by re-entering the REAL endpoint over loopback AS the user, so
 *       the endpoint's own RBAC + Zod validation re-apply at execution. The
 *       catalogue's required_permission is therefore advisory (for display/
 *       filtering); the actual permission is enforced by the live route.
 *
 * Defaults: GET is skipped (reads go through the query/SQL agent, not actions).
 * POST/PUT/PATCH default ai_enabled=true; DELETE defaults ai_enabled=false
 * (destructive — opt in per action from AI Control). Re-running PRESERVES each
 * action's ai_enabled toggle (admins' choices in AI Control are never clobbered).
 *
 *   npm run build:action-catalogue
 *   npm run ai:reindex               # also embeds action descriptions
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const {
  initDatabase,
  query,
  closeDatabase,
} = require("../src/config/database");

const SPEC_PATH = path.join(__dirname, "..", "docs", "openapi.yaml");
const BASE_PREFIX = "/api/v1"; // servers[].url basePath in the spec
const WRITE_METHODS = ["post", "put", "patch", "delete"];

// Tags/segments that are never Praxis actions (public, auth, infra).
const SKIP_MODULES = new Set([
  "auth",
  "public",
  "webhooks",
  "health",
  "storefront-public",
]);

const slug = (s) =>
  s
    .replace(/\{[^}]+\}/g, "") // drop path params from the key
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

/** OpenAPI `{id}` → Express `:id` so the executor's resolveRoute() can fill it. */
const toExpressRoute = (p) => p.replace(/\{([^}]+)\}/g, ":$1");

/** Best-effort permission action word from the HTTP method + path tail. */
function permWord(method, p) {
  const tail = p.split("/").pop() || "";
  if (/^(approve|confirm|authorize|sign)/.test(tail)) return "approve";
  if (/^(reject|decline|cancel|void|reverse)/.test(tail)) return "approve";
  if (/^(submit|send|dispatch|issue|pay|disburse)/.test(tail)) return "edit";
  if (method === "delete") return "delete";
  if (method === "post") return "create";
  return "edit"; // put / patch
}

function jsonSchemaFor(op) {
  const body =
    op.requestBody &&
    op.requestBody.content &&
    op.requestBody.content["application/json"] &&
    op.requestBody.content["application/json"].schema;
  return body && typeof body === "object" ? body : {};
}

async function upsert(a) {
  await query(
    `INSERT INTO shared.ai_action_catalogue
       (action_key, title, method, route, description, module, category,
        is_write, entity_scope, payload_schema, required_permission,
        ai_enabled, requires_confirmation, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,'write',true,'both',$7::jsonb,$8,$9,true,true)
     ON CONFLICT (action_key) DO UPDATE SET
       title = EXCLUDED.title,
       method = EXCLUDED.method,
       route = EXCLUDED.route,
       description = EXCLUDED.description,
       module = EXCLUDED.module,
       payload_schema = EXCLUDED.payload_schema,
       required_permission = EXCLUDED.required_permission,
       is_active = true,
       updated_at = now()`,
    // NOTE: ai_enabled is intentionally NOT in the UPDATE set — re-running keeps
    // whatever AI Control has toggled. It's only applied on first INSERT.
    [
      a.action_key,
      a.title.slice(0, 200),
      a.method,
      a.route,
      a.description,
      a.module,
      JSON.stringify(a.payload_schema || {}),
      a.required_permission,
      a.ai_enabled,
    ],
  );
}

async function main() {
  if (!fs.existsSync(SPEC_PATH)) {
    throw new Error(`OpenAPI spec not found at ${SPEC_PATH}`);
  }
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, "utf8"));
  const paths = spec && spec.paths ? spec.paths : {};

  await initDatabase();

  const seen = [];
  let created = 0;
  let write = 0;

  for (const [p, item] of Object.entries(paths)) {
    for (const method of WRITE_METHODS) {
      const op = item[method];
      if (!op) continue;
      // Public endpoints declare `security: []` — never a Praxis action.
      if (Array.isArray(op.security) && op.security.length === 0) continue;

      const module = (op.tags && op.tags[0]) || p.split("/")[1] || "misc";
      if (SKIP_MODULES.has(module)) continue;

      const action_key = `${module}.${method}_${slug(p)}`.slice(0, 120);
      const route = `${BASE_PREFIX}${toExpressRoute(p)}`;
      const title = op.summary || `${method.toUpperCase()} ${p}`;
      const description =
        `${op.summary || title}. ${method.toUpperCase()} ${route}` +
        (op.description ? ` — ${op.description}` : "");

      seen.push(action_key);
      await upsert({
        action_key,
        title,
        method: method.toUpperCase(),
        route,
        description: description.slice(0, 2000),
        module,
        payload_schema: jsonSchemaFor(op),
        required_permission: `${module}.${permWord(method, p)}`,
        ai_enabled: method !== "delete", // deletes are opt-in
      });
      created += 1;
      if (method !== "delete") write += 1;
    }
  }

  // Deactivate generated actions that vanished from the spec (keep hand-seeded
  // ones — those have action_keys we didn't emit; non-'write' categories are
  // left alone anyway).
  const del = await query(
    `UPDATE shared.ai_action_catalogue
        SET is_active = false, updated_at = now()
      WHERE category = 'write'
        AND route LIKE $1 || '%'
        AND action_key <> ALL($2::text[])
        AND is_active = true`,
    [BASE_PREFIX, seen],
  );

  // eslint-disable-next-line no-console
  console.log(
    `Action catalogue built from OpenAPI: ${created} write actions upserted ` +
      `(${write} ai_enabled by default, deletes opt-in), ` +
      `${del.rowCount} stale actions retired.`,
  );
}

main()
  .catch((err) => {
    /// eslint-disable-next-line no-console
    console.error("build-action-catalogue failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDatabase();
    } catch {
      /* ignore */
    }
  });
