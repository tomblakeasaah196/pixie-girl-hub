/**
 * Brand Brain — the grounding layer that lets Praxis talk about the WHOLE
 * brand (services, bundles, collections, policies, care content, contact
 * details) without ever inventing a fact.
 *
 * Design:
 *   1. loadBrandBrain()      — assemble a knowledge pack from LIVE, public,
 *                              admin-managed data only (business_config,
 *                              service_offerings, bundles, collections,
 *                              published content posts). Redis-cached ~5min.
 *   2. composeBrandContext() — per turn, select ONLY the sections relevant
 *                              to what the shopper just said (deterministic
 *                              keyword routing, no extra LLM call) under a
 *                              hard character budget.
 *   3. Reference registry    — every fact block carries a stable ref key
 *                              (service:slug, bundle:CODE, page:contact, …)
 *                              mapping to a REAL storefront route. The model
 *                              may only cite keys offered this turn (closed
 *                              enum), and the server re-validates — a link
 *                              Praxis offers can never 404.
 *
 * Anti-hallucination stance: when a topic matches but the brand has
 *  published nothing about it, the context says so explicitly and tells the
 * model to admit the gap and hand over to the contact page / support email.
 * Absence of knowledge is surfaced, never papered over.
 */

"use strict";

const { logger } = require("../../config/logger");
const { getClient: getRedis } = require("../../config/redis");
const storefrontRepo = require("../storefront/storefront.repo");
const repo = require("./shade-finder.repo");

const BRAIN_TTL_S = 300; // content changes rarely; 5 min staleness is fine
const brainKey = (brand) => `sf:brain:${brand}`;

// Hard character budgets so the grounding block can never blow the prompt.
const SECTION_CHAR_CAP = 2200;
const BLOCK_CHAR_CAP = 7000;
const EXCERPT_CHARS = 420;

// ── Static page registry ────────────────────────────────────
// Routes that exist unconditionally on the storefront (policies render
// built-in copy even before a CMS post is published for them).

const STATIC_PAGES = [
  { key: "page:shades", label: "Browse all shades", href: "/shades" },
  { key: "page:shop", label: "Shop all styles", href: "/shop" },
  { key: "page:services", label: "Salon services", href: "/services" },
  { key: "page:bundles", label: "Bundles & sets", href: "/bundles" },
  { key: "page:collections", label: "Collections", href: "/collections" },
  { key: "page:journal", label: "The Journal", href: "/journal" },
  { key: "page:about", label: "Our story", href: "/about" },
  { key: "page:contact", label: "Contact us", href: "/contact" },
  { key: "policy:shipping", label: "Shipping policy", href: "/policies/shipping" },
  { key: "policy:returns", label: "Returns & refunds", href: "/policies/returns" },
  { key: "policy:cancellation", label: "Cancellation policy", href: "/policies/cancellation" },
  { key: "policy:privacy", label: "Privacy policy", href: "/policies/privacy" },
  { key: "policy:terms", label: "Terms of service", href: "/policies/terms" },
];

// ── Pack assembly ───────────────────────────────────────────

const trim = (s, n = EXCERPT_CHARS) => {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

function identityFrom(row) {
  if (!row) return null;
  let providers = [];
  try {
    // payment_methods is an operator-managed JSONB blob; only its keys are
    // safe/meaningful publicly ("paystack", "opay", "bank_transfer", …).
    providers = Object.keys(row.payment_methods || {}).filter(Boolean);
  } catch {
    providers = [];
  }
  return {
    name: row.display_name,
    support_email: row.support_email || row.email || null,
    phone: row.phone || null,
    address: row.address || null,
    website: row.website || row.storefront_domain || null,
    mission: row.mission_statement || null,
    payment_providers: providers,
  };
}

/**
 * Build the full knowledge pack for a brand from live data. Sources fail
 * independently (Promise.allSettled) — a broken one degrades to empty
 * rather than taking the conversation down.
 */
async function buildBrain({ brand }) {
  const [identity, services, bundles, collections, posts] =
    await Promise.allSettled([
      repo.getBrandIdentity({ brand }),
      repo.listPublicServices({ brand }),
      storefrontRepo.listBundles({ brand }),
      storefrontRepo.listCollections({ brand }),
      repo.listPublishedPosts({
        brand,
        types: ["faq", "guide", "journal", "blog", "policy", "press"],
      }),
    ]).then((r) => r.map((x) => (x.status === "fulfilled" ? x.value : null)));

  const byType = (type) =>
    (posts || []).filter((p) => p.post_type === type);

  return {
    identity: identityFrom(identity),
    services: (services || []).map((s) => ({
      slug: s.slug,
      name: s.name,
      about: trim(s.short_description, 200),
      price_ngn: s.base_price_ngn,
      price_is_from: !!s.price_is_from,
      duration_minutes: s.duration_minutes,
      location_type: s.location_type,
      deposit_required: !!s.deposit_required,
      deposit_pct: s.deposit_pct,
      whats_included: trim(s.whats_included, 260),
      aftercare: trim(s.aftercare_notes, 260),
    })),
    bundles: (bundles || []).map((b) => ({
      code: b.bundle_code,
      name: b.display_name,
      about: trim(b.description, 200),
      price_ngn: b.bundle_price_ngn,
      pricing_model: b.pricing_model,
      discount_value: b.discount_value,
      components: (b.components || []).map((c) => c.name).filter(Boolean),
    })),
    collections: (collections || []).map((c) => ({
      slug: c.slug,
      name: c.name,
      about: trim(c.description, 200),
    })),
    faqs: byType("faq").map((p) => ({
      slug: p.slug,
      category: p.faq_category || null,
      question: p.faq_question || p.title,
      answer: trim(p.body || p.excerpt),
    })),
    guides: byType("guide").map((p) => ({
      slug: p.slug,
      title: p.title,
      summary: trim(p.excerpt || p.body),
    })),
    journal: [...byType("journal"), ...byType("blog")].slice(0, 8).map((p) => ({
      slug: p.slug,
      type: p.post_type,
      title: p.title,
      summary: trim(p.excerpt || p.body, 200),
    })),
    policies: byType("policy").map((p) => ({
      slug: p.slug,
      title: p.title,
      summary: trim(p.excerpt || p.body, 600),
    })),
  };
}

/** Redis-cached brain. Any failure returns a minimal pack, never throws. */
async function loadBrandBrain({ brand }) {
  try {
    const cached = await getRedis().get(brainKey(brand));
    if (cached) return JSON.parse(cached);
  } catch {
    /* cache is best-effort */
  }
  try {
    const brain = await buildBrain({ brand });
    try {
      await getRedis().set(
        brainKey(brand),
        JSON.stringify(brain),
        "EX",
        BRAIN_TTL_S,
      );
    } catch {
      /* cache is best-effort */
    }
    return brain;
  } catch (err) {
    logger.warn({ err: err.message, brand }, "brand brain build failed");
    return null;
  }
}

// ── Per-turn topic routing ──────────────────────────────────

const TOPICS = [
  {
    key: "shipping",
    test: /\b(ship|shipping|deliver|delivery|dispatch|arriv|track|tracking|courier|how long|when will|abroad|international|worldwide|outside nigeria|lagos|abuja|port ?harcourt)\b/i,
    faqCats: ["shipping"],
    policyKeys: ["policy:shipping"],
    gap: "delivery timelines or fees",
  },
  {
    key: "returns",
    test: /\b(return|refund|exchange|swap|cancel|cancellation|wrong (?:item|order|colour|color)|damaged|money back)\b/i,
    faqCats: ["returns"],
    policyKeys: ["policy:returns", "policy:cancellation"],
    gap: "returns, refunds or cancellations",
  },
  {
    key: "care",
    test: /\b(care|wash|washing|condition|detangl|maintain|maintenance|sleep|night|revamp|lifespan|how long (?:does|do|will).*(last|wear)|store|storage|shed|tangle|frizz|heat|style it)\b/i,
    faqCats: ["care"],
    policyKeys: [],
    gap: "wig care",
    guides: true,
  },
  {
    key: "services",
    test: /\b(service|install|installation|appointment|book|booking|salon|studio|revamp|colou?r service|customi[sz]|styling session|home service)\b/i,
    services: true,
    pageKeys: ["page:services"],
    gap: "salon services",
  },
  {
    key: "bundles",
    test: /\b(bundle|deal|package|combo|set|gift|discount|promo|offer|save)\b/i,
    bundles: true,
    pageKeys: ["page:bundles"],
    gap: "bundles or current offers",
  },
  {
    key: "collections",
    test: /\b(collection|new in|latest|drop|lookbook|trending|what'?s new|journal|blog|article)\b/i,
    collections: true,
    journal: true,
    pageKeys: ["page:collections", "page:journal"],
    gap: "collections or editorial",
  },
  {
    key: "payment",
    test: /\b(pay|payment|paystack|opay|nomba|stripe|transfer|card|instal?lment|deposit|usd|dollar|naira|checkout)\b/i,
    payment: true,
    faqCats: ["payment", "sizing"],
    policyKeys: [],
    gap: "payment options",
  },
  {
    key: "brand",
    test: /\b(about|who (?:are|is)|your (?:story|brand)|where (?:are|is)|located|location|address|phone|email|contact|human|agent|someone|complain|complaint|speak to)\b/i,
    contact: true,
    pageKeys: ["page:about", "page:contact"],
    gap: "the brand",
  },
];

const naira = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? `₦${n.toLocaleString("en-NG")}` : null;
};

function serviceLine(s) {
  const bits = [
    s.about,
    s.price_ngn !== null && s.price_ngn !== undefined
      ? `${s.price_is_from ? "from " : ""}${naira(s.price_ngn)}`
      : null,
    s.duration_minutes ? `${s.duration_minutes} min` : null,
    s.location_type ? `location: ${s.location_type}` : null,
    s.deposit_required
      ? `deposit ${s.deposit_pct ? `${s.deposit_pct}%` : "required"}`
      : null,
    s.whats_included ? `includes: ${s.whats_included}` : null,
    s.aftercare ? `aftercare: ${s.aftercare}` : null,
  ].filter(Boolean);
  return `- (ref service:${s.slug}) ${s.name} — ${bits.join("; ")}`;
}

function bundleLine(b) {
  const bits = [
    b.about,
    b.price_ngn !== null && b.price_ngn !== undefined
      ? naira(b.price_ngn)
      : null,
    b.components.length ? `contains: ${b.components.join(", ")}` : null,
  ].filter(Boolean);
  return `- (ref bundle:${b.code}) ${b.name} — ${bits.join("; ")}`;
}

/**
 * Compose the per-turn BRAND_KNOWLEDGE block.
 *
 * @param {object|null} brain  loadBrandBrain() output (null degrades cleanly)
 * @param {string} text        current turn + a little trailing history
 * @returns {{ block: string, refs: Map<string,{label:string,href:string,kind:string}> }}
 */
function composeBrandContext({ brain, text }) {
  const refs = new Map();
  for (const p of STATIC_PAGES) {
    refs.set(p.key, {
      label: p.label,
      href: p.href,
      kind: p.key.split(":")[0],
    });
  }

  const lines = [];
  const id = brain && brain.identity;
  if (id) {
    const capsule = [
      `Brand: ${id.name}.`,
      id.mission ? `Mission: ${trim(id.mission, 180)}` : null,
      id.support_email ? `Support email: ${id.support_email}.` : null,
      id.phone ? `Phone: ${id.phone}.` : null,
      id.address ? `Address: ${trim(id.address, 160)}.` : null,
      id.payment_providers.length
        ? `Payments accepted via: ${id.payment_providers.join(", ")}.`
        : null,
    ].filter(Boolean);
    lines.push(`IDENTITY: ${capsule.join(" ")}`);
  }

  // Topic index — so the model knows what it CAN look up, and that anything
  // beyond this list is out of its knowledge.
  const counts = brain
    ? [
        brain.services.length && `${brain.services.length} salon services`,
        brain.bundles.length && `${brain.bundles.length} live bundles`,
        brain.collections.length && `${brain.collections.length} collections`,
        brain.faqs.length && `${brain.faqs.length} published FAQs`,
        brain.guides.length && `${brain.guides.length} care guides`,
        brain.journal.length && `${brain.journal.length} journal posts`,
      ].filter(Boolean)
    : [];
  lines.push(
    `KNOWLEDGE COVERS: shades & styles (see CATALOGUE)${
      counts.length ? `, ${counts.join(", ")}` : ""
    }, plus the store pages listed as refs. Anything else about the brand is NOT in your knowledge — admit it and point to the contact page or support email.`,
  );

  const t = String(text || "");
  const gaps = [];
  for (const topic of TOPICS) {
    if (!topic.test.test(t)) continue;
    const section = [];

    if (topic.services && brain && brain.services.length) {
      section.push("SERVICES:", ...brain.services.map(serviceLine));
      for (const s of brain.services) {
        refs.set(`service:${s.slug}`, {
          label: s.name,
          href: `/services/${s.slug}`,
          kind: "service",
        });
      }
    }
    if (topic.bundles && brain && brain.bundles.length) {
      section.push("BUNDLES:", ...brain.bundles.map(bundleLine));
      for (const b of brain.bundles) {
        refs.set(`bundle:${b.code}`, {
          label: b.name,
          href: `/bundles/${b.code}`,
          kind: "bundle",
        });
      }
    }
    if (topic.collections && brain && brain.collections.length) {
      section.push(
        "COLLECTIONS:",
        ...brain.collections.map((c) => {
          refs.set(`collection:${c.slug}`, {
            label: c.name,
            href: `/collections/${c.slug}`,
            kind: "collection",
          });
          return `- (ref collection:${c.slug}) ${c.name}${c.about ? ` — ${c.about}` : ""}`;
        }),
      );
    }
    if (topic.journal && brain && brain.journal.length) {
      section.push(
        "JOURNAL:",
        ...brain.journal.map((j) => {
          // Only type 'journal' has a public page; other types ground the
          // conversation without offering a link.
          if (j.type === "journal") {
            refs.set(`journal:${j.slug}`, {
              label: j.title,
              href: `/journal/${j.slug}`,
              kind: "journal",
            });
            return `- (ref journal:${j.slug}) ${j.title}${j.summary ? ` — ${j.summary}` : ""}`;
          }
          return `- ${j.title}${j.summary ? ` — ${j.summary}` : ""}`;
        }),
      );
    }
    if (topic.faqCats && brain && brain.faqs.length) {
      const hits = brain.faqs.filter(
        (f) => !f.category || topic.faqCats.includes(f.category),
      );
      if (hits.length) {
        section.push(
          "PUBLISHED FAQ ANSWERS (quote these, do not embellish):",
          ...hits.map((f) => `- Q: ${f.question} A: ${f.answer}`),
        );
      }
    }
    if (topic.guides && brain && brain.guides.length) {
      section.push(
        "CARE GUIDES:",
        ...brain.guides.map((g) => `- ${g.title}${g.summary ? ` — ${g.summary}` : ""}`),
      );
    }
    if (topic.key === "shipping" || topic.key === "returns") {
      const pols = (brain && brain.policies) || [];
      if (pols.length) {
        section.push(
          "PUBLISHED POLICIES:",
          ...pols.map((p) => `- ${p.title}: ${p.summary}`),
        );
      }
    }
    if (topic.payment && id && id.payment_providers.length) {
      section.push(
        `PAYMENT: the store accepts ${id.payment_providers.join(", ")}. Styles are priced in NGN and USD (see CATALOGUE); quote only listed prices.`,
      );
    }
    if (topic.contact && id) {
      section.push(
        `HUMAN HANDOFF: for anything you cannot answer, offer the contact page${
          id.support_email ? ` or ${id.support_email}` : ""
        }${id.phone ? ` or ${id.phone}` : ""}.`,
      );
    }

    // A topic matched but the brand has published nothing usable → make the
    // honest-gap behaviour explicit for THIS turn.
    if (section.length === 0) {
      gaps.push(topic.gap);
    }
    const pageKeys = [
      ...(topic.pageKeys || []),
      ...(topic.policyKeys || []),
    ].filter((k) => refs.has(k));
    if (pageKeys.length) {
      section.push(
        `Relevant refs for this topic: ${pageKeys.join(", ")}.`,
      );
    }
    if (section.length) {
      lines.push(section.join("\n").slice(0, SECTION_CHAR_CAP));
    }
  }

  if (gaps.length) {
    lines.push(
      `NO PUBLISHED DETAIL about: ${[...new Set(gaps)].join("; ")}. Say you don't have the exact detail, and point to the most relevant page ref or support contact. NEVER guess or invent specifics.`,
    );
  }

  return { block: lines.join("\n\n").slice(0, BLOCK_CHAR_CAP), refs };
}

/** Validate + hydrate model-chosen reference keys against this turn's registry. */
function resolveReferences({ keys, refs, limit = 3 }) {
  const seen = new Set();
  const out = [];
  for (const key of Array.isArray(keys) ? keys : []) {
    if (seen.has(key) || !refs.has(key)) continue;
    seen.add(key);
    const r = refs.get(key);
    out.push({ key, label: r.label, href: r.href, kind: r.kind });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = {
  loadBrandBrain,
  composeBrandContext,
  resolveReferences,
  // exported for unit tests
  _internal: { buildBrain, identityFrom, STATIC_PAGES, TOPICS, trim },
};
