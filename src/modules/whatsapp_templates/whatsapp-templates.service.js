/**
 * WhatsApp Templates — business logic.
 *
 * A brand's approved-template library lives in two places:
 *
 *   • Meta (source of truth for approval status + the actual template
 *     that can be sent outside the 24h window), and
 *   • the Hub's local mirror (shared.whatsapp_templates), so the CEO
 *     can author drafts, see status at a glance, and the composer can
 *     list send-able templates without a live Graph round-trip.
 *
 * The two are reconciled with `sync()` (pull from Meta) and kept in
 * step on every create / edit / delete (push to Meta, mirror locally).
 *
 * Every template carries a category (MARKETING / UTILITY /
 * AUTHENTICATION) whose per-brand NGN cost lives in
 * shared.whatsapp_template_rates — so the UI shows what a send costs.
 */

"use strict";

const repo = require("./whatsapp-templates.repo");
const wa = require("../../services/whatsapp.service");
const { audit } = require("../../middleware/audit");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

// ── Helpers: parse Meta component shape ────────────────────

/** Pull the BODY text out of a Meta components array. */
function bodyTextOf(components) {
  const body = (components || []).find((c) => (c.type || "").toUpperCase() === "BODY");
  return body ? body.text || "" : "";
}

/**
 * WhatsApp templates use positional {{1}} {{2}} placeholders. Return
 * the sorted list of distinct indices used anywhere in the components.
 */
function variablesOf(components) {
  const text = (components || [])
    .map((c) => `${c.text || ""} ${(c.buttons || []).map((b) => b.url || b.text || "").join(" ")}`)
    .join(" ");
  const out = new Set();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m;
  while ((m = re.exec(text))) out.add(Number(m[1]));
  return Array.from(out).sort((a, b) => a - b);
}

/** Normalise a Meta template object into our mirror shape. */
function fromMetaShape(t) {
  return {
    meta_template_id: t.id || null,
    name: t.name,
    language: t.language,
    category: (t.category || "UTILITY").toUpperCase(),
    status: (t.status || "PENDING").toUpperCase(),
    components: t.components || [],
    body_text: bodyTextOf(t.components),
    variables: variablesOf(t.components),
    quality_score:
      (t.quality_score && (t.quality_score.score || t.quality_score)) || null,
    rejected_reason: t.rejected_reason || null,
  };
}

/** Meta returns validation errors nested; surface the human message. */
function metaError(err, fallback) {
  const apiErr = err.response && err.response.data && err.response.data.error;
  const status = err.response && err.response.status;
  const msg =
    (apiErr && (apiErr.error_user_msg || apiErr.message)) ||
    err.message ||
    fallback;
  return new AppError(
    "WA_TEMPLATE_API_ERROR",
    msg,
    status && status >= 400 && status < 500 ? status : 502,
  );
}

// ── Rates ──────────────────────────────────────────────────

async function getRateMap({ brand }) {
  const rows = await repo.listRates({ brand });
  const map = {};
  for (const r of rows) map[r.category] = r;
  return map;
}

/** Attach the per-category cost to a template row for the client. */
function decorateCost(tpl, rateMap) {
  const rate = rateMap[tpl.category];
  return {
    ...tpl,
    cost: rate
      ? { amount_ngn: rate.amount_ngn, currency: rate.currency || "NGN" }
      : null,
  };
}

async function listTemplates({ brand }) {
  const [rows, rateMap] = await Promise.all([
    repo.listTemplates({ brand }),
    getRateMap({ brand }),
  ]);
  return {
    templates: rows.map((t) => decorateCost(t, rateMap)),
    rates: Object.values(rateMap),
  };
}

async function listRates({ brand }) {
  return repo.listRates({ brand });
}

async function setRate({ brand, user, request_id, category, amount_ngn, note }) {
  const saved = await repo.upsertRate({
    brand,
    user_id: user.user_id,
    category,
    amount_ngn,
    note,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "whatsapp_templates.rate_set",
    target_type: "whatsapp_template_rate",
    target_id: saved.rate_id,
    after: { category, amount_ngn },
    request_id,
  });
  return saved;
}

// ── Templates ──────────────────────────────────────────────

/**
 * Create a template. Always mirrored locally; if `submit` is true and
 * WhatsApp is configured for the brand, it's also submitted to Meta and
 * flipped to PENDING with Meta's returned id.
 */
async function createTemplate({ brand, user, request_id, input }) {
  const components = input.components || [];
  const draft = {
    name: input.name,
    language: input.language,
    category: input.category,
    components,
    body_text: bodyTextOf(components),
    variables: variablesOf(components),
    status: "LOCAL_DRAFT",
  };

  let metaResult = null;
  if (input.submit) {
    try {
      metaResult = await wa.createTemplate({
        brand,
        name: input.name,
        language: input.language,
        category: input.category,
        components,
      });
      draft.status = (metaResult.status || "PENDING").toUpperCase();
    } catch (err) {
      logger.warn({ err: err.message, brand }, "whatsapp_templates.create submit failed");
      throw metaError(err, "Meta rejected the template submission");
    }
  }

  const saved = await repo.insertTemplate({ brand, user_id: user.user_id, input: draft });
  if (metaResult && metaResult.id) {
    await repo.updateTemplate({
      brand,
      id: saved.template_id,
      patch: { meta_template_id: metaResult.id },
    });
    saved.meta_template_id = metaResult.id;
  }

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "whatsapp_templates.create",
    target_type: "whatsapp_template",
    target_id: saved.template_id,
    after: { name: saved.name, category: saved.category, submitted: !!input.submit },
    request_id,
  });
  return saved;
}

/**
 * Edit a template. Local drafts are edited freely. A template already
 * on Meta (has meta_template_id) is edited on Meta too — Meta only
 * accepts category + component edits and re-opens review (PENDING).
 */
async function updateTemplate({ brand, user, request_id, id, input }) {
  const existing = await repo.getTemplate({ brand, id });
  if (!existing) throw new NotFoundError("WhatsApp template");

  const components = input.components || existing.components;
  const patch = {
    category: input.category,
    components: input.components ? components : undefined,
    body_text: input.components ? bodyTextOf(components) : undefined,
    variables: input.components ? variablesOf(components) : undefined,
  };

  const onMeta = existing.meta_template_id && existing.status !== "LOCAL_DRAFT";
  if (onMeta && input.submit) {
    try {
      await wa.editTemplate({
        brand,
        meta_template_id: existing.meta_template_id,
        category: input.category || existing.category,
        components,
      });
      patch.status = "PENDING";
      patch.rejected_reason = null;
    } catch (err) {
      logger.warn({ err: err.message, brand, id }, "whatsapp_templates.edit submit failed");
      throw metaError(err, "Meta rejected the template edit");
    }
  }

  const saved = await repo.updateTemplate({ brand, id, patch });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "whatsapp_templates.update",
    target_type: "whatsapp_template",
    target_id: id,
    after: { category: saved.category, status: saved.status },
    request_id,
  });
  return saved;
}

/**
 * Submit (or resubmit) an existing local draft to Meta for approval.
 */
async function submitTemplate({ brand, user, request_id, id }) {
  const existing = await repo.getTemplate({ brand, id });
  if (!existing) throw new NotFoundError("WhatsApp template");

  let metaResult;
  try {
    if (existing.meta_template_id) {
      metaResult = await wa.editTemplate({
        brand,
        meta_template_id: existing.meta_template_id,
        category: existing.category,
        components: existing.components,
      });
    } else {
      metaResult = await wa.createTemplate({
        brand,
        name: existing.name,
        language: existing.language,
        category: existing.category,
        components: existing.components,
      });
    }
  } catch (err) {
    logger.warn({ err: err.message, brand, id }, "whatsapp_templates.submit failed");
    throw metaError(err, "Meta rejected the template");
  }

  const saved = await repo.updateTemplate({
    brand,
    id,
    patch: {
      status: (metaResult.status || "PENDING").toUpperCase(),
      meta_template_id: metaResult.id || existing.meta_template_id,
      rejected_reason: null,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "whatsapp_templates.submit",
    target_type: "whatsapp_template",
    target_id: id,
    after: { status: saved.status },
    request_id,
  });
  return saved;
}

async function deleteTemplate({ brand, user, request_id, id }) {
  const existing = await repo.getTemplate({ brand, id });
  if (!existing) throw new NotFoundError("WhatsApp template");

  // Only reach out to Meta for templates that actually exist there.
  if (existing.meta_template_id || existing.status !== "LOCAL_DRAFT") {
    try {
      await wa.deleteTemplate({
        brand,
        name: existing.name,
        meta_template_id: existing.meta_template_id,
      });
    } catch (err) {
      // A 404 on Meta just means it's already gone — proceed to drop
      // the local mirror. Anything else is surfaced.
      const status = err.response && err.response.status;
      if (status !== 404) {
        logger.warn({ err: err.message, brand, id }, "whatsapp_templates.delete meta failed");
        throw metaError(err, "Meta could not delete the template");
      }
    }
  }

  await repo.deleteTemplate({ brand, id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "whatsapp_templates.delete",
    target_type: "whatsapp_template",
    target_id: id,
    after: { name: existing.name },
    request_id,
  });
}

/**
 * Pull every template from Meta and reconcile the local mirror. Returns
 * a small summary the UI can toast.
 */
async function sync({ brand, user, request_id }) {
  let metaTemplates;
  try {
    metaTemplates = await wa.listTemplates({ brand });
  } catch (err) {
    logger.warn({ err: err.message, brand }, "whatsapp_templates.sync failed");
    throw metaError(err, "Could not fetch templates from Meta");
  }

  let synced = 0;
  for (const t of metaTemplates) {
    await repo.upsertFromMeta({ brand, tpl: fromMetaShape(t) });
    synced += 1;
  }

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "whatsapp_templates.sync",
    target_type: "whatsapp_template",
    after: { synced },
    request_id,
  });
  return { synced };
}

module.exports = {
  listTemplates,
  listRates,
  setRate,
  createTemplate,
  updateTemplate,
  submitTemplate,
  deleteTemplate,
  sync,
};
