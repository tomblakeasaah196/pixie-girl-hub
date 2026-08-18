#!/usr/bin/env node
/**
 * Seed published Storefront Studio config (Storefront Implementation Guide §10).
 *
 * For each brand it publishes:
 *   - storefront_themes      (tokens: logo_url + optional CSS-var overrides)
 *   - storefront_navigation  (header items, footer columns, socials)
 *   - storefront_pages       (a published 'home' page whose `slots` drive the
 *                             ported maison sections — see apps/storefront
 *                             src/lib/home-content.ts for the field contract)
 * and seeds the global storefront_section_templates library (once).
 *
 * Idempotent: re-running replaces the published rows for each brand and leaves
 * any drafts alone. Safe to run after db:migrate:shared.
 *
 *   node scripts/seed-storefront.js
 */

"use strict";

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const BRANDS = ["pixiegirl", "faitlynhair"];

// Self-hosted stills served by the storefront from public/maison/ (no CDN).
// Hero/model imagery + logo ship via Studio uploads — placeholders until then.
const IMG = {
  hero: "/maison/editorial-atelier.jpg", // placeholder — replace with a Studio hero upload
  models: "/maison/product-curls.jpg",
  model2: "/maison/product-straight.jpg",
  atelier: "/maison/editorial-atelier.jpg",
  pixie: "/maison/product-pixie.jpg",
  bob: "/maison/product-bob.jpg",
  curls: "/maison/product-curls.jpg",
  straight: "/maison/product-straight.jpg",
};

// Theme tokens. `logo_url` is consumed by the storefront chrome (empty → the
// chrome renders a text wordmark). Colour/font CSS-var keys (starting with `--`)
// would override the baked DARK palette only. Upload a real logo via Studio.
const THEMES = {
  faitlynhair: { logo_url: "" },
  pixiegirl: { logo_url: "" },
};

// Brand-level share card (Open Graph / meta) — the SINGLE SOURCE OF TRUTH for
// the home page's title/description/banner, edited in Studio → Branding. Seeded
// here (matching the home page copy) so a fresh install has Branding populated
// from day one rather than showing blank Share fields. The --og-image banner is
// composed by the operator in Studio, so it is intentionally left unset.
function themeTokensFor(brand) {
  const name = brand === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";
  return {
    ...(THEMES[brand] || THEMES.pixiegirl),
    og_title: `${name} — Luxury Natural Hair, Crafted in Lagos`,
    og_description: `${name}: a Lagos maison crafting the world's most coveted pixies, bobs and curls. Hand-finished, lace-perfect luxury — shipped worldwide.`,
  };
}

// Nav (matches the ported SiteHeader/SiteFooter). Header items carry `children`
// so the header renders glass dropdowns on desktop and accordions on mobile;
// this published nav is the SINGLE SOURCE OF TRUTH the storefront reads, so
// editing it in Storefront Studio → Navigation drives both. Keep `url` (not
// `href`) — that is the key the storefront reads.
const NAV = {
  header_items: [
    {
      label: "Shop",
      url: "/shop",
      children: [
        { label: "All catalogue", url: "/shop" },
        { label: "By shade", url: "/shades" },
        { label: "By collection", url: "/collections" },
        { label: "By bundle", url: "/bundles" },
        { label: "Find my shade", url: "/shade-finder" },
      ],
    },
    { label: "Services", url: "/services" },
    {
      label: "Maison",
      url: "/about",
      children: [
        { label: "Our story", url: "/about" },
        { label: "Journal", url: "/journal" },
      ],
    },
  ],
  footer_columns: [
    { title: "Shop", links: [
      { label: "All catalogue", url: "/shop" },
      { label: "Bundles", url: "/bundles" },
      { label: "Pixie Cuts", url: "/shop" },
      { label: "Bob Wigs", url: "/shop" },
      { label: "Curly Collection", url: "/shop" },
      { label: "Limited Drops", url: "/shop" },
    ] },
    { title: "Maison", links: [
      { label: "Our Story", url: "/about" },
      { label: "Journal", url: "/journal" },
      { label: "Services", url: "/services" },
    ] },
    { title: "Care", links: [
      { label: "Contact", url: "/contact" },
      { label: "Email Preferences", url: "/account" },
      { label: "Cancellation Policy", url: "/policies/cancellation" },
    ] },
  ],
  socials: {
    instagram: "https://www.instagram.com/faitlynhair/",
    facebook: "https://web.facebook.com/faitlynhair/",
    twitter: "https://twitter.com/Faitlynhair",
    whatsapp: "https://wa.me/2348061987874",
  },
};

// Home template content. Keys match the storefront HomeContent contract, so the
// ported components render this verbatim (and fall back to the same content when
// absent). Catalogue sections (products/bundles/shades) pull live from the Hub.
const HOME_SLOTS = {
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
  marqueeImage: "",
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
  // Each tile carries a photo plus an optional Instagram link + handle. Paste
  // the tagger's post URL into `instagram_link` (Studio → Pages → Home →
  // Gallery) to make the tile clickable and credit the `handle` on hover.
  // `profile` is the Instagram identity shown under the rotating showcase —
  // handle (gradient link + verified seal), tagline and follower count.
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

const POLICY_TITLES = {
  cancellation: "Cancellation Policy",
  returns: "Returns & Refunds",
  shipping: "Shipping Policy",
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

// Every storefront page as an editable Studio record. The `slots` keys match the
// storefront's per-page defaults (usePageSlots / withSlots), so editing them in
// Studio changes the live page. Catalogue data (products/services/bundles) still
// comes from the Hub — these slots are the surrounding copy/imagery.
function pagesFor(brand) {
  const name = brand === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";
  const pages = [
    {
      page_key: "home", template_key: "maison_home_v1", url_path: "/", og_image_url: IMG.hero,
      meta_title: `${name} — Luxury Natural Hair, Crafted in Lagos`,
      meta_description: `${name}: a Lagos maison crafting the world's most coveted pixies, bobs and curls. Hand-finished, lace-perfect luxury — shipped worldwide.`,
      slots: HOME_SLOTS,
    },
    {
      // Site-wide chrome (promo bar · footer blurb/signature · mobile ☰ extras).
      // Not a route — the storefront reads it via useSiteChrome(). Keys mirror
      // apps/storefront/src/lib/site-config.tsx DEFAULT_SITE_CHROME.
      page_key: "site_chrome", template_key: "site_chrome_v1", url_path: "(appears on every page)", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        promo: {
          items: [
            { text: "Complimentary worldwide shipping on orders over $800", emphasis: "", url: "" },
            { text: "Bulk savings — 2 pieces $40 off · 3 pieces $90 off", emphasis: "auto-applied", url: "" },
            { text: "First order? Take 10% off with code", emphasis: "FAITLYN10", url: "" },
            { text: "Refer & earn up to $50 atelier credit", emphasis: "", url: "/account" },
          ],
        },
        // Shared brand mark shown between phrases on BOTH announcement bars (top
        // promo bar + the ribbon below the hero). Empty → a subtle dot.
        dividerImage: "",
        footer: {
          blurb: "A Lagos-born atelier of luxury natural hair. Curated, ethically sourced, finished by hand.",
          signature: "Maison Faitlyn — fait à la main à Lagos",
          copyrightName: "",
        },
        drawer: {
          featureEyebrow: "New in",
          featureTitle: "The Maison Collection",
          featureCta: "Shop the drop",
          featureHref: "/shop",
          featureImage: IMG.atelier,
          signature: "Est. Lagos · 2021",
          conciergeLabel: "Chat with a stylist",
          consultLabel: "Book a consultation",
        },
      },
    },
    {
      page_key: "shop", template_key: "catalogue_v1", url_path: "/shop", og_image_url: IMG.hero,
      meta_title: `Shop the Catalogue — ${name}`,
      meta_description: "Every silhouette, live from the Lagos atelier — hand-finished and shade-matched.",
      slots: { eyebrow: "The Catalogue", heading: "Shop the ", headingAccent: "maison", headingAfter: ".", body: "Every silhouette, live from the Lagos atelier — hand-finished and shade-matched." },
    },
    {
      page_key: "about", template_key: "maison_about_v1", url_path: "/about", og_image_url: IMG.models,
      meta_title: `The Maison — Our Story · ${name}`,
      meta_description: "Inside the Lagos atelier crafting hand-finished pixies, bobs and curls for women of colour worldwide.",
      slots: { eyebrow: "Est. Lagos · 2021", heading: "The hair we always wished we could ", headingAccent: "buy", headingAfter: ".", imageUrl: IMG.models },
    },
    {
      page_key: "services", template_key: "services_v1", url_path: "/services", og_image_url: IMG.hero,
      meta_title: `Services & Bookings — ${name}`,
      meta_description: "Installs, in-home styling sessions and virtual consults with a senior stylist.",
      slots: { eyebrow: "Services · Prestations", heading: "Book with the ", headingAccent: "maison", headingAfter: ".", body: "Installs, in-home styling sessions and virtual consults — each booked with a senior Faitlyn stylist." },
    },
    {
      page_key: "bundles", template_key: "bundles_v1", url_path: "/bundles", og_image_url: IMG.hero,
      meta_title: `Bundles — Better Together · ${name}`,
      meta_description: "Curated sets at a couture discount. Three pieces. Two pieces. One opportunity to save.",
      slots: { eyebrow: "Bundles · Ensembles", heading: "Better ", headingAccent: "together", headingAfter: ".", body: "Curated sets at a couture discount. Three pieces. Two pieces. One opportunity to save." },
    },
    {
      page_key: "journal", template_key: "journal_v1", url_path: "/journal", og_image_url: IMG.atelier,
      meta_title: `Journal — Notes from the Atelier · ${name}`,
      meta_description: "Notes, care guides and edits from the Lagos atelier.",
      slots: { eyebrow: "Journal", heading: "Notes from the ", headingAccent: "atelier", headingAfter: "." },
    },
    {
      page_key: "contact", template_key: "contact_v1", url_path: "/contact", og_image_url: IMG.hero,
      meta_title: `Contact — ${name}`,
      meta_description: "Reach the Lagos studio for sizing, orders and aftercare.",
      slots: { eyebrow: "Concierge", heading: "Let's talk ", headingAccent: "hair", headingAfter: ".", body: "Sizing, shade-matching, bulk & trade orders, aftercare — our Lagos studio answers every message personally. ", bodyAccent: "Fait avec soin.", email: "hello@faitlynhair.com", whatsapp: "2348061987874", studio: "10B Emma Abimbola Cole Street, Lekki Phase 1, Lagos", hours: "Mon – Sat · 9am – 6pm WAT" },
    },
    {
      page_key: "shades", template_key: "shades_v1", url_path: "/shades", og_image_url: IMG.hero,
      meta_title: `Shop by Shade — ${name}`,
      meta_description: "Every tone hand-mixed in the Lagos studio and colour-matched to your skin.",
      // Keys match the /shades page defaults (usePageSlots("shades")).
      slots: {
        heading: "Shop by shade",
        body: "Find your match, then make it yours.",
        finderTitle: "Not sure which shade is yours?",
        finderBody: "Share one photo and Praxis, our AI stylist, will read your undertone and pick it — free, private, nothing saved.",
        finderCta: "Find my shade",
        emptyTitle: "No shades published yet.",
      },
    },
    {
      page_key: "collections", template_key: "collections_v1", url_path: "/collections", og_image_url: IMG.hero,
      meta_title: `Collections — ${name}`,
      meta_description: "Edits and stories from the Lagos atelier, grouped.",
      // Keys match the /collections page defaults (usePageSlots("collections")).
      slots: {
        heading: "Collections",
        body: "Edits and stories, grouped.",
        emptyTitle: "No collections yet.",
      },
    },
    {
      page_key: "bundle_detail", template_key: "bundle_detail_v1", url_path: "/bundles/:slug", og_image_url: IMG.hero,
      meta_title: `Bundle — ${name}`,
      meta_description: "Curated sets at a couture discount.",
      // Shared copy for every bundle detail page (usePageSlots("bundle_detail")).
      slots: {
        eyebrow: "Bundle",
        includedLabel: "What's included",
        ctaLabel: "Add bundle to bag",
        ctaBusyLabel: "Adding...",
        addedToast: "Bundle added to bag",
        errorToast: "Couldn't add bundle. Please try again.",
      },
    },
    // ── Transactional / commerce pages (microcopy) ──────────────────────────
    {
      page_key: "cart", template_key: "cart_v1", url_path: "/cart", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        heading: "Your bag",
        loading: "Loading your bag...",
        emptyTitle: "Your bag is empty.",
        emptyCta: "Start shopping",
        summaryTitle: "Summary",
        subtotalLabel: "Subtotal",
        discountLabel: "Discount",
        deliveryLabel: "Delivery",
        deliveryValue: "calculated at checkout",
        totalLabel: "Total",
        checkoutCta: "Checkout",
        chargedNote: "Charged in {currency}",
      },
    },
    {
      page_key: "checkout", template_key: "checkout_v1", url_path: "/checkout", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        loading: "Loading your bag…",
        heading: "Checkout",
        emptyTitle: "Your bag is empty.",
        emptyCta: "Start shopping",
        backToBag: "Back to bag",
        contactLegend: "Contact",
        firstNamePlaceholder: "First name",
        lastNamePlaceholder: "Last name",
        emailPlaceholder: "Email",
        phonePlaceholder: "Phone",
        fulfilmentLegend: "Fulfilment",
        deliveryOptionLabel: "Deliver to me",
        deliveryOptionDesc: "Ship to your address",
        pickupOptionLabel: "Pick up",
        pickupOptionDesc: "Collect from our store",
        countryLabel: "Country",
        countryPlaceholder: "Start typing your country…",
        stateLabel: "State",
        statePlaceholder: "Select your state…",
        stateProvinceLabel: "State / Province",
        stateProvincePlaceholder: "State or province",
        cityLgaLabel: "City / LGA",
        lgaPlaceholder: "Select your LGA…",
        cityLabel: "City",
        cityPlaceholder: "City / town",
        address1Label: "Address line 1",
        address1Placeholder: "House number and street",
        address2Label: "Address line 2",
        address2Placeholder: "Apartment, landmark (optional)",
        pickupLocationLabel: "Pickup location",
        pickupPending: "We'll share the pickup address and collection time right after you order.",
        paymentLegend: "Payment",
        loyaltyLegend: "Loyalty",
        redeemLabel: "Redeem points (you have {points})",
        redeemNote: "Points are applied at payment and reduce the amount charged.",
        summaryTitle: "Order summary",
        subtotalLabel: "Subtotal",
        discountLabel: "Discount",
        deliverySummaryLabel: "Delivery",
        deliveryFreeLabel: "Free",
        deliveryCalculating: "Calculating…",
        deliveryNoService: "No delivery to this address",
        deliverySelectLocation: "Select location",
        undeliverableNote: "We can't deliver to this address yet. Double-check your country, state and city, or choose store pickup. We can't take a delivery order without a delivery fee.",
        totalLabel: "Total",
        referralLabel: "Referred by a friend?",
        referralPlaceholder: "Friend's code (optional)",
        referralApplied: "Applied from your friend's link · discount is on the order total.",
        promoToggle: "Have a promo code?",
        promoLabel: "Promo code",
        promoPlaceholder: "Enter code",
        promoApplyCta: "Apply",
        promoAppliedNote: "Code {code} applied · discount shown above.",
        payBusy: "Starting secure payment…",
        payCalculating: "Calculating delivery…",
        payAddDetails: "Add delivery details",
        payCta: "Pay {total}",
        secureCheckoutPickup: "Secure checkout · Collect in store",
        secureCheckoutDelivery: "Secure checkout · Delivery included",
        secureCheckoutNoAddress: "Secure checkout · Enter a deliverable address",
        chargedInNote: "Charged in {currency}: {amount}",
        retrySafeNote: "You'll be taken to a secure payment page. Retries are safe; you are not charged twice.",
        modalHeading: "Almost there — where are we sending it?",
        modalBody: "We just need a delivery address we can actually ship to, so we can add your delivery fee. Pop in your country, state and city — or collect from our store instead.",
        modalAddAddress: "Add my delivery address",
        modalPickupInstead: "Collect from store instead",
        errNameEmailPhone: "Please fill in your name, email and phone.",
        errDeliveryAddress: "Please enter your delivery address.",
        errState: "Please select your state.",
        errCityLga: "Please select your city / LGA.",
        errPickStateNg: "Please pick your state from the list (and your LGA for Lagos) so we can calculate delivery.",
        errPickCountry: "Please pick your country from the list so we can calculate delivery.",
        errCalculating: "Calculating delivery… give it a second, then tap Pay again.",
        errCheckoutFailed: "Checkout failed. Please review your details and try again.",
        promoInvalid: "That code isn't valid on this cart. Please double-check it and try again.",
      },
    },
    {
      page_key: "checkout_thank_you", template_key: "thank_you_v1", url_path: "/checkout/thank-you", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        heading: "Thank you",
        body: "Your order has been received. A confirmation is on its way to your email, and we've started preparing your order.",
        trackCta: "Track your order",
        continueCta: "Continue shopping",
      },
    },
    {
      page_key: "auth", template_key: "auth_v1", url_path: "/auth", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        image: IMG.atelier,
        panelEyebrow: "The Inner Circle",
        panelHeadingBefore: "Join the ",
        panelHeadingAccent: "maison",
        panelHeadingAfter: ".",
        benefits: [
          "Order history & live tracking",
          "Saved addresses for faster checkout",
          "Wishlist across both maisons",
          "Loyalty points & atelier credit",
          "Referral rewards — up to $50",
        ],
        loginEyebrow: "Welcome back",
        registerEyebrow: "New here",
        loginHeading: "Sign in",
        registerHeading: "Create account",
        loginSubtitle: "Access your orders, wishlist and atelier credit.",
        registerSubtitle: "One account, both maisons — Faitlyn & Pixie Girl.",
        firstNamePlaceholder: "First name",
        lastNamePlaceholder: "Last name",
        emailPlaceholder: "Email",
        passwordPlaceholder: "Password",
        forgotLabel: "Forgot password?",
        busyLabel: "Please wait…",
        createAccountToggle: "Create an account",
        haveAccountToggle: "I already have an account",
        dividerLabel: "or",
        guestPrompt: "Prefer not to sign in?",
        guestCta: "Check out as a guest",
        terms: "By continuing you agree to our Terms & Privacy Policy.",
        loginSuccess: "Welcome back",
        registerSuccess: "Account created",
        errorFallback: "Something went wrong. Please try again.",
        forgotNoEmail: "Enter your email first, then tap reset.",
        forgotSent: "If that email exists, a reset link is on its way.",
      },
    },
    {
      page_key: "account", template_key: "account_v1", url_path: "/account", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        eyebrow: "Account",
        signOutCta: "Sign out",
        loading: "Loading your account...",
        ordersHeading: "Orders",
        noOrders: "You have no orders yet.",
        trackCta: "Track",
      },
    },
    // ── Detail / listing pages (shared copy across all instances) ───────────
    {
      page_key: "product_detail", template_key: "product_detail_v1", url_path: "/product/:slug", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        colourLabel: "Colour",
        sizeLabel: "Cap size",
        laceLabel: "Lace",
        unstyledLabel: "Buy unstyled (raw)",
        addCta: "Add to bag",
        addBusyLabel: "Adding...",
        viewBagCta: "View bag",
        chooseVariantError: "Please choose colour, size and lace.",
        addedToast: "Added to bag",
        addErrorToast: "Couldn't add to bag. Please try again.",
        socialProofPrefix: "As seen on",
        sizeGuideFallbackTitle: "Head size guide",
      },
    },
    {
      page_key: "service_detail", template_key: "service_detail_v1", url_path: "/services/:slug", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        backLabel: "← Services",
        fromPrefix: "From ",
        includedHeading: "What's included",
        faqsHeading: "FAQs",
        cancellationLabel: "Cancellation: ",
        successHeading: "Request received",
        successBody: "Thank you — our team will reach out within 24 hours to confirm your {name} booking.",
        requestAnother: "Request another",
        bookingHeading: "Request a booking",
        depositNote: "A deposit{pct} may be required to confirm.",
        fullNamePlaceholder: "Full name",
        phonePlaceholder: "Phone",
        emailPlaceholder: "Email",
        timePlaceholder: "Preferred time",
        notesPlaceholder: "Anything we should know?",
        sendingLabel: "Sending...",
        submitCta: "Request booking",
        sentToast: "Booking request sent. We'll be in touch.",
        errorToast: "Couldn't send your request. Please try again.",
        nameError: "Please enter your name.",
        contactError: "Add a phone or email so we can reach you.",
      },
    },
    {
      page_key: "shop_category", template_key: "shop_category_v1", url_path: "/shop/:category", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: { eyebrow: "Shop", emptyTitle: "Nothing in this category yet." },
    },
    {
      page_key: "collection_detail", template_key: "collection_detail_v1", url_path: "/collections/:slug", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: { emptyTitle: "No products in this collection yet." },
    },
    {
      page_key: "shade_detail", template_key: "shade_detail_v1", url_path: "/shades/:slug", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: { emptyTitle: "No styles in this shade yet." },
    },
    {
      page_key: "journal_article", template_key: "journal_article_v1", url_path: "/journal/:slug", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: { loading: "Loading..." },
    },
    // ── Order / delivery link pages (transactional) ─────────────────────────
    {
      page_key: "track_order", template_key: "track_v1", url_path: "/track/:token", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        loading: "Loading your order...",
        eyebrow: "Order tracking",
        fallbackTitle: "Your order",
        statusLabel: "Status: ",
        noUpdates: "No updates yet - check back soon.",
      },
    },
    {
      page_key: "install_hub", template_key: "install_v1", url_path: "/install/:token", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        loading: "Loading your care hub...",
        eyebrow: "Install & care",
        heading: "Caring for your order",
        orderPrefix: "Order ",
        careGuidesLabel: "Care guides",
        whatsappCta: "Chat with us on WhatsApp",
      },
    },
    {
      page_key: "deliver_confirm", template_key: "deliver_v1", url_path: "/deliver/:token", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        loading: "Loading delivery…",
        eyebrow: "Delivery confirmation",
        alreadyDonePrefix: "This delivery is already marked ",
        alreadyDoneSuffix: ".",
        alreadyDoneNote: "Nothing further is needed here.",
        confirmedHeading: "Delivery confirmed. Thank you!",
        confirmedNote: "The customer has been notified. You're all set.",
        recipientFallback: "Recipient",
        photoLabel: "Photo of the delivered package (required)",
        photoCta: "Tap to take or choose a photo",
        locating: "Getting location…",
        locationCaptured: "Location captured ✓",
        shareLocation: "Share my location (optional)",
        locateError: "Couldn't get your location — you can still confirm without it.",
        notesLabel: "Notes (optional)",
        notesPlaceholder: "Anything the team should know…",
        confirmError: "Couldn't confirm this delivery — check the photo and try again.",
        confirming: "Confirming…",
        confirmCta: "Confirm delivery",
      },
    },
    {
      page_key: "order_link", template_key: "order_link_v1", url_path: "/o/:slug", og_image_url: null,
      meta_title: null, meta_description: null,
      slots: {
        linkInvalidTitle: "Sorry — this link doesn't work",
        linkInvalidBody: "This order link is no longer valid. Please ask us for a fresh one.",
        alreadyPlacedTitle: "Order already placed 🌹",
        alreadyPlacedWithOrder: "This link was used to place order {order}. Message us on WhatsApp if you'd like to order again — we'll send a fresh link.",
        alreadyPlacedNoOrder: "This link was used to place your order. Message us on WhatsApp if you'd like to order again — we'll send a fresh link.",
        doneTitle: "Order placed 🌹",
        doneBody: "We couldn't open the payment page just now, so we'll send you a payment link on WhatsApp in a moment. Once payment lands, your order moves into production.",
        eyebrow: "Your order",
        greetingPrefix: "Hi ",
        greetingSuffix: " 💕",
        nameFallback: "there",
        intro: "Here's a selection we picked for you. Choose what you'd like, confirm delivery, and pay.",
        pickItemsLabel: "Pick your items",
        itemServiceFallback: "Service",
        itemProductFallback: "Product",
        serviceBadge: "service",
        unavailableNote: "Unavailable right now — we'll confirm by WhatsApp.",
        unsupportedNote: "Some items couldn't be added automatically — our team will follow up on WhatsApp to finalise those before shipping.",
        whoLabel: "Tell us who you are",
        firstNameLabel: "First name",
        lastNameLabel: "Last name",
        whatsappLabel: "WhatsApp number",
        whatsappPlaceholder: "e.g. +2348012345678",
        fulfilmentLabel: "How would you like it",
        deliveryLabel: "Delivery",
        pickupLabel: "Pickup in store",
        deliverySectionLabel: "Delivery",
        streetLabel: "Street / house",
        streetPlaceholder: "e.g. 12 Admiralty Way",
        areaLabel: "Area / neighbourhood",
        countryLabel: "Country",
        stateLabel: "State",
        statePlaceholder: "Select your state…",
        lgaLabel: "LGA",
        lgaPlaceholder: "Select your LGA…",
        cityLabel: "City",
        landmarkLabel: "Landmark (helps the rider)",
        contactLabel: "Contact",
        phoneLabel: "Phone (for delivery)",
        phonePlaceholder: "+234…",
        emailLabel: "Email (receipt)",
        payWithLabel: "Pay with",
        subtotalLabel: "Subtotal",
        deliverySummaryLabel: "Delivery",
        calculating: "Calculating…",
        totalLabel: "Total",
        bookingCta: "Place booking request",
        payCta: "Place order & pay {total}",
        securedNote: "Secured by a one-time link bound to this conversation.",
        errPickStateNg: "Please pick your state (and LGA for Lagos) so we can calculate delivery.",
        errPickCountry: "Please pick your country so we can calculate delivery.",
        errCalculating: "Calculating delivery… give it a second, then tap Pay again.",
        errUndeliverable: "We can't price delivery to this location yet. Check your address, or choose pickup.",
        errPlaceFailed: "Couldn't place your order. Try again.",
      },
    },
  ];
  pages.push({
    page_key: "shade_finder", template_key: "shade_finder_v1", url_path: "/shade-finder", og_image_url: null,
    meta_title: `Find Your Shade — Praxis AI Stylist · ${name}`,
    meta_description: "Share a photo and Praxis reads your undertone, finds your shade, and pulls the styles that carry it.",
    slots: {
      eyebrow: "Praxis · AI stylist",
      heading: "Find your shade",
      subheading: "One photo finds your shade — and I'm here for everything else too: styles, care, services, delivery.",
      welcome: "Hi, I'm Praxis — your personal stylist and concierge. Share a clear photo in natural light and I'll read your undertone, find your shade, and pull the exact styles that carry it. Or just talk to me — the occasion you're dressing for, wig care, our salon services, delivery, anything about the brand.",
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
      consentLine: "I'm happy for Praxis to analyse this photo. It's never saved — discarded the moment the analysis ends.",
      privacyFooter: "Photos are analysed in memory and never saved.",
      stageReadingPhoto: "Praxis is looking at your photo…",
      stageMatchingShades: "Matching you against our shades…",
      stagePickingStyles: "Picking the styles that will love you back…",
      stageThinking: "Praxis is thinking…",
      quotaLabel: "{remaining} of {limit} looks left today",
      quotaTitle: "Photo analyses reset at midnight",
      endLabel: "End & delete",
      endTitle: "End the session and delete everything now",
      exhaustedBody: "You've used today's free looks — Praxis resets at midnight ✨ You can still browse ",
      exhaustedLinkLabel: "all shades",
      exhaustedTail: ".",
      errorBody: "Praxis couldn't come to the phone — please try again.",
      errorRetry: "Retry",
      endedHeading: "All cleared away",
      endedBody: "Your chat and colour notes are deleted. Photos were never stored in the first place.",
      endedCta: "Start a new session",
      expiredToast: "That session had expired — I've started you a fresh one.",
    },
  });
  for (const [slug, title] of Object.entries(POLICY_TITLES)) {
    pages.push({
      page_key: `policy-${slug}`, template_key: "policy_v1", url_path: `/policies/${slug}`, og_image_url: null,
      meta_title: `${title} — ${name}`,
      meta_description: `${title} for ${name}.`,
      slots: { title },
    });
  }
  return pages;
}

// Studio-managed popups (newsletter "The Letter"). Content keys mirror what the
// storefront modal reads; seeded only where the table exists.
const POPUPS = [
  {
    popup_key: "newsletter",
    trigger_type: "time_delay",
    trigger_value: 25,
    audience: "all",
    content: {
      // Canonical Storefront Studio → Popups fields (what the form edits).
      heading: "One curated note. Once a month.",
      button_label: "Join the list",
      image_url: IMG.model2,
      // Newsletter-only extras the generic form does not expose.
      eyebrow: "The Letter",
      bullets: ["Early access to limited drops", "Hair education from the Lagos atelier", "Founder picks, no spam, ever"],
      placeholder: "your@email.com",
    },
    display_rules: { frequency: "once_per_session" },
    display_order: 0,
  },
];

// Optional Studio section-template library (guided page composer). Seeded only
// when the table exists (migration 000243); skipped otherwise.
const SECTION_TEMPLATES = [
  { template_key: "maison_hero_v1", category: "hero", display_name: "Maison hero", description: "Full-bleed hero with eyebrow, couture headline, CTAs.", default_slots: { eyebrow: "", heading: "", headingAccent: "" }, display_order: 0 },
  { template_key: "shade_grid_v1", category: "grid", display_name: "Shop by shade", description: "Shade tiles pulled from the catalogue.", default_slots: { eyebrow: "Shop by shade", heading: "" }, display_order: 1 },
  { template_key: "signature_carousel_v1", category: "grid", display_name: "Signature carousel", description: "Product carousel of the house edit.", default_slots: { eyebrow: "Signature collection", heading: "The house edit" }, display_order: 2 },
  { template_key: "editorial_split_v1", category: "editorial", display_name: "Editorial split", description: "Image + copy atelier block.", default_slots: { eyebrow: "The Atelier", heading: "" }, display_order: 3 },
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'shared' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function seedBrand(client, brand) {
  await client.query(
    `DELETE FROM shared.storefront_themes WHERE business = $1 AND status = 'published'`,
    [brand],
  );
  await client.query(
    `INSERT INTO shared.storefront_themes (business, status, tokens)
     VALUES ($1, 'published', $2)`,
    [brand, JSON.stringify(themeTokensFor(brand))],
  );

  await client.query(
    `DELETE FROM shared.storefront_navigation WHERE business = $1 AND status = 'published'`,
    [brand],
  );
  await client.query(
    `INSERT INTO shared.storefront_navigation
       (business, status, header_items, footer_columns, socials)
     VALUES ($1, 'published', $2, $3, $4)`,
    [brand, JSON.stringify(NAV.header_items), JSON.stringify(NAV.footer_columns), JSON.stringify(NAV.socials)],
  );

  const pages = pagesFor(brand);
  for (const page of pages) {
    await client.query(
      `DELETE FROM shared.storefront_pages
        WHERE business = $1 AND page_key = $2 AND status = 'published'`,
      [brand, page.page_key],
    );
    await client.query(
      `INSERT INTO shared.storefront_pages
         (business, page_key, template_key, status, url_path, meta_title,
          meta_description, og_image_url, slots)
       VALUES ($1, $2, $3, 'published', $4, $5, $6, $7, $8)`,
      [brand, page.page_key, page.template_key, page.url_path, page.meta_title, page.meta_description, page.og_image_url, JSON.stringify(page.slots)],
    );
  }

  process.stdout.write(`  seeded ${brand}: theme + nav + ${pages.length} pages\n`);
}

// Popups live in a NEWER table (may be absent, or its columns may differ) — keep
// it best-effort in its own transaction so it can NEVER roll back the pages.
async function seedPopupsFor(client, brand) {
  if (!(await tableExists(client, "storefront_popups"))) {
    process.stdout.write(`  (storefront_popups absent — popups skipped for ${brand})\n`);
    return;
  }
  // Seed ONCE per key, and never re-publish one the operator has since changed.
  // This used to DELETE the published row and re-insert it on every run, which
  // resurrected popups that had been taken down and overwrote operator copy
  // with the defaults below. Any existing row (draft, published or archived)
  // means the operator owns this popup now — leave it alone.
  let seeded = 0;
  for (const p of POPUPS) {
    const { rows } = await client.query(
      `SELECT 1 FROM shared.storefront_popups
        WHERE business = $1 AND popup_key = $2 LIMIT 1`,
      [brand, p.popup_key],
    );
    if (rows.length) continue;
    await client.query(
      `INSERT INTO shared.storefront_popups
         (business, status, popup_key, trigger_type, trigger_value, audience,
          content, display_rules, display_order)
       VALUES ($1, 'published', $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [brand, p.popup_key, p.trigger_type, p.trigger_value, p.audience, JSON.stringify(p.content), JSON.stringify(p.display_rules), p.display_order],
    );
    seeded += 1;
  }
  process.stdout.write(
    `  seeded ${brand}: ${seeded} popup(s)` +
      (seeded < POPUPS.length ? ` (${POPUPS.length - seeded} already present, left as-is)` : "") +
      "\n",
  );
}

async function seedSectionTemplates(client) {
  if (!(await tableExists(client, "storefront_section_templates"))) {
    process.stdout.write("  (storefront_section_templates absent — skipped)\n");
    return;
  }
  for (const t of SECTION_TEMPLATES) {
    await client.query(
      `INSERT INTO shared.storefront_section_templates
         (template_key, category, display_name, description, default_slots, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (template_key) DO UPDATE
         SET category = EXCLUDED.category,
             display_name = EXCLUDED.display_name,
             description = EXCLUDED.description,
             default_slots = EXCLUDED.default_slots,
             display_order = EXCLUDED.display_order`,
      [t.template_key, t.category, t.display_name, t.description, JSON.stringify(t.default_slots), t.display_order],
    );
  }
  process.stdout.write(`  seeded ${SECTION_TEMPLATES.length} section templates\n`);
}

async function main() {
  const client = await pool.connect();
  try {
    process.stdout.write("Seeding storefront studio config...\n");

    // Section templates — best-effort, isolated.
    try {
      await client.query("BEGIN");
      await seedSectionTemplates(client);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("  section templates skipped:", e.message);
    }

    // Each brand's core (theme/nav/pages) commits independently; popups are a
    // separate best-effort txn so a popups schema mismatch can't wipe the pages.
    for (const brand of BRANDS) {
      try {
        await client.query("BEGIN");
        await seedBrand(client, brand);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(`  ${brand} core seed FAILED:`, e.message);
      }
      try {
        await client.query("BEGIN");
        await seedPopupsFor(client, brand);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(`  ${brand} popups skipped:`, e.message);
      }
    }

    // Verify — print what actually landed so you can confirm at a glance.
    const { rows } = await client.query(
      `SELECT business, count(*)::int AS n
         FROM shared.storefront_pages
        WHERE status = 'published'
        GROUP BY business ORDER BY business`,
    );
    process.stdout.write("Published pages now in DB:\n");
    if (!rows.length)
      process.stdout.write("  (none — see the errors above)\n");
    for (const r of rows)
      process.stdout.write(`  ${r.business}: ${r.n} pages\n`);
    process.stdout.write("Done.\n");
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
