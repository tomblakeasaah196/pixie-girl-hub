/**
 * Shade Finder (Praxis Shade Match) — service layer.
 *
 * Public, conversational "upload a photo → get your shade + exact products"
 * for the storefront. Anyone can use it (no account); a guest session token
 * scopes the chat and Redis holds the (photo-free) conversation state.
 *
 * Pipeline per photo:
 *   1. PERCEIVE  — Gemini Flash vision extracts colour attributes only
 *                  (undertone, depth, hair colour, lighting) as strict JSON.
 *   2. MATCH     — deterministic CIELAB ΔE ranks OUR active shades against
 *                  the perceived hexes (colour-distance.js). No AI here.
 *   3. ADVISE    — Gemini text turn composes the conversational reply, but
 *                  every shade/product it may name is a closed enum of live
 *                  catalogue slugs — it cannot invent inventory.
 *
 * Privacy: the photo is processed entirely in memory (multer memoryStorage →
 * sharp downscale → Gemini inline bytes) and never written to disk, storage,
 * or Redis. EXIF (incl. GPS) is stripped by re-encoding. Only derived colour
 * attributes persist, and those die with the session (TTL or explicit end).
 *
 * Limits: 10 photo analyses per device per day (Africa/Lagos midnight reset),
 * an IP ceiling backstop, and a separate cap on follow-up text turns.
 */

"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const sharp = require("sharp");

const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { getClient: getRedis } = require("../../config/redis");
const { AppError } = require("../../utils/errors");
const { money, toCurrencyString } = require("../../utils/money");
const gemini = require("../../services/gemini.service");
const llm = require("../../services/llm.service");
const { compressImage } = require("../../services/media-compression.service");
const governance = require("../ai_governance/governance.service");
const repo = require("./shade-finder.repo");
const events = require("./shade-finder.events");
const { rankShadesByDistance } = require("./colour-distance");

const FEATURE_KEY = "shade_finder";

const PRIVACY_NOTICE =
  "Your photo is analysed in memory and never saved — it is discarded the " +
  "moment the analysis completes. The chat itself keeps only colour notes " +
  "(never the image), and everything is deleted when you end the session " +
  "or it expires.";

// ── Session + quota keys ────────────────────────────────────

const sessKey = (sid) => `sf:sess:${sid}`;
const quotaKey = (kind, brand, who, day) => `sf:q:${kind}:${brand}:${who}:${day}`;

/** Lagos is fixed UTC+1 (no DST) — day string + seconds to its midnight. */
function lagosDay(now = Date.now()) {
  return new Date(now + 3600_000).toISOString().slice(0, 10);
}
function secondsToLagosMidnight(now = Date.now()) {
  const shifted = now + 3600_000;
  const nextMidnight = new Date(shifted);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((nextMidnight.getTime() - shifted) / 1000));
}

function deviceKeyFrom({ device_id, ip }) {
  const seed = String(device_id || "").trim() || `ip:${ip || "unknown"}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
}
function ipKeyFrom(ip) {
  return crypto.createHash("sha256").update(String(ip || "unknown")).digest("hex").slice(0, 32);
}

async function readCount(key) {
  const v = await getRedis().get(key);
  return v ? parseInt(v, 10) || 0 : 0;
}

/**
 * INCR-then-check so concurrent requests cannot slip under the limit. The
 * attempt is counted even when rejected (counting attempts, not successes,
 * is what blunts abuse); genuine pipeline failures are refunded explicitly.
 */
async function takeQuota({ key, limit, ttl }) {
  const redis = getRedis();
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, ttl);
  return { used: Math.min(n, limit), ok: n <= limit };
}
async function refundQuota(key) {
  try {
    const n = await getRedis().decr(key);
    if (n < 0) await getRedis().del(key);
  } catch {
    /* refund is best-effort */
  }
}

function quotaSnapshot({ used }) {
  return {
    used,
    limit: config.SHADE_FINDER_DAILY_LIMIT,
    remaining: Math.max(0, config.SHADE_FINDER_DAILY_LIMIT - used),
    resets_in_seconds: secondsToLagosMidnight(),
  };
}

// ── Guest tokens ────────────────────────────────────────────

function signGuestToken({ sid, brand, deviceKey }) {
  return jwt.sign(
    { typ: "shade_guest", sid, brand, dk: deviceKey },
    config.JWT_SECRET,
    { expiresIn: config.SHADE_FINDER_SESSION_TTL_S },
  );
}

/** Shared with the public socket namespace — returns payload or null. */
function verifyGuestToken(token) {
  try {
    const p = jwt.verify(token, config.JWT_SECRET);
    return p && p.typ === "shade_guest" && p.sid ? p : null;
  } catch {
    return null;
  }
}

// ── Session state (Redis, photo-free) ───────────────────────

async function loadSession(sid) {
  const raw = await getRedis().get(sessKey(sid));
  return raw ? JSON.parse(raw) : null;
}
async function saveSession(sid, state) {
  await getRedis().set(
    sessKey(sid),
    JSON.stringify(state),
    "EX",
    config.SHADE_FINDER_SESSION_TTL_S,
  );
}

// ── Governance guard + metering ─────────────────────────────

/**
 * Public visitors have no user row, so the per-user grant layer does not
 * apply — is_ceo:true skips exactly that check while the feature flag toggle
 * and the monthly budget hard cap still gate the call.
 */
async function guardFeature() {
  const guard = await governance.canUseFeature({
    user_id: null,
    feature_key: FEATURE_KEY,
    is_ceo: true,
  });
  if (!guard.ok) {
    throw new AppError("AI_UNAVAILABLE", `shade finder gated: ${guard.reason}`, 503, {
      user_message: "Praxis is taking a short break — please try again soon.",
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
      money(input_tokens || 0).div(1000).times(money(rates.in)).plus(
        money(output_tokens || 0).div(1000).times(money(rates.out)),
      ),
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
    logger.debug({ err: err.message }, "shade finder usage record skipped");
  }
}

// ── Stage events (→ public socket room) ─────────────────────

function emitStage(brand, sid, stage, extra = {}) {
  events.emit("session.stage", { brand, session_id: sid, stage, ...extra });
}
function emitReply(brand, sid, result) {
  events.emit("session.reply", { brand, session_id: sid, result });
}

// ── Image preparation (in-memory only) ──────────────────────

/**
 * HEIC-decode + EXIF-rotate via the shared compressor, then downscale to
 * ≤1024px JPEG for the vision call. Re-encoding drops all metadata (GPS
 * included). Returns { data (base64), mime_type } — never touches disk.
 */
async function prepareImage({ buffer, mime, filename }) {
  const pre = await compressImage(buffer, mime, filename);
  const out = await sharp(pre.buffer, { failOn: "none" })
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { data: out.toString("base64"), mime_type: "image/jpeg" };
}

// ── LLM schemas + prompts ───────────────────────────────────

const PERCEIVE_SCHEMA = {
  type: "OBJECT",
  properties: {
    subject_present: { type: "BOOLEAN" },
    skin: {
      type: "OBJECT",
      properties: {
        undertone: {
          type: "STRING",
          enum: ["warm", "cool", "neutral", "olive", "unclear"],
        },
        depth: { type: "INTEGER" },
        hex_estimate: { type: "STRING" },
      },
      required: ["undertone", "depth", "hex_estimate"],
    },
    hair: {
      type: "OBJECT",
      properties: {
        visible: { type: "BOOLEAN" },
        description: { type: "STRING" },
        hex_estimate: { type: "STRING" },
      },
      required: ["visible"],
    },
    lighting: {
      type: "STRING",
      enum: ["good", "dim", "harsh", "colour_cast"],
    },
    confidence: { type: "NUMBER" },
    notes: { type: "STRING" },
  },
  required: ["subject_present", "skin", "lighting", "confidence"],
};

const PERCEIVE_SYSTEM = [
  "You are a beauty-tech colour analyst for a hair and beauty retailer.",
  "From the photo, extract ONLY colour attributes useful for shade matching:",
  "skin undertone (warm/cool/neutral/olive), skin depth on a 1 (very fair) to",
  "10 (very deep) scale, an sRGB hex estimate of the skin's midtone, and the",
  "hair's visible colour with a hex estimate. Be precise and well calibrated",
  "across the full range of deep skin tones — this audience is predominantly",
  "Nigerian and accuracy on deep complexions is the primary quality bar.",
  "Account for lighting: if it is dim, harsh, or colour-cast, say so and",
  "lower confidence. Never guess identity, age, gender, or anything beyond",
  "colour. If no person/hair is clearly visible set subject_present=false.",
  "Respond with JSON only.",
].join(" ");

function adviseSchema({ shadeSlugs, productSlugs }) {
  return {
    type: "OBJECT",
    properties: {
      message: { type: "STRING" },
      recommended_shade_slug: { type: "STRING", enum: shadeSlugs },
      alternate_shade_slugs: {
        type: "ARRAY",
        items: { type: "STRING", enum: shadeSlugs },
      },
      product_slugs: {
        type: "ARRAY",
        items: { type: "STRING", enum: productSlugs },
      },
      confidence: { type: "STRING", enum: ["low", "medium", "high"] },
      followup_question: { type: "STRING" },
    },
    required: ["message", "recommended_shade_slug", "product_slugs", "confidence"],
  };
}

function adviseSystem(brand) {
  const house =
    brand === "faitlynhair"
      ? "Faitlyn — a premium wig and hair brand"
      : "Pixie Girl — a premium hair and beauty brand";
  return [
    `You are Praxis, the personal shade stylist for ${house}, chatting with a`,
    "shopper on the storefront. Voice: warm, confident, personal — like a",
    "great in-store stylist. Keep replies under 110 words, no lists unless",
    "asked, one emoji at most.",
    "You are given the shopper's analysed colouring, the boutique's shade",
    "families (with colour-distance hints, lower ΔE = closer to the shopper's",
    "own colouring), and the live styles in those shades with prices in NGN.",
    "Recommend the single most flattering shade using real colour logic:",
    "undertone harmony first (warm undertones → warm/golden families, cool →",
    "ash/icy/plum, neutral/olive → most ranges), then depth contrast — deep",
    "complexions carry both rich darks and bold vivids beautifully; suggest",
    "gentle contrast rather than an exact skin match for hair. Use the ΔE",
    "hints to pick a natural blend when the shopper wants subtle, and to",
    "deliberately depart from them when they ask for bold.",
    "Pick 2–4 specific styles from the list that best express the shade.",
    "You may ONLY reference shades and styles from the provided lists — never",
    "invent names, prices, or availability. If lighting made the analysis",
    "uncertain, say so honestly, keep confidence low, and ask one clarifying",
    "question in followup_question. Respond with JSON only.",
  ].join(" ");
}

function catalogueContext({ shades, ranked, products }) {
  const deltaBySlug = new Map(ranked.map((r) => [r.slug, r.delta_e]));
  return JSON.stringify({
    shades: shades.map((s) => ({
      slug: s.slug,
      name: s.name,
      about: s.short_description || undefined,
      colourways: (s.swatches || []).map((w) => w.name).slice(0, 12),
      delta_e_hint: deltaBySlug.get(s.slug),
      styles_available: s.product_count,
    })),
    styles: products.map((p) => ({
      slug: p.slug,
      name: p.name,
      shade_slug: (shades.find((s) => s.shade_id === p.shade_id) || {}).slug,
      from_price_ngn: p.effective_price_ngn,
      colours: (p.colours || []).map((c) => c.name).slice(0, 8),
    })),
  });
}

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

// ── Result hydration ────────────────────────────────────────

function publicShade(s) {
  if (!s) return null;
  return {
    shade_id: s.shade_id,
    name: s.name,
    slug: s.slug,
    short_description: s.short_description,
    cover_image_url: s.cover_image_url,
    product_count: s.product_count,
    swatches: (s.swatches || []).slice(0, 10),
    deeplink: `/shades/${s.slug}`,
  };
}
function publicProduct(p) {
  return {
    styled_id: p.styled_id,
    name: p.name,
    slug: p.slug,
    short_description: p.short_description,
    retail_price_ngn: p.retail_price_ngn,
    retail_price_usd: p.retail_price_usd,
    effective_price_ngn: p.effective_price_ngn,
    effective_price_usd: p.effective_price_usd,
    cover_image_url: p.cover_image_url,
    colours: (p.colours || []).slice(0, 8),
    deeplink: `/product/${p.slug}`,
  };
}

function hydrate({ advice, shades, products }) {
  const shadeBySlug = new Map(shades.map((s) => [s.slug, s]));
  const productBySlug = new Map(products.map((p) => [p.slug, p]));
  const shade = publicShade(shadeBySlug.get(advice.recommended_shade_slug));
  const alternates = (advice.alternate_shade_slugs || [])
    .filter((sl) => sl !== advice.recommended_shade_slug && shadeBySlug.has(sl))
    .slice(0, 2)
    .map((sl) => publicShade(shadeBySlug.get(sl)));
  let picks = (advice.product_slugs || [])
    .filter((sl) => productBySlug.has(sl))
    .slice(0, 4)
    .map((sl) => publicProduct(productBySlug.get(sl)));
  // The model picked nothing usable → fall back to the shade's own styles.
  if (picks.length === 0 && shade) {
    picks = products
      .filter((p) => p.shade_id === shade.shade_id)
      .slice(0, 4)
      .map(publicProduct);
  }
  return {
    message: advice.message,
    confidence: advice.confidence,
    followup_question: advice.followup_question || null,
    shade,
    alternates,
    products: picks,
  };
}

// ── Public API ──────────────────────────────────────────────

async function startSession({ brand, device_id, ip }) {
  await guardFeature();
  const deviceKey = deviceKeyFrom({ device_id, ip });
  const sid = crypto.randomUUID();
  await saveSession(sid, {
    brand,
    created_at: new Date().toISOString(),
    perceived: null,
    history: [],
    last_result: null,
  });
  const used = await readCount(
    quotaKey("d", brand, deviceKey, lagosDay()),
  );
  const shades = await repo.listActiveShadesWithSwatches({ brand });
  return {
    session_id: sid,
    guest_token: signGuestToken({ sid, brand, deviceKey }),
    expires_in_seconds: config.SHADE_FINDER_SESSION_TTL_S,
    privacy: PRIVACY_NOTICE,
    quota: quotaSnapshot({ used }),
    shades: shades.map(publicShade),
  };
}

async function getSessionState({ brand, sid, deviceKey }) {
  const state = await loadSession(sid);
  if (!state || state.brand !== brand) {
    throw new AppError("SESSION_EXPIRED", "shade session missing", 404, {
      user_message: "This styling session has ended — start a fresh one.",
    });
  }
  const used = await readCount(quotaKey("d", brand, deviceKey, lagosDay()));
  return {
    history: state.history,
    last_result: state.last_result,
    has_photo_analysis: !!state.perceived,
    quota: quotaSnapshot({ used }),
    privacy: PRIVACY_NOTICE,
  };
}

async function endSession({ brand, sid }) {
  await getRedis().del(sessKey(sid));
  emitStage(brand, sid, "ended");
  return {
    deleted: true,
    message:
      "All done — this session's chat and colour notes have been deleted.",
  };
}

/** Shared tail of analyze/chat: advise call → hydrate → persist → emit. */
async function adviseAndReply({
  brand,
  sid,
  state,
  userText,
  shades,
  ranked,
  products,
}) {
  const schema = adviseSchema({
    shadeSlugs: shades.map((s) => s.slug),
    productSlugs: products.map((p) => p.slug),
  });
  const history = (state.history || []).slice(-8);
  const completion = await gemini.chatCompletion({
    system: adviseSystem(brand),
    messages: [
      {
        role: "user",
        content:
          `SHOPPER_ANALYSIS: ${JSON.stringify(state.perceived || {})}\n` +
          `CATALOGUE: ${catalogueContext({ shades, ranked, products })}`,
      },
      { role: "assistant", content: "Understood — I will only recommend from this catalogue." },
      ...history,
      { role: "user", content: userText },
    ],
    temperature: 0.6,
    maxOutputTokens: 2048,
    responseSchema: schema,
    // See analyzePhoto: thinking off so the token budget is all answer.
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
    throw new AppError("AI_UNAVAILABLE", "advise parse failed", 503, {
      user_message: "Praxis lost its train of thought — please try again.",
    });
  }
  const result = hydrate({ advice, shades, products });

  state.history = [
    ...(state.history || []),
    { role: "user", content: userText },
    { role: "assistant", content: advice.message },
  ].slice(-12);
  state.last_result = result;
  await saveSession(sid, state);

  emitReply(brand, sid, result);
  emitStage(brand, sid, "done");
  return result;
}

async function analyzePhoto({ brand, sid, deviceKey, ip, file, message }) {
  await guardFeature();

  const ttl = secondsToLagosMidnight();
  const dayKey = quotaKey("d", brand, deviceKey, lagosDay());
  const ipCap = await takeQuota({
    key: quotaKey("ip", brand, ipKeyFrom(ip), lagosDay()),
    limit: config.SHADE_FINDER_IP_DAILY_LIMIT,
    ttl,
  });
  const dev = await takeQuota({
    key: dayKey,
    limit: config.SHADE_FINDER_DAILY_LIMIT,
    ttl,
  });
  if (!dev.ok || !ipCap.ok) {
    throw new AppError("QUOTA_EXCEEDED", "shade finder daily quota", 429, {
      user_message:
        "You've used today's free shade analyses — Praxis will be ready for you again tomorrow ✨",
      metadata: quotaSnapshot({ used: config.SHADE_FINDER_DAILY_LIMIT }),
    });
  }

  const state = await loadSession(sid);
  if (!state || state.brand !== brand) {
    await refundQuota(dayKey);
    throw new AppError("SESSION_EXPIRED", "shade session missing", 404, {
      user_message: "This styling session has ended — start a fresh one.",
    });
  }

  emitStage(brand, sid, "reading_photo");
  try {
    const img = await prepareImage({
      buffer: file.buffer,
      mime: file.mimetype,
      filename: file.originalname,
    });

    const perception = await gemini.chatCompletion({
      system: PERCEIVE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", mime_type: img.mime_type, data: img.data },
            {
              type: "text",
              text: message
                ? `Shopper note: ${message}`
                : "Analyse for shade matching.",
            },
          ],
        },
      ],
      temperature: 0.15,
      maxOutputTokens: 1024,
      responseSchema: PERCEIVE_SCHEMA,
      // Structured extraction, not reasoning — without this, Gemini 2.5's
      // default thinking can consume the whole output budget and return an
      // empty reply (HTTP 200, finishReason=MAX_TOKENS, no text).
      thinkingBudget: 0,
    });
    await recordUsageSafe({
      brand,
      model: perception.model,
      input_tokens: perception.input_tokens,
      output_tokens: perception.output_tokens,
    });

    const perceived = parseModelJson(perception.text);
    if (!perceived) {
      throw new AppError("AI_UNAVAILABLE", "perceive parse failed", 503, {
        user_message: "Praxis couldn't read that photo — please try again.",
      });
    }
    if (!perceived.subject_present) {
      // Not the shopper's fault in a way worth charging for — refund.
      await refundQuota(dayKey);
      const used = await readCount(dayKey);
      const gentle = {
        message:
          "I couldn't quite see you in that photo. Try a clear, front-facing shot in natural light — I promise it's worth it 💛",
        confidence: "low",
        followup_question: null,
        shade: null,
        alternates: [],
        products: [],
      };
      emitReply(brand, sid, gentle);
      emitStage(brand, sid, "done");
      return { ...gentle, quota: quotaSnapshot({ used }), privacy: PRIVACY_NOTICE };
    }

    emitStage(brand, sid, "matching_shades");
    const shades = await repo.listActiveShadesWithSwatches({ brand });
    if (shades.length === 0) {
      throw new AppError("NO_SHADES", "no active shades", 503, {
        user_message:
          "Our shade guide is being restocked right now — please check back shortly.",
      });
    }
    const targets = [
      perceived.skin && perceived.skin.hex_estimate,
      perceived.hair && perceived.hair.visible && perceived.hair.hex_estimate,
    ].filter(Boolean);
    const ranked = rankShadesByDistance(shades, targets);

    emitStage(brand, sid, "picking_styles");
    const products = await repo.listProductsForShades({
      brand,
      shade_ids: shades.map((s) => s.shade_id),
    });

    // Persist only derived attributes — the image buffer goes out of scope
    // here and is never stored anywhere.
    state.perceived = {
      undertone: perceived.skin.undertone,
      depth: perceived.skin.depth,
      skin_hex: perceived.skin.hex_estimate,
      hair: perceived.hair || { visible: false },
      lighting: perceived.lighting,
      confidence: perceived.confidence,
      notes: perceived.notes,
    };

    const result = await adviseAndReply({
      brand,
      sid,
      state,
      userText: message || "[shared a photo for shade matching]",
      shades,
      ranked,
      products,
    });
    const used = await readCount(dayKey);
    return {
      ...result,
      perceived: {
        undertone: state.perceived.undertone,
        depth: state.perceived.depth,
        lighting: state.perceived.lighting,
      },
      quota: quotaSnapshot({ used }),
      privacy: PRIVACY_NOTICE,
    };
  } catch (err) {
    emitStage(brand, sid, "error");
    if (!(err instanceof AppError) || err.code === "AI_UNAVAILABLE") {
      await refundQuota(dayKey);
    }
    if (err instanceof AppError) throw err;
    logger.error({ err: err.message }, "shade finder analyze failed");
    throw new AppError("AI_UNAVAILABLE", "shade finder pipeline failed", 503, {
      user_message: "Praxis hit a snag reading that photo — please try again.",
    });
  }
}

async function chatTurn({ brand, sid, deviceKey, message }) {
  await guardFeature();

  const ttl = secondsToLagosMidnight();
  const chatKey = quotaKey("c", brand, deviceKey, lagosDay());
  const cap = await takeQuota({
    key: chatKey,
    limit: config.SHADE_FINDER_CHAT_DAILY_LIMIT,
    ttl,
  });
  if (!cap.ok) {
    throw new AppError("QUOTA_EXCEEDED", "shade finder chat quota", 429, {
      user_message:
        "We've chatted lots today! Praxis will be ready for more tomorrow ✨",
    });
  }

  const state = await loadSession(sid);
  if (!state || state.brand !== brand) {
    throw new AppError("SESSION_EXPIRED", "shade session missing", 404, {
      user_message: "This styling session has ended — start a fresh one.",
    });
  }

  emitStage(brand, sid, "thinking");
  try {
    const shades = await repo.listActiveShadesWithSwatches({ brand });
    if (shades.length === 0) {
      throw new AppError("NO_SHADES", "no active shades", 503, {
        user_message:
          "Our shade guide is being restocked right now — please check back shortly.",
      });
    }
    const targets = state.perceived
      ? [state.perceived.skin_hex, state.perceived.hair && state.perceived.hair.hex_estimate].filter(Boolean)
      : [];
    const ranked = rankShadesByDistance(shades, targets);
    const products = await repo.listProductsForShades({
      brand,
      shade_ids: shades.map((s) => s.shade_id),
    });
    const result = await adviseAndReply({
      brand,
      sid,
      state,
      userText: message,
      shades,
      ranked,
      products,
    });
    const used = await readCount(quotaKey("d", brand, deviceKey, lagosDay()));
    return { ...result, quota: quotaSnapshot({ used }), privacy: PRIVACY_NOTICE };
  } catch (err) {
    emitStage(brand, sid, "error");
    if (err instanceof AppError) throw err;
    logger.error({ err: err.message }, "shade finder chat failed");
    throw new AppError("AI_UNAVAILABLE", "shade finder chat failed", 503, {
      user_message: "Praxis lost its train of thought — please try again.",
    });
  }
}

module.exports = {
  PRIVACY_NOTICE,
  startSession,
  getSessionState,
  endSession,
  analyzePhoto,
  chatTurn,
  verifyGuestToken,
  deviceKeyFrom,
  // exported for unit tests
  _internal: { lagosDay, secondsToLagosMidnight, hydrate, parseModelJson },
};
