/**
 * Products — AI drafting (V2.2 §6.4 / §6.29, P0-8-safe).
 *
 * Faith picks a base product; the model drafts a STYLED storefront listing
 * (name, copy, SEO, keywords, optional styling add-on price). The result is
 * always saved as a DRAFT for human review — the AI never publishes and
 * never executes any tool/write beyond creating that draft. Gated by the
 * `products_ai_drafting` feature (canUseFeature: flag + per-user grant +
 * budget); usage is metered best-effort.
 */

"use strict";

const catalogueRepo = require("./catalogue.repo");
const styled = require("./styled.service");
const governance = require("../ai_governance/governance.service");
const llm = require("../../services/llm.service");
const { logger } = require("../../config/logger");
const { AppError, NotFoundError } = require("../../utils/errors");

const FEATURE = "products_ai_drafting";

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
}

// Pull the first {...} block out of a model response, tolerating code
// fences or surrounding prose.
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function computeCostNative(vendor, usage) {
  const inRate = Number(vendor.cost_per_1k_input_tokens || 0);
  const outRate = Number(vendor.cost_per_1k_output_tokens || 0);
  const cost =
    ((usage.prompt_tokens || 0) / 1000) * inRate +
    ((usage.completion_tokens || 0) / 1000) * outRate;
  return cost.toFixed(6);
}

function buildMessages(base, input) {
  const facts = [
    ["Base name", base.name],
    ["Base code", base.product_code],
    ["Texture", base.texture_type],
    ["Lace", base.lace_type],
    ["Length (in)", base.hair_length_inches],
    ["Density", base.density],
    ["Cap size", base.cap_size],
    ["Colour", base.primary_colour],
    ["Origin", base.hair_origin],
    ["Care", base.care_instructions],
  ]
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const system =
    "You are a senior e-commerce copywriter for a luxury wig and hair brand. " +
    "Given a BASE product, write ONE storefront 'styled' listing. " +
    "Reply with STRICT JSON only — no prose, no code fences — using exactly " +
    "these keys: name (string), slug (kebab-case string), short_description " +
    "(string, <=300 chars), long_description (string), meta_title (string, " +
    "<=70 chars), meta_description (string, <=160 chars), search_keywords " +
    "(array of 3-8 short strings), style_addon_price_ngn (number, the extra " +
    "charge for this styling on top of the base price; 0 if none). " +
    "Do not invent stock, cost, or supplier information.";

  const user =
    `BASE PRODUCT FACTS:\n${facts || "(minimal)"}\n\n` +
    (input.instructions ? `STYLING BRIEF: ${input.instructions}\n\n` : "") +
    (input.tone ? `TONE: ${input.tone}\n\n` : "") +
    "Produce the JSON listing now.";

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function draftStyled({ brand, user, request_id, input }) {
  // 1. Gate: flag enabled + per-user grant (CEO bypasses) + budget.
  const guard = await governance.canUseFeature({
    user_id: user.user_id,
    feature_key: FEATURE,
    is_ceo: user.is_ceo,
  });
  if (!guard.ok) {
    throw new AppError(
      "AI_UNAVAILABLE",
      `AI drafting unavailable: ${guard.reason}`,
      403,
      {
        user_message: "AI drafting isn't available for your account right now.",
      },
    );
  }

  // 2. Ground the prompt on the real base product.
  const baseProd = await catalogueRepo.findProductById({
    brand,
    id: input.base_product_id,
  });
  if (!baseProd || baseProd.is_deleted) throw new NotFoundError("Base product");

  // 3. Resolve a configured vendor; no vendor → graceful unavailable.
  const vendor = await llm.resolveVendor(input.vendor);
  if (!vendor) {
    throw new AppError(
      "AI_UNAVAILABLE",
      "No AI vendor configured for drafting",
      503,
      { user_message: "AI drafting isn't configured yet." },
    );
  }

  // 4. Generate.
  let completion;
  try {
    completion = await llm.chat({
      vendor,
      messages: buildMessages(baseProd, input),
      temperature: 0.5,
    });
  } catch (err) {
    logger.error({ err: err.message }, "products: AI draft generation failed");
    throw new AppError("AI_DRAFT_FAILED", "AI draft generation failed", 502, {
      user_message: "The AI couldn't draft this right now. Please try again.",
    });
  }

  const parsed = extractJson(completion.content);
  if (!parsed || !parsed.name) {
    await recordUsageSafe({ user, brand, vendor, completion, ok: false });
    throw new AppError(
      "AI_DRAFT_UNPARSEABLE",
      "AI returned no usable draft",
      502,
      {
        user_message: "The AI draft came back malformed. Please try again.",
      },
    );
  }

  // 5. Save as a DRAFT (never live). Slug is made unique-ish to avoid
  // colliding with an existing listing; the human can refine it.
  const baseSlug = slugify(parsed.slug || parsed.name);
  const slug = `${baseSlug || "styled"}-${Math.random().toString(36).slice(2, 6)}`;
  const draftInput = {
    base_product_id: input.base_product_id,
    name: String(parsed.name).slice(0, 200),
    slug,
    short_description: parsed.short_description
      ? String(parsed.short_description).slice(0, 500)
      : undefined,
    long_description: parsed.long_description
      ? String(parsed.long_description).slice(0, 8000)
      : undefined,
    style_addon_price_ngn:
      typeof parsed.style_addon_price_ngn === "number" &&
      parsed.style_addon_price_ngn >= 0
        ? parsed.style_addon_price_ngn
        : undefined,
    category_id: input.category_id,
    meta_title: parsed.meta_title
      ? String(parsed.meta_title).slice(0, 200)
      : undefined,
    meta_description: parsed.meta_description
      ? String(parsed.meta_description).slice(0, 500)
      : undefined,
    search_keywords: Array.isArray(parsed.search_keywords)
      ? parsed.search_keywords.map((k) => String(k)).slice(0, 12)
      : undefined,
  };

  const created = await styled.create({
    brand,
    user,
    request_id,
    input: draftInput,
    ai: { model: completion.model, confidence: 0.75 },
  });

  await recordUsageSafe({ user, brand, vendor, completion, ok: true });

  return { draft: created, generated: parsed };
}

async function recordUsageSafe({ user, brand, vendor, completion, ok }) {
  try {
    const usage = completion ? completion.usage || {} : {};
    const cost = vendor ? computeCostNative(vendor, usage) : "0";
    await governance.recordUsage({
      usage: {
        user_id: user.user_id,
        feature_key: FEATURE,
        business: brand,
        provider: vendor ? vendor.vendor : null,
        model: completion ? completion.model : null,
        call_type: "draft_generation",
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
        cost_native: cost,
        cost_ngn: cost,
        was_successful: ok,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, "products: AI usage record failed");
  }
}

module.exports = { draftStyled, extractJson, slugify };
