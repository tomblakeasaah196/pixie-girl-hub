/**
 * Canonical storefront page catalog for Storefront Studio → Pages.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Pages tab used to list only the `storefront_pages` rows that happened to
 * be in the database, and the editor only rendered the slot keys that happened
 * to be saved on that row. Two gaps fell out of that:
 *
 *   1. A storefront page the seed never inserted (shade_finder, shades,
 *      collections, bundle_detail…) simply never appeared in the list — so it
 *      was un-editable even though the storefront reads its slots.
 *   2. A page seeded with only a subset of its fields (e.g. `about`, seeded
 *      with just the hero copy) only ever exposed that subset — the editorial /
 *      press / founder groups the page actually renders had no field in the UI.
 *
 * This catalog is the SINGLE SOURCE OF TRUTH the Pages tab lists from. Every
 * storefront page that has Studio-editable content appears here with its FULL
 * default slot shape, mirroring the storefront's own `withSlots(...)` defaults
 * (apps/storefront/src/routes/* and src/lib/home-content.ts). The tab merges a
 * page's saved slots OVER these defaults, so every field always has a control —
 * pre-filled with whatever is published, editable even before a row exists.
 *
 * KEEP IN SYNC (by hand — the two Vite apps share no package):
 *   - apps/storefront/src/lib/home-content.ts   (DEFAULT_HOME → `home`)
 *   - apps/storefront/src/routes/<page>.tsx      (each `withSlots({...})`)
 *   - scripts/seed-storefront.js                 (the published seed)
 * When you add/rename a storefront page or a slot, update this catalog in the
 * same change.
 */

export interface CatalogPage {
  page_key: string;
  /** Friendly name shown in the Pages list. */
  label: string;
  /** Where the page lives on the storefront (":slug" for detail templates). */
  url_path: string;
  template_key: string;
  /** Full default slot shape — the storefront's own defaults, mirrored. */
  defaultSlots: Record<string, unknown>;
}

// Local placeholder stills (public/maison/*) — same paths the storefront and
// seed use. Real imagery is uploaded per-field via the Studio image pickers.
const IMG = {
  hero: "/maison/editorial-atelier.jpg",
  models: "/maison/product-curls.jpg",
  model2: "/maison/product-straight.jpg",
  atelier: "/maison/editorial-atelier.jpg",
  pixie: "/maison/product-pixie.jpg",
  bob: "/maison/product-bob.jpg",
  curls: "/maison/product-curls.jpg",
  straight: "/maison/product-straight.jpg",
};

// Mirrors DEFAULT_HOME (apps/storefront/src/lib/home-content.ts). The slot KEYS
// (hero, marquee, bundles, shades, signature, why_choose, editorial, press,
// testimonials, gallery, founder) are exactly what resolveHomeContent() reads.
const HOME_SLOTS: Record<string, unknown> = {
  hero: {
    eyebrow: "The Autumn Edit · 2026 · ",
    eyebrowAccent: "nouveauté",
    heading: "Hair, ",
    headingAccent: "sculptée",
    headingAfter: " like couture.",
    body: "A Lagos studio crafting the world's most coveted pixies, bobs and curls. Hand-finished. Lace-perfect. ",
    bodyAccent: "Fait avec amour",
    bodyAfter: " — worn by the women who set the standard.",
    cta1Label: "Shop the Catalogue",
    cta1Href: "/shop",
    cta2Label: "Our Story",
    cta2Href: "/about",
    imageUrl: IMG.hero,
  },
  marquee: [
    "Hand-finished in Lagos",
    "Single-donor virgin hair",
    "HD melt lace",
    "Complimentary worldwide shipping",
    "1-year atelier guarantee",
    "Reusable for 18 months+",
  ],
  bundles: {
    eyebrow: "Shop the edit · ensembles",
    heading: "Curated ",
    headingAccent: "bundles",
    headingAfter: ". Better together.",
    linkLabel: "All bundles →",
    linkHref: "/bundles",
  },
  shades: {
    eyebrow: "Shop by shade",
    heading: "Find the tone that ",
    headingAccent: "speaks",
    headingAfter: " to you",
    body: "Explore our shade catalogue. Every tone is hand-mixed in the studio and colour-matched to your skin.",
  },
  signature: { eyebrow: "Signature collection", heading: "The house edit" },
  why_choose: {
    eyebrow: "Why choose",
    heading: "Faitlyn ",
    headingAccent: "Hair",
    body: "Each wig is handcrafted by artisans in our Lagos studio — made with precision, passion, and with women of colour in mind. ",
    bodyAccent: "Fait à la main.",
    pillars: [
      { n: "01", t: "100% Human Hair", d: "Single-donor, cuticle-aligned, ethically sourced. Never blended, never synthetic." },
      { n: "02", t: "Expertly Ventilated & Styled", d: "Each cap is hand-ventilated and finished by master stylists before it leaves the studio." },
      { n: "03", t: "Made For Every Woman", d: "Designed with women of colour in mind — every silhouette, every skin tone, every crown." },
      { n: "04", t: "B2B & B2C, Globally", d: "Stylists, salons, and individual clients in 30+ countries. Trade pricing on request." },
      { n: "05", t: "Worldwide Fast Shipping", d: "Express dispatch from Lagos within 48 hours. Complimentary over $2000 (or $1000 in Nigeria)." },
    ],
  },
  editorial: {
    eyebrow: "The Atelier",
    heading: "Every piece passes through ",
    headingAccent: "eleven pairs",
    headingAfter: " of hands before it reaches yours.",
    body: "From the sourcing of single-donor cuticle-aligned hair, to the hand-tying of every HD lace knot, to the final steam-set on the head of a Lagos master stylist — we refuse a single shortcut. The result is hair that wears like the dress code of the women who set the standard.",
    ctaLabel: "Read the story",
    ctaHref: "/about",
    imageUrl: IMG.atelier,
  },
  press: {
    eyebrow: "As seen in",
    items: ["VOGUE", "ELLE", "HARPER'S BAZAAR", "ESSENCE", "BAZAAR ARABIA", "GQ"],
  },
  testimonials: {
    eyebrow: "From the women who wear it",
    items: [
      { q: "I've worn every house. Faitlyn is the only one that makes me feel like I'm not wearing anything at all.", a: "Adaeze O.", r: "Lagos · Stylist" },
      { q: "The lace melts. The cut frames. I get stopped in every room I walk into.", a: "Imani T.", r: "New York · Editor" },
      { q: "Three units in. Each one outlasts the last. This is what luxury hair should have always been.", a: "Sophie L.", r: "London · Founder" },
    ],
  },
  gallery: {
    eyebrow: "We love to see it — how do you wear your pixie?",
    heading: "Tag @faitlynhair on IG to be featured",
    items: [
      { image: IMG.pixie, instagram_link: "", handle: "" },
      { image: IMG.bob, instagram_link: "", handle: "" },
      { image: IMG.curls, instagram_link: "", handle: "" },
      { image: IMG.straight, instagram_link: "", handle: "" },
      { image: IMG.models, instagram_link: "", handle: "" },
      { image: IMG.model2, instagram_link: "", handle: "" },
      { image: IMG.hero, instagram_link: "", handle: "" },
      { image: IMG.pixie, instagram_link: "", handle: "" },
    ],
    profile: {
      handle: "@faitlynhair",
      followers: "84.9K",
      bio: "Most Realistic Pixie Wigs · Luxury Hair + Premium HD Lace",
      verified: true,
    },
  },
  founder: {
    eyebrow: "A note from Faitlyn",
    body: "I started Faitlyn because the hair I wanted didn't exist. So I built it — slowly, by hand, with women who care about the craft as much as I do. Everything you see here is the version of luxury I always wished I could buy.",
    attribution: "— Faitlyn, Founder",
  },
};

// Mirrors the shade-finder route's own withSlots(...) defaults — every line of
// copy Praxis shows (the AI stylist's REPLIES/knowledge are separate; see the
// audit doc). This is the superset the storefront reads.
const SHADE_FINDER_SLOTS: Record<string, unknown> = {
  eyebrow: "Praxis · AI stylist",
  heading: "Find your shade",
  subheading:
    "One photo finds your shade — and I'm here for everything else too: styles, care, services, delivery.",
  welcome:
    "Hi, I'm Praxis — your personal stylist and concierge. Share a clear photo in natural light and I'll read your undertone, find your shade, and pull the exact styles that carry it. Or just talk to me — the occasion you're dressing for, wig care, our salon services, delivery, anything about the brand.",
  suggestions: [
    "Something warmer",
    "Deep & rich",
    "Under ₦200k",
    "How do I care for my wig?",
    "Delivery & returns",
  ],
  agentName: "Praxis",
  agentRole: "Stylist & concierge",
  shareCta: "Share a photo",
  analyseCta: "Analyse",
  composerPlaceholder: "Ask Praxis anything — shades, care, delivery…",
  composerPhotoPlaceholder: "Add a note with your photo (optional)…",
  consentLine:
    "I'm happy for Praxis to analyse this photo. It's never saved — discarded the moment the analysis ends.",
  privacyFooter: "Photos are analysed in memory and never saved.",
  stageReadingPhoto: "Praxis is looking at your photo…",
  stageMatchingShades: "Matching you against our shades…",
  stagePickingStyles: "Picking the styles that will love you back…",
  stageThinking: "Praxis is thinking…",
  quotaLabel: "{remaining} of {limit} looks left today",
  quotaTitle: "Photo analyses reset at midnight",
  endLabel: "End & delete",
  endTitle: "End the session and delete everything now",
  exhaustedBody:
    "You've used today's free looks — Praxis resets at midnight ✨ You can still browse ",
  exhaustedLinkLabel: "all shades",
  exhaustedTail: ".",
  errorBody: "Praxis couldn't come to the phone — please try again.",
  errorRetry: "Retry",
  endedHeading: "All cleared away",
  endedBody:
    "Your chat and colour notes are deleted. Photos were never stored in the first place.",
  endedCta: "Start a new session",
  expiredToast: "That session had expired — I've started you a fresh one.",
};

const POLICY_TITLES: Record<string, string> = {
  cancellation: "Cancellation Policy",
  returns: "Returns & Refunds",
  shipping: "Shipping Policy",
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

export const STOREFRONT_PAGE_CATALOG: CatalogPage[] = [
  {
    page_key: "home",
    label: "Home",
    url_path: "/",
    template_key: "maison_home_v1",
    defaultSlots: HOME_SLOTS,
  },
  {
    page_key: "shop",
    label: "Shop (catalogue)",
    url_path: "/shop",
    template_key: "catalogue_v1",
    defaultSlots: {
      eyebrow: "The Catalogue",
      heading: "Shop the ",
      headingAccent: "maison",
      headingAfter: ".",
      body: "Every silhouette, live from the Lagos atelier — hand-finished and shade-matched.",
    },
  },
  {
    page_key: "shades",
    label: "Shades (shop by shade)",
    url_path: "/shades",
    template_key: "shades_v1",
    defaultSlots: {
      heading: "Shop by shade",
      body: "Find your match, then make it yours.",
      finderTitle: "Not sure which shade is yours?",
      finderBody:
        "Share one photo and Praxis, our AI stylist, will read your undertone and pick it — free, private, nothing saved.",
      finderCta: "Find my shade",
      emptyTitle: "No shades published yet.",
    },
  },
  {
    page_key: "collections",
    label: "Collections",
    url_path: "/collections",
    template_key: "collections_v1",
    defaultSlots: {
      heading: "Collections",
      body: "Edits and stories, grouped.",
      emptyTitle: "No collections yet.",
    },
  },
  {
    page_key: "bundles",
    label: "Bundles",
    url_path: "/bundles",
    template_key: "bundles_v1",
    defaultSlots: {
      eyebrow: "Bundles · Ensembles",
      heading: "Better ",
      headingAccent: "together",
      headingAfter: ".",
      body: "Curated sets at a couture discount. Three pieces. Two pieces. One opportunity to save.",
    },
  },
  {
    page_key: "bundle_detail",
    label: "Bundle detail (per-bundle copy)",
    url_path: "/bundles/:slug",
    template_key: "bundle_detail_v1",
    defaultSlots: {
      eyebrow: "Bundle",
      includedLabel: "What's included",
      ctaLabel: "Add bundle to bag",
      ctaBusyLabel: "Adding...",
      addedToast: "Bundle added to bag",
      errorToast: "Couldn't add bundle. Please try again.",
    },
  },
  {
    page_key: "services",
    label: "Services",
    url_path: "/services",
    template_key: "services_v1",
    defaultSlots: {
      eyebrow: "Services · Prestations",
      heading: "Book with the ",
      headingAccent: "maison",
      headingAfter: ".",
      body: "Installs, in-home styling sessions and virtual consults — each booked with a senior Faitlyn stylist.",
    },
  },
  {
    page_key: "about",
    label: "About (the maison)",
    url_path: "/about",
    template_key: "maison_about_v1",
    defaultSlots: {
      eyebrow: "Est. Lagos · 2021",
      heading: "The hair we always wished we could ",
      headingAccent: "buy",
      headingAfter: ".",
      imageUrl: IMG.models,
      editorial: {
        eyebrow: "The Atelier",
        heading: "Every piece passes through ",
        headingAccent: "eleven pairs",
        headingAfter: " of hands before it reaches yours.",
        body: "From the sourcing of single-donor cuticle-aligned hair, to the hand-tying of every HD lace knot, to the final steam-set on the head of a Lagos master stylist — we refuse a single shortcut. The result is hair that wears like the dress code of the women who set the standard.",
        ctaLabel: "Read the story",
        ctaHref: "/about",
        imageUrl: IMG.atelier,
      },
      press: {
        eyebrow: "As seen in",
        items: ["VOGUE", "ELLE", "HARPER'S BAZAAR", "ESSENCE", "BAZAAR ARABIA", "GQ"],
      },
      founder: {
        eyebrow: "A note from Faitlyn",
        body: "I started Faitlyn because the hair I wanted didn't exist. So I built it — slowly, by hand, with women who care about the craft as much as I do. Everything you see here is the version of luxury I always wished I could buy.",
        attribution: "— Faitlyn, Founder",
      },
    },
  },
  {
    page_key: "journal",
    label: "Journal (listing banner)",
    url_path: "/journal",
    template_key: "journal_v1",
    defaultSlots: {
      eyebrow: "Journal",
      heading: "Notes from the ",
      headingAccent: "atelier",
      headingAfter: ".",
    },
  },
  {
    page_key: "contact",
    label: "Contact",
    url_path: "/contact",
    template_key: "contact_v1",
    defaultSlots: {
      eyebrow: "Concierge",
      heading: "Let's talk ",
      headingAccent: "hair",
      headingAfter: ".",
      body: "Sizing, shade-matching, bulk & trade orders, aftercare — our Lagos studio answers every message personally. ",
      bodyAccent: "Fait avec soin.",
      email: "hello@faitlynhair.com",
      whatsapp: "2348061987874",
      studio: "10B Emma Abimbola Cole Street, Lekki Phase 1, Lagos",
      hours: "Mon – Sat · 9am – 6pm WAT",
    },
  },
  {
    page_key: "shade_finder",
    label: "Shade Finder (Praxis AI page)",
    url_path: "/shade-finder",
    template_key: "shade_finder_v1",
    defaultSlots: SHADE_FINDER_SLOTS,
  },
  ...Object.entries(POLICY_TITLES).map(([slug, title]) => ({
    page_key: `policy-${slug}`,
    label: `Policy — ${title}`,
    url_path: `/policies/${slug}`,
    template_key: "policy_v1",
    // The policy BODY is written in Studio → Content → Policies; the page slot
    // only carries the display title.
    defaultSlots: { title } as Record<string, unknown>,
  })),
];

export const CATALOG_BY_KEY: Record<string, CatalogPage> = Object.fromEntries(
  STOREFRONT_PAGE_CATALOG.map((p) => [p.page_key, p]),
);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Merge a page's SAVED slots over the catalog DEFAULTS so every field has a
 * control in the editor. Saved values always win (including edited arrays and
 * custom keys the operator added); missing keys are filled from the defaults;
 * nested objects (hero, editorial, gallery, profile…) are merged recursively.
 */
export function deepMergeSlots(
  def: Record<string, unknown>,
  saved: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...def };
  if (isPlainObject(saved)) {
    for (const k of Object.keys(saved)) {
      const dv = def[k];
      const sv = saved[k];
      out[k] = isPlainObject(dv) && isPlainObject(sv) ? deepMergeSlots(dv, sv) : sv;
    }
  }
  return out;
}
