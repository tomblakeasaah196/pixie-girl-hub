/**
 * Shop AI Search ("ask Praxis") — public, no account.
 *
 * The shop page's search box takes plain keywords ("burgundy bob") OR a
 * real-life ask ("what should I wear for a first date"). One Gemini text
 * turn per query: given a compact digest of the LIVE catalogue (names,
 * slugs, prices, shades, colours) plus the shopper's free text, the model
 * picks matching styles from a CLOSED ENUM of real slugs — the same
 * grounding contract as Shade Finder (src/modules/shade_finder) — so it can
 * never invent a product, price, shade, collection, or bundle.
 *
 * Stateless: the client resends the last few turns as `history` so a
 * shopper can refine ("something cheaper", "warmer tones") without the
 * server holding a session.
 */

"use strict";

const crypto = require("crypto");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { getClient: getRedis } = require("../../config/redis");
const { AppError } = require("../../utils/errors");
const { money, toCurrencyString } = require("../../utils/money");
const gemini = require("../../services/gemini.service");
const llm = require("../../services/llm.service");
const governance = require("../ai_governance/governance.service");
const repo = require("./storefront.repo");

const FEATURE_KEY = "shop_ai_search";
const MAX_RESULTS = 12;
const CATALOGUE_LIMIT = 300;

// ── Quota keys (mirrors shade_finder.service.js's device/IP scheme) ────

function deviceKeyFrom({ device_id, ip }) {
  const seed = String(device_id || "").trim() || `ip:${ip || "unknown"}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
}
function ipKeyFrom(ip) {
  return crypto
    .createHash("sha256")
    .update(String(ip || "unknown"))
    .digest("hex")
    .slice(0, 32);
}
function lagosDay(now = Date.now()) {
  return new Date(now + 3600_000).toISOString().slice(0, 10);
}
function secondsToLagosMidnight(now = Date.now()) {
  const shifted = now + 3600_000;
  const nextMidnight = new Date(shifted);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((nextMidnight.getTime() - shifted) / 1000));
}
const quotaKey = (kind, brand, who, day) => `sas:q:${kind}:${brand}:${who}:${day}`;

async function takeQuota({ key, limit, ttl }) {
  const redis = getRedis();
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, ttl);
  return { used: Math.min(n, limit), ok: n <= limit };
}
async function refundQuota(key) {
  try {
    const redis = getRedis();
    const n = await redis.decr(key);
    if (n < 0) await redis.del(key);
  } catch {
    /* refund is best-effort */
  }
}
function quotaSnapshot({ used }) {
  return {
    used,
    limit: config.SHOP_AI_SEARCH_DAILY_LIMIT,
    remaining: Math.max(0, config.SHOP_AI_SEARCH_DAILY_LIMIT - used),
    resets_in_seconds: secondsToLagosMidnight(),
  };
}

// ── Governance guard + metering (mirrors shade_finder.service.js) ──────

async function guardFeature() {
  const guard = await governance.canUseFeature({
    user_id: null,
    feature_key: FEATURE_KEY,
    is_ceo: true,
  });
  if (!guard.ok) {
    throw new AppError("AI_UNAVAILABLE", `shop ai search gated: ${guard.reason}`, 503, {
      user_message: "Praxis search is taking a short break — please try again soon.",
    });
  }
}

let cachedVendorRates = null;
async function vendorRates() {
  if (cachedVendorRates) return cachedVendorRates;
  try {
    const v = await llm.resolveVendor("gemini");
    cachedVendorRates = {
      in: v.cost_per_1k_input_tokens || 0,
      out: v.cost_per_1k_output_tokens || 0,
    };
  } catch {
    cachedVendorRates = { in: 0, out: 0 };
  }
  return cachedVendorRates;
}
async function recordUsageSafe({ brand, model, input_tokens, output_tokens }) {
  try {
    const rates = await vendorRates();
    const cost = toCurrencyString(
      money(input_tokens || 0)
        .div(1000)
        .times(money(rates.in))
        .plus(money(output_tokens || 0).div(1000).times(money(rates.out))),
    );
    await governance.recordUsage({
      usage: {
        user_id: null,
        feature_key: FEATURE_KEY,
        business: brand,
        provider: "gemini",
        model,
        call_type: "chat_completion",
        input_tokens: input_tokens || 0,
        output_tokens: output_tokens || 0,
        total_tokens: (input_tokens || 0) + (output_tokens || 0),
        cost_native: cost,
        cost_ngn: cost,
        was_successful: true,
      },
    });
  } catch (err) {
    logger.debug({ err: err.message }, "shop ai search usage record skipped");
  }
}

// ── LLM schema + prompt ─────────────────────────────────────

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Occasionally models wrap JSON in a fence despite the mime type.
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function searchSchema({ slugs, collectionSlugs, bundleCodes, shadeSlugs }) {
  return {
    type: "OBJECT",
    properties: {
      message: { type: "STRING" },
      product_slugs: { type: "ARRAY", items: { type: "STRING", enum: slugs } },
      matched_collection_slug: { type: "STRING", enum: [...collectionSlugs, ""] },
      matched_bundle_code: { type: "STRING", enum: [...bundleCodes, ""] },
      matched_shade_slug: { type: "STRING", enum: [...shadeSlugs, ""] },
      followup_question: { type: "STRING" },
    },
    required: ["message", "product_slugs"],
  };
}

function systemPrompt(brand) {
  const house = brand === "faitlynhair" ? "Faitlyn" : "Pixie Girl";
  return [
    `You are Praxis, the shopping stylist for ${house}'s storefront. A visitor`,
    "is searching the shop — they might type plain keywords ('burgundy bob') or",
    "a real-life ask ('what should I wear for a first date', 'something low",
    "maintenance for the gym', 'birthday look under 50k'). Read the intent —",
    "occasion, mood, colour, length, formality, budget — and pick the styles",
    "that best fit.",
    "You may ONLY pick from the products listed under CATALOGUE.styles —",
    "never invent a product, price, shade, collection, or bundle, and never",
    "recommend anything not in that list. If nothing truly fits, return an",
    "empty product_slugs array and say so warmly, optionally asking one",
    "clarifying question in followup_question.",
    "Keep `message` under 45 words, warm and confident like a stylist who",
    "gets it — no bullet lists, no markdown.",
    "Order product_slugs by how well they fit, best first, at most",
    `${MAX_RESULTS}.`,
    "Set matched_collection_slug / matched_bundle_code / matched_shade_slug to",
    "a value from CATALOGUE.collections / .bundles / .shades ONLY when the ask",
    "clearly centres on that one collection, bundle, or shade; otherwise leave",
    "them as empty strings.",
    "Respond with JSON only.",
  ].join(" ");
}

function catalogueContext({ products, collections, bundles, shades }) {
  return JSON.stringify({
    styles: products.map((p) => ({
      slug: p.slug,
      name: p.name,
      about: p.short_description || undefined,
      category: p.category_name || undefined,
      shade: p.shade_name || undefined,
      colours: p.colour_names || [],
      from_price_ngn: p.effective_price_ngn,
    })),
    collections: collections.map((c) => ({ slug: c.slug, name: c.name })),
    bundles: bundles.map((b) => ({ code: b.bundle_code, name: b.display_name })),
    shades: shades.map((s) => ({ slug: s.slug, name: s.name })),
  });
}

function publicMatch(list, key, value) {
  if (!value) return null;
  return list.find((x) => x[key] === value) || null;
}

// ── Public API ──────────────────────────────────────────────

/**
 * One search turn. `history` is client-held (the last few exchanges the
 * shopper already saw) so a follow-up can refine without a server session.
 */
async function search({ brand, device_id, ip, query: userQuery, history = [] }) {
  await guardFeature();

  const ttl = secondsToLagosMidnight();
  const deviceKey = deviceKeyFrom({ device_id, ip });
  const dayKey = quotaKey("d", brand, deviceKey, lagosDay());
  const ipKey = quotaKey("ip", brand, ipKeyFrom(ip), lagosDay());
  const [dev, ipCap] = await Promise.all([
    takeQuota({ key: dayKey, limit: config.SHOP_AI_SEARCH_DAILY_LIMIT, ttl }),
    takeQuota({ key: ipKey, limit: config.SHOP_AI_SEARCH_IP_DAILY_LIMIT, ttl }),
  ]);
  if (!dev.ok || !ipCap.ok) {
    throw new AppError("QUOTA_EXCEEDED", "shop ai search daily quota", 429, {
      user_message:
        "You've used today's free Praxis searches — plain search still works, and Praxis is back tomorrow ✨",
      metadata: quotaSnapshot({ used: config.SHOP_AI_SEARCH_DAILY_LIMIT }),
    });
  }

  try {
    const [products, collections, bundles, shades] = await Promise.all([
      repo.listCatalogueDigestForAI({ brand, limit: CATALOGUE_LIMIT }),
      repo.listCollections({ brand }),
      repo.listBundles({ brand }),
      repo.listShades({ brand }),
    ]);
    if (products.length === 0) {
      throw new AppError("NO_PRODUCTS", "empty catalogue", 503, {
        user_message: "The shop is being restocked right now — please check back shortly.",
      });
    }

    const schema = searchSchema({
      slugs: products.map((p) => p.slug),
      collectionSlugs: collections.map((c) => c.slug),
      bundleCodes: bundles.map((b) => b.bundle_code),
      shadeSlugs: shades.map((s) => s.slug),
    });

    const completion = await gemini.chatCompletion({
      system: systemPrompt(brand),
      messages: [
        {
          role: "user",
          content: `CATALOGUE: ${catalogueContext({ products, collections, bundles, shades })}`,
        },
        { role: "assistant", content: "Understood — I will only recommend from this catalogue." },
        ...history.slice(-6),
        { role: "user", content: userQuery },
      ],
      temperature: 0.5,
      maxOutputTokens: 1536,
      responseSchema: schema,
      // Structured extraction, not reasoning — see shade-finder's identical
      // note: without this, Gemini 2.5's default thinking can eat the whole
      // output budget and return an empty reply.
      thinkingBudget: 0,
    });
    await recordUsageSafe({
      brand,
      model: completion.model,
      input_tokens: completion.input_tokens,
      output_tokens: completion.output_tokens,
    });

    const advice = parseModelJson(completion.text);
    if (!advice || !advice.message) {
      throw new AppError("AI_UNAVAILABLE", "shop ai search parse failed", 503, {
        user_message: "Praxis lost its train of thought — please try again.",
      });
    }

    const slugs = (advice.product_slugs || []).slice(0, MAX_RESULTS);
    const cards = slugs.length ? await repo.getProductCardsBySlugs({ brand, slugs }) : [];
    const bySlug = new Map(cards.map((c) => [c.slug, c]));
    const ordered = slugs.map((s) => bySlug.get(s)).filter(Boolean);

    return {
      message: advice.message,
      followup_question: advice.followup_question || null,
      products: ordered,
      matched: {
        collection: publicMatch(collections, "slug", advice.matched_collection_slug),
        bundle: publicMatch(bundles, "bundle_code", advice.matched_bundle_code),
        shade: publicMatch(shades, "slug", advice.matched_shade_slug),
      },
      quota: quotaSnapshot({ used: dev.used }),
    };
  } catch (err) {
    // Refund the attempt on our own failures (AI down, bad parse) — not on
    // the shopper for a normal empty result, which resolves above already.
    if (!(err instanceof AppError) || err.code === "AI_UNAVAILABLE") {
      await refundQuota(dayKey);
      await refundQuota(ipKey);
    }
    if (err instanceof AppError) throw err;
    logger.error({ err: err.message }, "shop ai search failed");
    throw new AppError("AI_UNAVAILABLE", "shop ai search failed", 503, {
      user_message: "Praxis hit a snag — please try again.",
    });
  }
}

module.exports = {
  search,
  // exported for unit tests
  _internal: { lagosDay, secondsToLagosMidnight, parseModelJson, publicMatch, deviceKeyFrom },
};
