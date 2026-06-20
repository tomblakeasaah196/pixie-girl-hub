/**
 * Sales Campaigns v2 — Praxis assist service.
 *
 * Composes the existing LLM client (src/services/llm.service.chat) + the
 * RAG pipeline (src/ai/rag-pipeline.retrieve) + the metered-call wrapper
 * (src/ai/usage-meter.meteredCall) into sales-campaign-specific
 * primitives: draftCopy, suggestLayout, suggestPricing (deterministic),
 * dryRunPricing, analyticsQna, dailyBriefing.
 *
 * Every output respects the brand voice profile in
 * business_config.praxis_voice_profile and hard rails (no fabricated
 * reviews, no banned superlatives, no number below pricing_floors).
 *
 * All write-shaped suggestions return as DRAFT payloads (pending_acceptance
 * = true) — Praxis never finalises. The builder UI records the accepted
 * prompt + diff via recordAcceptance().
 */

"use strict";

const llm = require("../../services/llm.service");
const ragPipeline = require("../../ai/rag-pipeline");
const usageMeter = require("../../ai/usage-meter");
const businessSetupRepo = require("../business_setup/business-setup.repo");
const campaignsRepo = require("./campaigns.repo");
const pricing = require("./campaigns.pricing.service");
const { audit } = require("../../middleware/audit");
const { AppError, NotFoundError } = require("../../utils/errors");

const DEFAULT_VOICE = {
  tone: "editorial-luxury",
  tagline_pace: "restrained",
  banned_words: ["cheap", "amazing deal", "guaranteed", "best ever"],
  no_fabricated_reviews: true,
  exclamation_policy: "rare",
  sample_paragraphs: [],
};

async function loadVoiceProfile(brand, campaign) {
  if (campaign && campaign.voice_profile_override) {
    return { ...DEFAULT_VOICE, ...campaign.voice_profile_override };
  }
  const cfg = await businessSetupRepo.getConfig({ brand });
  return { ...DEFAULT_VOICE, ...(cfg?.praxis_voice_profile || {}) };
}

function systemPromptFromVoice(voice) {
  const banned = (voice.banned_words || []).join(", ");
  return [
    `You are Praxis, the in-Hub assistant drafting copy and layouts for sales campaigns.`,
    `Brand tone: ${voice.tone}. Tagline pace: ${voice.tagline_pace}.`,
    `Exclamation policy: ${voice.exclamation_policy} (rare = at most one across an entire page).`,
    voice.no_fabricated_reviews
      ? `NEVER invent customer reviews, ratings, testimonials, or quotes.`
      : "",
    banned ? `Banned vocabulary: ${banned}.` : "",
    `Refuse superlatives unsupported by evidence (no "best", "guaranteed", "amazing").`,
    voice.sample_paragraphs?.length
      ? `Voice samples:\n${voice.sample_paragraphs.map((s) => `- ${s}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function callLLM({
  feature_key,
  user,
  brand,
  is_ceo,
  messages,
  temperature = 0.4,
}) {
  const vendor = await llm.resolveVendor();
  if (!vendor) {
    // Graceful fallback when no AI vendor is configured (matches Praxis orchestrator's stub).
    return {
      content: "",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      model: "stub",
      stub: true,
    };
  }
  return usageMeter.meteredCall({
    feature_key,
    vendor: vendor.vendor_name || "praxis",
    model: vendor.default_model,
    user_id: user.user_id,
    business: brand,
    is_ceo,
    callFn: async () => {
      const out = await llm.chat({ vendor, messages, temperature });
      return {
        content: out.content,
        usage: out.usage,
        model: out.model,
        input_tokens: out.usage?.prompt_tokens || 0,
        output_tokens: out.usage?.completion_tokens || 0,
        total_tokens: out.usage?.total_tokens || 0,
      };
    },
  });
}

// ── Draft copy from a brief ──────────────────────────────
async function draftCopy({ brand, user, campaign_id, brief = {} }) {
  const campaign = await campaignsRepo.findById({ brand, id: campaign_id });
  if (!campaign) throw new NotFoundError("Campaign");
  const voice = await loadVoiceProfile(brand, campaign);

  const section = brief.section || "hero";
  const tone = brief.tone_override || voice.tone;
  const userMsg = [
    `Section: ${section}.`,
    `Brand voice: ${tone}.`,
    `Campaign: ${campaign.name}.`,
    brief.brief ? `Brief: ${brief.brief}.` : "",
    brief.campaign_theme ? `Theme: ${brief.campaign_theme}.` : "",
    brief.product_focus ? `Product focus: ${brief.product_focus}.` : "",
    brief.topics ? `Topics: ${JSON.stringify(brief.topics)}.` : "",
    section === "hero"
      ? `Return ONLY a JSON object: {"hero_title": "...", "hero_subtitle": "...", "cta_text": "..."}`
      : "",
    section === "faq"
      ? `Return ONLY a JSON object: {"items":[{"q":"...","a":"..."}, ...]} with 5-8 entries.`
      : "",
    section === "blast"
      ? `Return ONLY a JSON object: {"whatsapp":"...","email_subject":"...","email_body":"..."}`
      : "",
    section === "product_blurbs"
      ? `Return ONLY a JSON object: {"items":[{"product_id":"...","blurb":"..."}]}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await callLLM({
    feature_key: "sales_campaigns.draft_copy",
    user,
    brand,
    is_ceo: user.is_ceo,
    messages: [
      { role: "system", content: systemPromptFromVoice(voice) },
      { role: "user", content: userMsg },
    ],
    temperature: 0.6,
  });

  if (result.stub) {
    return {
      section,
      draft: null,
      voice_used: voice,
      pending_acceptance: true,
      drafted_by_ai: false,
      reason: "AI vendor not configured — set one in Settings → AI Control.",
    };
  }

  let parsed = null;
  const content = (result.content || "").trim();
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    throw new AppError(
      "LLM_PARSE_ERROR",
      "Praxis returned unparsable copy. Try again with a tighter brief.",
      502,
    );
  }
  parsed = stripBanned(parsed, voice.banned_words || []);

  return {
    section,
    draft: parsed,
    voice_used: voice,
    pending_acceptance: true,
    drafted_by_ai: true,
  };
}

// ── Suggest block layout ─────────────────────────────────
const BLOCK_LIBRARY = [
  "hero",
  "countdown",
  "bundle_showcase",
  "quantity_tier_visualiser",
  "featured_products",
  "lookbook_carousel",
  "stock_counter",
  "brand_story",
  "founder_quote",
  "why_buy",
  "testimonials",
  "ugc_carousel",
  "faq",
  "wig_care",
  "stylist_spotlight",
  "shipping_returns",
  "newsletter_capture",
  "vip_signup",
];

async function suggestLayout({ brand, user, campaign_id, brief = {} }) {
  const campaign = await campaignsRepo.findById({ brand, id: campaign_id });
  if (!campaign) throw new NotFoundError("Campaign");
  const voice = await loadVoiceProfile(brand, campaign);

  const userMsg = [
    `Campaign: ${campaign.name}.`,
    `Campaign type: ${brief.campaign_type || "flash_sale"}.`,
    `Duration hours: ${brief.duration_hours || 48}.`,
    `Product focus: ${brief.product_focus || "general"}.`,
    `Available blocks: ${BLOCK_LIBRARY.join(", ")}.`,
    `Return ONLY a JSON object: {"blocks":[{"key":"<block-key>","rationale":"<one short sentence>"}]}`,
    `Order from top of landing to bottom. Pick 6-10 blocks. 'hero' must be first.`,
  ].join("\n");

  const result = await callLLM({
    feature_key: "sales_campaigns.suggest_layout",
    user,
    brand,
    is_ceo: user.is_ceo,
    messages: [
      { role: "system", content: systemPromptFromVoice(voice) },
      { role: "user", content: userMsg },
    ],
    temperature: 0.3,
  });

  if (result.stub) {
    return {
      layout: defaultLayout(brief),
      pending_acceptance: true,
      drafted_by_ai: false,
      reason:
        "AI vendor not configured — returned the canonical default layout.",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJson(result.content));
  } catch {
    throw new AppError(
      "LLM_PARSE_ERROR",
      "Praxis returned an unparsable layout.",
      502,
    );
  }
  parsed.blocks = (parsed.blocks || []).filter((b) =>
    BLOCK_LIBRARY.includes(b.key),
  );
  if (!parsed.blocks.length) parsed.blocks = defaultLayout(brief);
  return {
    layout: parsed.blocks,
    pending_acceptance: true,
    drafted_by_ai: true,
  };
}

function defaultLayout(brief) {
  const type = brief.campaign_type || "flash_sale";
  if (type === "drop") {
    return [
      { key: "hero", rationale: "Cinematic anchor for the drop." },
      { key: "countdown", rationale: "Urgency clock to the end." },
      {
        key: "bundle_showcase",
        rationale: "Curated bundles take centre stage.",
      },
      { key: "lookbook_carousel", rationale: "Show how they wear." },
      { key: "founder_quote", rationale: "Trust + intent." },
      { key: "faq", rationale: "Pre-empt the friction questions." },
    ];
  }
  return [
    { key: "hero", rationale: "Headline + cinematic." },
    { key: "countdown", rationale: "Drives urgency." },
    { key: "bundle_showcase", rationale: "Faith's verbatim core feature." },
    {
      key: "quantity_tier_visualiser",
      rationale: "Surfaces the next ladder rung.",
    },
    { key: "featured_products", rationale: "Individual styled products." },
    { key: "lookbook_carousel", rationale: "Visual selling." },
    { key: "brand_story", rationale: "Why this drop matters." },
    { key: "faq", rationale: "Reduce checkout friction." },
  ];
}

// ── Suggest discount maths (deterministic — no LLM) ──────
async function suggestPricing({
  brand,
  // user,
  campaign_id,
  target_margin_pct,
  include_charm_rounding = true,
  inputs = [],
}) {
  const campaign = await campaignsRepo.findById({ brand, id: campaign_id });
  if (!campaign) throw new NotFoundError("Campaign");

  const results = inputs.map((it) => {
    const targetPrice = pricing.goalSeekPrice({
      cost_ngn: it.cost_ngn,
      freight_ngn: it.freight_ngn,
      target_margin_pct,
      discount_loss_pct: it.discount_loss_pct || 0,
      gateway_fee_pct: it.gateway_fee_pct || 0,
      gateway_fee_fixed: it.gateway_fee_fixed || 0,
      floor_ngn: it.floor_ngn || null,
    });
    const finalPrice = include_charm_rounding
      ? pricing.charmRound({
          price_ngn: targetPrice,
          strategy: it.charm_strategy || "nine_ninety",
          floor_ngn: it.floor_ngn || null,
        })
      : { rounded_ngn: targetPrice, below_floor: false };

    return {
      label: it.label || it.product_id || it.bundle_id,
      target_price_ngn: targetPrice,
      proposed_price_ngn: finalPrice.rounded_ngn,
      below_floor: finalPrice.below_floor,
      breakdown: {
        cost_ngn: it.cost_ngn,
        freight_ngn: it.freight_ngn || 0,
        target_margin_pct,
        discount_loss_pct: it.discount_loss_pct || 0,
        floor_ngn: it.floor_ngn || null,
        charm_strategy: it.charm_strategy || "nine_ninety",
      },
    };
  });

  const breached = results.filter((r) => r.below_floor);
  if (breached.length) {
    return {
      ok: false,
      reason: "BELOW_PRICE_FLOOR",
      breaches: breached.map((b) => ({
        label: b.label,
        proposed_price_ngn: b.proposed_price_ngn,
        floor_ngn: b.breakdown.floor_ngn,
      })),
      results,
      pending_acceptance: true,
      drafted_by_ai: true,
    };
  }

  return {
    ok: true,
    results,
    pending_acceptance: true,
    drafted_by_ai: true,
  };
}

// ── Dry-run pricing question ─────────────────────────────
async function dryRunPricing({
  brand,
  user,
  campaign_id,
  question,
  payload = {},
}) {
  const campaign = await campaignsRepo.findById({ brand, id: campaign_id });
  if (!campaign) throw new NotFoundError("Campaign");

  if (
    payload.proposed_price_ngn !== null &&
    payload.proposed_price_ngn !== undefined &&
    payload.floor_ngn !== null &&
    payload.floor_ngn !== undefined
  ) {
    const above =
      Number(payload.proposed_price_ngn) >= Number(payload.floor_ngn);
    return {
      answer: above
        ? `Yes — ₦${Number(payload.proposed_price_ngn).toLocaleString()} is above the floor of ₦${Number(payload.floor_ngn).toLocaleString()}.`
        : `No — ₦${Number(payload.proposed_price_ngn).toLocaleString()} falls below the floor of ₦${Number(payload.floor_ngn).toLocaleString()}. Raise the price by at least ₦${Math.ceil(Number(payload.floor_ngn) - Number(payload.proposed_price_ngn)).toLocaleString()}.`,
      above_floor: above,
      drafted_by_ai: false,
    };
  }

  const voice = await loadVoiceProfile(brand, campaign);
  let chunks = [];
  try {
    chunks = await ragPipeline.retrieve({
      brand,
      queryText: question,
      topK: 4,
    });
  } catch {
    chunks = [];
  }
  const ctx = (chunks || [])
    .map(
      (c) => `- [${c.title || c.source_ref || "context"}] ${c.content || ""}`,
    )
    .join("\n");

  const result = await callLLM({
    feature_key: "sales_campaigns.dry_run_pricing",
    user,
    brand,
    is_ceo: user.is_ceo,
    messages: [
      {
        role: "system",
        content: `${systemPromptFromVoice(voice)}\nAnswer dry-run pricing questions read-only. Cite which help article you grounded on. NEVER finalise a number that breaches pricing_floors.`,
      },
      {
        role: "user",
        content: `Question: ${question}\n\nContext:\n${ctx}\n\nAnswer briefly. Add explicit uncertainty disclaimers when the answer depends on data we don't have.`,
      },
    ],
    temperature: 0.2,
  });

  return {
    answer:
      result.content ||
      "Praxis is offline — set an AI vendor in Settings → AI Control to enable.",
    citations: (chunks || [])
      .map((c) => c.title || c.source_ref)
      .filter(Boolean),
    drafted_by_ai: !result.stub,
  };
}

// ── Analytics Q&A ────────────────────────────────────────
async function analyticsQna({ brand, user, campaign_id, question }) {
  const campaign = await campaignsRepo.findById({ brand, id: campaign_id });
  if (!campaign) throw new NotFoundError("Campaign");

  const metrics = {
    rollups: {
      total_visitors: campaign.total_visitors,
      total_unique_visitors: campaign.total_unique_visitors,
      total_signups: campaign.total_signups,
      total_add_to_cart: campaign.total_add_to_cart,
      total_orders: campaign.total_orders,
      total_revenue_ngn: campaign.total_revenue_ngn,
      total_discount_given_ngn: campaign.total_discount_given_ngn,
    },
    status: campaign.status,
    starts_at: campaign.starts_at,
    ends_at: campaign.ends_at,
  };

  const voice = await loadVoiceProfile(brand, campaign);
  const result = await callLLM({
    feature_key: "sales_campaigns.analytics_qna",
    user,
    brand,
    is_ceo: user.is_ceo,
    messages: [
      {
        role: "system",
        content: `${systemPromptFromVoice(voice)}\nAnswer analytics questions about a sales campaign. Always cite the numbers you used. For "why" questions, prefix hypotheses with "Not certain, possible reasons:".`,
      },
      {
        role: "user",
        content: `Question: ${question}\n\nMetrics:\n${JSON.stringify(metrics, null, 2)}\n\nAnswer in 2-4 sentences. Use NGN amounts in ₦#,###,###.`,
      },
    ],
    temperature: 0.3,
  });

  return {
    answer: result.content || "Praxis is offline.",
    metrics,
    drafted_by_ai: !result.stub,
  };
}

// ── Daily briefing ───────────────────────────────────────
async function dailyBriefing({ brand, user, campaign_id }) {
  const campaign = await campaignsRepo.findById({ brand, id: campaign_id });
  if (!campaign) throw new NotFoundError("Campaign");
  const voice = await loadVoiceProfile(brand, campaign);
  const yesterday = await campaignsRepo.listDailyMetrics({
    brand,
    campaign_id,
    from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });

  const result = await callLLM({
    feature_key: "sales_campaigns.daily_briefing",
    user,
    brand,
    is_ceo: user.is_ceo,
    messages: [
      {
        role: "system",
        content: `${systemPromptFromVoice(voice)}\nWrite the CEO's morning briefing in a single short paragraph + one recommended action.`,
      },
      {
        role: "user",
        content: `Campaign: ${campaign.name}\nYesterday's hourly metrics:\n${JSON.stringify(yesterday, null, 2)}\n\nWrite 4-6 sentences and end with one concrete action.`,
      },
    ],
    temperature: 0.4,
  });

  return {
    briefing: result.content || "Praxis is offline.",
    date: new Date().toISOString().slice(0, 10),
    drafted_by_ai: !result.stub,
  };
}

// ── Record accepted suggestion (audit) ───────────────────
async function recordAcceptance({
  brand,
  user,
  request_id,
  campaign_id,
  action_key,
  prompt,
  draft,
  accepted,
}) {
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: `sales_campaigns.ai_suggestion_accepted.${action_key}`,
    target_type: "sales_campaigns",
    target_id: campaign_id,
    before: draft,
    after: accepted,
    request_id,
    notes: prompt,
  });
}

// ── Helpers ──────────────────────────────────────────────
function extractJson(text) {
  const t = (text || "").trim();
  // Strip ```json fences if present.
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) return fenced[1];
  // Else assume already JSON.
  return t;
}

function stripBanned(payload, banned) {
  if (!banned.length) return payload;
  const re = new RegExp(`\\b(${banned.map(escapeRe).join("|")})\\b`, "ig");
  const recur = (v) => {
    if (typeof v === "string")
      return v
        .replace(re, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    if (Array.isArray(v)) return v.map(recur);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = recur(v[k]);
      return out;
    }
    return v;
  };
  return recur(payload);
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  loadVoiceProfile,
  draftCopy,
  suggestLayout,
  suggestPricing,
  dryRunPricing,
  analyticsQna,
  dailyBriefing,
  recordAcceptance,
  BLOCK_LIBRARY,
};
