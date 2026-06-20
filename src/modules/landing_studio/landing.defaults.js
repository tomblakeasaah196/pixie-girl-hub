/**
 * Landing Studio — canonical config defaults + deep-merge (server-side).
 *
 * A CommonJS port of packages/landing-kit/config.ts (the frontend single
 * source of truth) and migration 000225's seed. The Node backend can't import
 * the TS/ESM kit, so the brand defaults are mirrored here and applied when
 * publishing and on the public read path — guaranteeing the stored/served
 * published_config is always complete, even for snapshots saved before a
 * field (e.g. reveal.threeD) existed.
 *
 * Keep in sync with packages/landing-kit/config.ts.
 */

"use strict";

const PERKS = [
  { numeral: "I.", label: "First access" },
  { numeral: "II.", label: "Private pricing" },
  { numeral: "III.", label: "Curated gifts" },
];

const PILLARS = [
  { numeral: "I.", title: "Crafted", body: "Hand-selected strands, hand-finished lace. Every cap is made for one head." },
  { numeral: "II.", title: "Curated", body: "Tight seasons. Few pieces. We release only what we would wear ourselves." },
  { numeral: "III.", title: "Limited", body: "When a chapter closes, it closes. No restocks. No second printings." },
];

/** Brand-agnostic structural defaults (everything except identity/theme). */
function baseConfig() {
  return {
    background: { type: "color", imageUrl: null },
    logo: { url: null, headerTint: null, footerTint: null, headerScale: 1.15, footerScale: 1.15 },
    hero: {
      imageUrl: null,
      eyebrow: "Between chapters — opening soon",
      headline: "Quiet",
      headlineAccent: "on purpose.",
      body: "The next chapter is being written. Doors closed for now — but the list inside hears first, pays less, and receives the curated gifts reserved for our earliest few. Add your name. Be first through the door.",
      ctaLabel: "Request your invitation",
      launchSeasonLabel: "The doors open in the season ahead",
    },
    invitation: {
      eyebrow: "The Inner Circle",
      heading: "Two hundred names.",
      headingAccent: "Nothing more.",
      body: "Twenty-four hours of early access. Private launch pricing — up to 30% off for the list. A curated launch gift hand-selected for top orders. And for those who bring three friends with them: an additional private discount and bonus loyalty points on every purchase they make.",
      seatsTotal: 200,
      seatsClaimedBase: 73,
      perks: PERKS,
      formTitle: "Reserve your seat",
      formTitleAccent: "at the table.",
      formEyebrow: "Private invitation",
      referralNote: "Invite three. When three friends you refer join the list, you unlock an additional private discount at launch — and every purchase they make adds to your loyalty points.",
    },
    form: {
      collectName: true,
      collectEmail: true,
      collectWhatsapp: true,
      collectReferral: true,
      channels: ["email", "whatsapp", "both"],
      submitLabel: "Add me to the list",
      footnote: "One message when doors open. A quiet inbox otherwise.",
    },
    galleryEyebrow: "The Last Chapter",
    galleryHeading: "A glimpse of what has been.",
    gallery: [],
    pillars: PILLARS,
  };
}

/** The full brand default config (mirrors migration 000225 + the kit). */
function defaultConfig(brandKey) {
  if (brandKey === "faitlynhair") {
    return {
      ...baseConfig(),
      brandName: "Faitlyn Hair",
      legalName: "The Faitlyn Brand",
      tagline: "Quietly extraordinary.",
      welcomeLine: "Welcome to Faitlyn",
      domain: "sales.thefaitlynbrand.com",
      storefront: "https://thefaitlynbrand.com",
      address: "10B Emma Abimbola Cole Street, Lekki Phase 1, Lagos",
      theme: {
        ink: "#1A0F08", paper: "#F8F5F1", primary: "#3A2418",
        primaryDeep: "#281D15", accent: "#D9BFA8", muted: "#B6A696", glow: "#C79C6B",
      },
      three: { primary: "#3A2418", accent: "#D9BFA8", ink: "#1A0F08", metal: "#E5C9A8" },
      socials: [
        { platform: "instagram", href: "https://www.instagram.com/faitlynhair/", label: "Instagram" },
        { platform: "facebook", href: "https://web.facebook.com/faitlynhair/", label: "Facebook" },
        { platform: "twitter", href: "https://twitter.com/Faitlynhair", label: "X" },
        { platform: "whatsapp", href: "https://wa.me/2348061987874", label: "WhatsApp" },
      ],
      reveal: {
        enabled: true,
        tagline: "Quietly extraordinary.",
        showScarcity: true,
        threeD: {
          enabled: true,
          brandType: "faitlynhair",
          variant: "logo-static",
          rotationSpeed: 1.2,
          glowIntensity: 0.8,
        },
      },
      seo: {
        metaTitle: "Faitlyn Hair — Quietly extraordinary.",
        metaDescription:
          "Join the private list. First access, private launch pricing, and curated gifts reserved for our earliest few.",
        ogImageUrl: null,
        faviconUrl: null,
        twitterHandle: "@Faitlynhair",
      },
    };
  }
  return {
    ...baseConfig(),
    brandName: "Pixie Girl Global",
    legalName: "Pixie Girl Global LLC",
    tagline: "The House of the Pixie",
    welcomeLine: "Welcome to the House of Pixie",
    domain: "sales.pixiegirlglobal.com",
    storefront: "https://pixiegirlglobal.com",
    address: "30 N Gould St Ste R, Sheridan, WY 82801",
    theme: {
      ink: "#100806", paper: "#F8F4F2", primary: "#5C0A14",
      primaryDeep: "#36060D", accent: "#D4AF7A", muted: "#BBAEA8", glow: "#A11225",
    },
    three: { primary: "#5C0A14", accent: "#D4AF7A", ink: "#100806", metal: "#B8112B" },
    socials: [
      { platform: "instagram", href: "https://www.instagram.com/pixiegirlg", label: "Instagram" },
      { platform: "tiktok", href: "https://www.tiktok.com/@pixiegirlg", label: "TikTok" },
      { platform: "youtube", href: "https://www.youtube.com/@PixieGirlG", label: "YouTube" },
      { platform: "twitter", href: "https://x.com/pixiegirlg", label: "X" },
      { platform: "pinterest", href: "https://www.pinterest.com/pixiegirlg", label: "Pinterest" },
    ],
    reveal: {
      enabled: true,
      tagline: "The House of the Pixie",
      showScarcity: true,
      threeD: {
        enabled: true,
        brandType: "pixiegirl",
        variant: "text-dual",
        rotationSpeed: 0.8,
        glowIntensity: 1.0,
      },
    },
    seo: {
      metaTitle: "Pixie Girl Global — The House of the Pixie",
      metaDescription:
        "Join the private list. First access, private launch pricing, and curated gifts reserved for our earliest few.",
      ogImageUrl: null,
      faviconUrl: null,
      twitterHandle: "@pixiegirlg",
    },
  };
}

/**
 * Deep-merge a partial/older config over the brand defaults so a stored or
 * served config is never left with holes. Mirrors the frontend withDefaults:
 * nested objects (theme, three, hero, invitation, form, logo, background,
 * reveal + reveal.threeD) merge key-by-key; arrays (pillars, socials) fall
 * back to defaults only when empty/absent; everything else is cfg-wins.
 */
function withDefaults(brandKey, cfg) {
  const d = defaultConfig(brandKey);
  if (!cfg || typeof cfg !== "object") return d;
  return {
    ...d,
    ...cfg,
    theme: { ...d.theme, ...(cfg.theme || {}) },
    three: { ...d.three, ...(cfg.three || {}) },
    background: { ...d.background, ...(cfg.background || {}) },
    logo: { ...d.logo, ...(cfg.logo || {}) },
    hero: { ...d.hero, ...(cfg.hero || {}) },
    invitation: { ...d.invitation, ...(cfg.invitation || {}) },
    form: { ...d.form, ...(cfg.form || {}) },
    pillars: cfg.pillars && cfg.pillars.length ? cfg.pillars : d.pillars,
    socials: cfg.socials && cfg.socials.length ? cfg.socials : d.socials,
    gallery: cfg.gallery != null ? cfg.gallery : d.gallery,
    reveal: {
      ...d.reveal,
      ...(cfg.reveal || {}),
      threeD: { ...d.reveal.threeD, ...((cfg.reveal && cfg.reveal.threeD) || {}) },
    },
    seo: { ...d.seo, ...(cfg.seo || {}) },
  };
}

module.exports = { defaultConfig, withDefaults };
