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
 * Praxis is also the brand's consultant, not just a shade matcher: every
 * advise turn is grounded by the Brand Brain (brand-brain.js) — live
 * services, bundles, collections, published FAQ/care/policy content and
 * contact identity — under the same closed-reference rule, so it can talk
 * about the whole brand yet can only cite pages and facts that exist.
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
const {
  loadBrandBrain,
  composeBrandContext,
  resolveReferences,
} = require("./brand-brain");

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

// ── WhatsApp fallback contact ───────────────────────────────

/**
 * Normalise a Brand Profile phone number (Settings → Business Setup →
 * Profile) into wa.me's digits-only, country-coded format. This platform
 * serves Nigerian businesses only, so a local 0-prefixed number is assumed
 * Nigerian (+234); anything already carrying a country code passes through
 * with punctuation stripped.
 */
function toWhatsAppDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("0") ? `234${digits.slice(1)}` : digits;
}

/**
 * When Praxis genuinely can't respond, the shopper should never hit a dead
 * end — the storefront offers a "continue on WhatsApp" escape hatch using
 * the brand's own contact number instead of a hardcoded support line, so it
 * always matches whatever the business has set in its Brand Profile. Never
 * throws: a lookup failure just means no WhatsApp button is offered.
 */
async function resolveWhatsAppSupport({ brand }) {
  try {
    const identity = await repo.getBrandIdentity({ brand });
    const phone = identity && identity.phone ? String(identity.phone).trim() : null;
    if (!phone) return null;
    const wa_number = toWhatsAppDigits(phone);
    return wa_number ? { phone, wa_number } : null;
  } catch (err) {
    logger.debug(
      { err: err.message, brand },
      "shade finder whatsapp support lookup skipped",
    );
    return null;
  }
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

/**
 * gemini.service.js attaches the real diagnosis (HTTP status + Google's own
 * api_message — "API key not valid", "RESOURCE_EXHAUSTED", "model not
 * found", …) to errors it throws, but the generic `err.message` string alone
 * doesn't carry that through to this module's own log line. Logging the full
 * shape here means a plain grep on "shade finder … failed" is enough to tell
 * a real outage (bad key / quota / model) apart from a one-off hiccup —
 * instead of every failure looking identically opaque.
 */
function logPipelineFailure(event, err) {
  logger.error(
    {
      err: err.message,
      code: err.code,
      status: err.status,
      api_message: err.api_message,
      retryable: err.retryable,
    },
    event,
  );
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

function adviseSchema({ shadeSlugs, productSlugs, referenceKeys }) {
  return {
    type: "OBJECT",
    properties: {
      // "chat" = answer conversationally with NO shade card (greetings,
      // questions, small talk). "recommendation" = the shopper wants a shade
      // and/or styles, so name one. Only a recommendation renders a card.
      reply_kind: { type: "STRING", enum: ["chat", "recommendation"] },
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
      // Closed enum of THIS turn's brand-brain refs (real pages only) — the
      // UI renders these as tappable chips, and the server re-validates, so
      // Praxis can never offer a link that doesn't exist.
      reference_keys: {
        type: "ARRAY",
        items: { type: "STRING", enum: referenceKeys },
      },
      confidence: { type: "STRING", enum: ["low", "medium", "high"] },
      followup_question: { type: "STRING" },
    },
    // Only the prose + kind are mandatory; a chat turn legitimately omits the
    // shade/products so we no longer force a card onto every reply.
    required: ["reply_kind", "message", "confidence"],
  };
}

function adviseSystem({ brand, brandName }) {
  const house =
    brandName ||
    (brand === "faitlynhair"
      ? "Faitlyn — a premium wig and hair brand"
      : "Pixie Girl — a premium hair and beauty brand");
  return [
    // WHO — stylist first, seller second, consultant always.
    `You are Praxis — the personal stylist and brand consultant for ${house},`,
    "chatting with a shopper on the storefront. You have the warmth and craft",
    "of the best salon consultant they've ever met: you listen first, you",
    "remember everything they tell you, and you only ever say what you'd",
    "stake your reputation on.",
    // HOW YOU TALK — the conversational craft.
    "TALK LIKE A PERSON, never a bot: use contractions, mirror the shopper's",
    "energy and length — brief when they're brief, playful when they're",
    "playful. One clear thought per reply and at most ONE question. Never",
    "re-introduce yourself or re-greet mid-conversation. Weave in what they",
    "already told you (occasion, vibe, budget, their photo) instead of asking",
    "again. No bullet lists unless they ask. Keep replies under 120 words,",
    "one emoji at most.",
    // HOW YOU CONSULT — the selling posture.
    "CONSULT, don't push: understand the occasion, the vibe and the budget",
    "before recommending. Tie every suggestion to something they actually",
    "said. Guide the natural journey — chat, then a photo, then their shade,",
    "then the styles that carry it, and only where it genuinely helps, a",
    "bundle or a salon service. Never pressure, never invent urgency, never",
    "offer a discount or promise that is not in your knowledge.",
    // WHAT YOU KNOW — the hard grounding line.
    "YOUR KNOWLEDGE: BRAND_KNOWLEDGE and CATALOGUE are your complete and only",
    "knowledge of this brand. General hair wisdom — undertones, textures,",
    "care principles — is your craft and always fine to share. But brand",
    "specifics (prices, stock, delivery, policies, discounts, locations,",
    "services) may ONLY come from those blocks. If the answer isn't there,",
    "say so plainly and warmly, and point to the most relevant reference or",
    "the support contact — never guess, never improvise a fact. Scalp or",
    "skin conditions: recommend a professional, give no diagnosis. Off-topic",
    "requests: one warm line steering back to hair and the brand.",
    "REFERENCES: reference_keys may carry up to 3 keys, chosen ONLY from the",
    "(ref …) markers and ref lists in BRAND_KNOWLEDGE, and only when tapping",
    "through genuinely helps the shopper act on your reply.",
    // Shade decisioning — unchanged colour logic.
    "You are given the shopper's analysed colouring, the boutique's shade",
    "families (with colour-distance hints, lower ΔE = closer to the shopper's",
    "own colouring), and the live styles in those shades with prices in NGN",
    "and USD.",
    "FIRST decide reply_kind. Set reply_kind='chat' when the shopper is just",
    "talking — greetings, thanks, brand questions, care questions, or 'can we",
    "chat' — and answer warmly in `message` with NO shade or products; leave",
    "recommended_shade_slug and product_slugs empty. Set",
    "reply_kind='recommendation' only when they actually want a shade or",
    "styles (including a shared photo, or a refinement like 'something",
    "warmer' or 'anything cheaper').",
    "When recommending, choose the single most flattering shade using real",
    "colour logic: undertone harmony first (warm undertones → warm/golden",
    "families, cool → ash/icy/plum, neutral/olive → most ranges), then depth",
    "contrast — deep complexions carry both rich darks and bold vivids",
    "beautifully; suggest gentle contrast rather than an exact skin match for",
    "hair. Use the ΔE hints to pick a natural blend when the shopper wants",
    "subtle, and depart from them when they ask for bold.",
    "REFINEMENTS: if CURRENT_SHADE is given and the shopper asks for something",
    "different (warmer, cooler, lighter, darker, richer, or just 'another'),",
    "you MUST pick a recommended_shade_slug that is NOT CURRENT_SHADE, moving",
    "in the direction they asked. Never re-offer the same shade you just gave.",
    "BUDGET: the styles list already excludes anything over the shopper's",
    "stated budget when BUDGET is present, so pick only from what is listed",
    "and quote prices in the currency they used. If the list is empty, say so",
    "honestly in a chat reply and offer to widen the budget or shade — do not",
    "invent a style.",
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
      from_price_usd: p.effective_price_usd,
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

// ── Intent, budget & refinement (deterministic, no LLM) ─────

const REFINE_RE =
  /\b(warmer|cooler|colder|lighter|darker|richer|deeper|brighter|softer|bolder|different|another|something else|anything else|not (?:this|that)|change it)\b/i;

/** True when the turn asks to move off the current recommendation. */
function isRefinement(text) {
  return REFINE_RE.test(String(text || ""));
}

/**
 * Parse an upper price bound from free text, e.g. "under $280",
 * "less than 280 dollars", "below ₦200k", "cheaper than 200000 naira".
 * Currency is taken from an explicit marker; absent one, magnitude decides
 * (this catalogue's NGN prices are ≫1000, USD ≪1000). Returns
 * { currency: 'USD'|'NGN', max } or null when no bound is expressed.
 */
function parsePriceConstraint(text) {
  const s = String(text || "").toLowerCase();
  const m = s.match(
    /(?:under|below|less than|lower than|cheaper than|max(?:imum)?|up to|within|no more than|<=?)\s*(?:of\s*)?([₦$])?\s*([0-9][0-9,.]*)\s*(k|thousand)?\s*(usd|ngn|naira|dollars?|bucks?|\$|₦)?/,
  );
  if (!m) return null;
  let amount = parseFloat(m[2].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (m[3]) amount *= 1000; // "200k" → 200000
  const marker = `${m[1] || ""} ${m[4] || ""}`;
  let currency = null;
  if (/\$|usd|dollar|buck/.test(marker)) currency = "USD";
  else if (/₦|ngn|naira/.test(marker)) currency = "NGN";
  if (!currency) currency = amount < 1000 ? "USD" : "NGN";
  return { currency, max: amount };
}

const BUDGET_CLEAR_RE =
  /\b(any (?:price|budget)|no budget|ignore (?:the |my )?budget|forget (?:the |my )?budget|remove (?:the |my )?(?:budget|limit)|price (?:doesn'?t|does not) matter|whatever it costs|no (?:price )?limit|budget'?s? (?:gone|off|removed))\b/i;

/**
 * A stated budget is a conversation fact, not a single-turn filter: "under
 * ₦200k" then "okay show me braids" must still respect ₦200k. A newly parsed
 * bound replaces the saved one; an explicit release ("any price is fine")
 * clears it; otherwise the saved bound carries forward.
 * Returns { constraint, save } — constraint applies this turn, save persists.
 */
function resolveBudget({ text, saved }) {
  const parsed = parsePriceConstraint(text);
  if (parsed) return { constraint: parsed, save: parsed };
  if (BUDGET_CLEAR_RE.test(String(text || ""))) {
    return { constraint: null, save: null };
  }
  return { constraint: saved || null, save: saved || null };
}

/** Within an upper bound in the constraint's currency. Unpriced → excluded. */
function withinBudget(product, constraint) {
  if (!constraint) return true;
  const raw =
    constraint.currency === "USD"
      ? product.effective_price_usd
      : product.effective_price_ngn;
  if (raw === null || raw === undefined) return false;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) && n <= constraint.max + 1e-9;
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
    budget: null,
  });
  const used = await readCount(
    quotaKey("d", brand, deviceKey, lagosDay()),
  );
  const [shades, whatsapp_support] = await Promise.all([
    repo.listActiveShadesWithSwatches({ brand }),
    resolveWhatsAppSupport({ brand }),
  ]);
  return {
    session_id: sid,
    guest_token: signGuestToken({ sid, brand, deviceKey }),
    expires_in_seconds: config.SHADE_FINDER_SESSION_TTL_S,
    privacy: PRIVACY_NOTICE,
    quota: quotaSnapshot({ used }),
    shades: shades.map(publicShade),
    whatsapp_support,
    max_photo_mb: config.SHADE_FINDER_MAX_PHOTO_MB,
  };
}

async function getSessionState({ brand, sid, deviceKey }) {
  const state = await loadSession(sid);
  if (!state || state.brand !== brand) {
    throw new AppError("SESSION_EXPIRED", "shade session missing", 404, {
      user_message: "This styling session has ended — start a fresh one.",
    });
  }
  const [used, whatsapp_support] = await Promise.all([
    readCount(quotaKey("d", brand, deviceKey, lagosDay())),
    resolveWhatsAppSupport({ brand }),
  ]);
  return {
    history: state.history,
    last_result: state.last_result,
    has_photo_analysis: !!state.perceived,
    quota: quotaSnapshot({ used }),
    privacy: PRIVACY_NOTICE,
    whatsapp_support,
    max_photo_mb: config.SHADE_FINDER_MAX_PHOTO_MB,
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
  forceRecommend = false,
}) {
  // Deterministic pre-processing: honour a price ceiling (remembered across
  // turns until released) and know the shade we last showed so a refinement
  // ("something warmer") is forced to move off it.
  const budget = resolveBudget({ text: userText, saved: state.budget });
  const constraint = budget.constraint;
  state.budget = budget.save;
  const affordable = constraint
    ? products.filter((p) => withinBudget(p, constraint))
    : products;
  const currentSlug =
    (state.last_result && state.last_result.shade && state.last_result.shade.slug) ||
    null;
  const refine = !!currentSlug && isRefinement(userText);
  const shadeBySlug = new Map(shades.map((s) => [s.slug, s]));
  const affordableShadeIds = new Set(affordable.map((p) => p.shade_id));
  const shadeHasAffordable = (slug) => {
    const sh = shadeBySlug.get(slug);
    return !!sh && affordableShadeIds.has(sh.shade_id);
  };

  // Brand brain: everything Praxis may say about the brand beyond shades —
  // services, bundles, policies, contact, published FAQ/care content. The
  // previous user turn rides along so follow-ups ("and how much is that?")
  // still route to the right topic. A brain failure degrades to pages-only.
  const brain = await loadBrandBrain({ brand });
  const prevUser = [...(state.history || [])]
    .reverse()
    .find((m) => m.role === "user");
  const brandCtx = composeBrandContext({
    brain,
    text: `${prevUser ? prevUser.content : ""}\n${userText}`,
  });
  const referenceKeys = [...brandCtx.refs.keys()];

  // The model may only offer styles the shopper can actually afford. Keep the
  // enum non-empty even when nothing qualifies (an empty enum is invalid) — the
  // budget hint + the hard gate below stop an over-budget style being shown.
  const budgetBlocksAll = !!constraint && affordable.length === 0;
  const schema = adviseSchema({
    shadeSlugs: shades.map((s) => s.slug),
    productSlugs: (affordable.length ? affordable : products).map((p) => p.slug),
    referenceKeys,
  });
  const hints = [
    `SHOPPER_ANALYSIS: ${JSON.stringify(state.perceived || {})}`,
    `CATALOGUE: ${catalogueContext({ shades, ranked, products: affordable })}`,
    `BRAND_KNOWLEDGE:\n${brandCtx.block}`,
  ];
  if (currentSlug) hints.push(`CURRENT_SHADE: ${currentSlug}`);
  if (refine) {
    hints.push(
      `REFINEMENT: the shopper wants a DIFFERENT shade than CURRENT_SHADE — choose another that fits their request.`,
    );
  }
  if (constraint) {
    hints.push(
      `BUDGET: only styles at or under ${constraint.max} ${constraint.currency} are listed` +
        (affordable.length === 0
          ? " — none qualify, so reply as chat and say so honestly."
          : "; quote prices in that currency."),
    );
  }
  const history = (state.history || []).slice(-12);
  const completion = await gemini.chatCompletion({
    system: adviseSystem({
      brand,
      brandName: brain && brain.identity ? brain.identity.name : null,
    }),
    messages: [
      { role: "user", content: hints.join("\n") },
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
    // gemini.service.js already warns when the reply is empty (with
    // finish/block reason); this covers the other case — a non-empty reply
    // that didn't parse as the expected JSON shape — which otherwise leaves
    // no trace of what the model actually sent back.
    logger.warn(
      { model: completion.model, text_length: (completion.text || "").length },
      "shade finder advise: model reply was empty or unparseable",
    );
    throw new AppError("AI_UNAVAILABLE", "advise parse failed", 503, {
      user_message: "Praxis lost its train of thought — please try again.",
    });
  }

  // A refinement must not re-serve the same shade; if the model did (or the
  // budget wiped out its pick), deterministically move to the next viable one.
  if (
    advice.reply_kind === "recommendation" &&
    refine &&
    (advice.recommended_shade_slug === currentSlug ||
      !shadeHasAffordable(advice.recommended_shade_slug))
  ) {
    const alt =
      (advice.alternate_shade_slugs || []).find(
        (sl) => sl && sl !== currentSlug && shadeBySlug.has(sl) && shadeHasAffordable(sl),
      ) ||
      ranked
        .map((r) => r.slug)
        .find((sl) => sl !== currentSlug && shadeBySlug.has(sl) && shadeHasAffordable(sl));
    if (alt) {
      advice.recommended_shade_slug = alt;
      advice.product_slugs = []; // re-pick from the new shade's affordable styles
      advice.alternate_shade_slugs = (advice.alternate_shade_slugs || []).filter(
        (sl) => sl !== alt,
      );
    }
  }

  // A shared photo is always a match request: pin it to a recommendation and,
  // if the model somehow named no shade, use the closest-ranked one.
  if (forceRecommend) {
    advice.reply_kind = "recommendation";
    if (!advice.recommended_shade_slug || !shadeBySlug.has(advice.recommended_shade_slug)) {
      const top = (ranked.find((r) => shadeBySlug.has(r.slug)) || {}).slug;
      advice.recommended_shade_slug = top || shades[0].slug;
    }
  }

  // Only a genuine recommendation with a real shade renders a card. Chat turns
  // (greetings, questions, or an unmet budget) return prose alone.
  const canRecommend =
    !budgetBlocksAll &&
    advice.reply_kind === "recommendation" &&
    advice.recommended_shade_slug &&
    shadeBySlug.has(advice.recommended_shade_slug);
  const result = canRecommend
    ? hydrate({ advice, shades, products: affordable })
    : {
        message: advice.message,
        confidence: advice.confidence,
        followup_question: advice.followup_question || null,
        shade: null,
        alternates: [],
        products: [],
      };
  // Belt-and-braces: never let an over-budget style slip through.
  if (constraint) {
    const priced = new Map(products.map((p) => [p.slug, p]));
    result.products = (result.products || []).filter((p) =>
      withinBudget(priced.get(p.slug) || p, constraint),
    );
  }

  // Validated brand refs (tappable chips) — only keys offered this turn
  // survive, so a reply can never link to a page that doesn't exist.
  result.references = resolveReferences({
    keys: advice.reference_keys,
    refs: brandCtx.refs,
  });

  state.history = [
    ...(state.history || []),
    { role: "user", content: userText },
    { role: "assistant", content: advice.message },
  ].slice(-20);
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
      forceRecommend: true,
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
    logPipelineFailure("shade finder analyze failed", err);
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
    logPipelineFailure("shade finder chat failed", err);
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
  _internal: {
    lagosDay,
    secondsToLagosMidnight,
    hydrate,
    parseModelJson,
    parsePriceConstraint,
    withinBudget,
    isRefinement,
    resolveBudget,
    toWhatsAppDigits,
  },
};
