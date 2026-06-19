# `@pixie-girl-hub/landing`

Public sales-campaign landing pages (Next.js 14 App Router).

Deployed to the dynamic per-brand sales subdomain configured in
**Settings → Business Setup → Public Identity → Sales subdomain**:

- `sales.pixiegirlglobal.com`
- `sales.thefaitlynbrand.com`
- _(any third brand the CEO onboards — DNS CNAME + the column value is all it takes)_

## Why a separate app

The admin Hub (Vite SPA) is auth-gated and not SEO-shaped. The public
sales page needs **SSR, og-image preview, ISR for the Ended state,
SEO-friendly URLs**, and a tighter motion budget than a CSR shell can
deliver. Next.js gives us all four. The app reads its brand from the
incoming `Host` header — the Hub backend's host-→-brand resolver does
the mapping against `shared.business_config.sales_subdomain`.

## Local dev

```bash
cd apps/landing
cp .env.example .env.local
# Start the Hub backend on :7000 (npm run dev at the repo root)
npm install
npm run dev
# → http://localhost:3001/sale/<your-campaign-slug>
```

The dev rewrites in `next.config.mjs` proxy `/api/*` and `/media/*` to
the Hub backend at `HUB_API_URL` (default `http://localhost:7000`).

## Production

The sales subdomain points at this Next.js app's edge. Configure the
edge / load balancer to forward `/api/*` to the Hub backend (so the
landing's `fetch('/api/...')` and `POST /api/public/sale/:slug/...`
calls reach the same logical origin). The Hub's
`host-brand-resolver` middleware reads the inbound Host and resolves
the brand from `business_config.sales_subdomain`.

## Architecture

```
app/
  layout.tsx                       Root layout (fonts, manifest, viewport)
  page.tsx                         Apex (no live sale right now)
  sale/[slug]/
    page.tsx                       SSR Server Component: fetchCampaign() → <LandingShell>
    loading.tsx · error.tsx · not-found.tsx
  checkout/[slug]/page.tsx         SSR shell → <CheckoutClient>
  manifest.webmanifest/route.ts    Dynamic PWA manifest (brand-aware)
  robots.txt/route.ts

components/
  LandingShell.tsx                 The state engine; routes blocks → renderers
  blocks/
    HeroAndCountdown.tsx           Hero (Before / Live / Last-call / Ended) + Countdown + BeforeReveal + EndedFarewell
    BundleShowcase.tsx             Curated bundle cards with before/after totals + savings
    QuantityTierVisualizer.tsx     "Buy more save more" cart-level ladder
    FeaturedProducts.tsx           Individual styled product grid
    LookbookCarousel.tsx           Reels-style horizontal scroll
    StockCounter.tsx               Live remaining count per bundle
    Narrative.tsx                  BrandStory, FounderQuote, WhyBuy, Testimonials, Faq, WigCare, StylistSpotlight, ShippingReturns
    Signup.tsx                     NewsletterCapture (Before), VipSignup (Before VIP)
    UgcCarousel.tsx                IG-embedded / Reels lookbook
    SaleFooter.tsx
    3d/
      CountdownRing.tsx            @react-three/fiber 2.5D ring (Before)
      HeroCenterpiece.tsx          @react-three/fiber 2.5D centrepiece (Live; surge variant)

  cart/
    CartButton.tsx                 Sticky bottom checkout bar
    CartDrawer.tsx                 Right-side glass drawer
    CartUpsellModal.tsx            Temu-style escalating popup
    ExitIntent.tsx                 One-time exclusive code modal

  social-proof/
    ViewerTicker.tsx               "X viewing" — smart policy from state-engine
    JustBoughtTicker.tsx           "Y just bought from Lagos" — throttled, city-only

  checkout/CheckoutClient.tsx      Inline guest checkout

lib/
  api.ts                           Hub API client (fetchCampaign, postSignup, postCheckout)
  cart-store.ts                    Zustand persisted cart
  cn.ts · format.ts · ics.ts       Utilities
  state-engine.ts                  Before / Live / Ended (+ vip_window, last_call, sold_out_hold, waitlist)
  types.ts                         Landing payload types

styles/globals.css                 Maroon Noir tokens + glass + drift + .cta-sheen + .ended-fade
tailwind.config.ts                 Token-driven Tailwind (mirrors the admin canon)
```

## State machine

The page state derives from the campaign's `state` field plus the times.

| State                | Hero variant              | Visible blocks                                            |
| -------------------- | ------------------------- | --------------------------------------------------------- |
| `before`             | Countdown ring (3D)       | Countdown + Newsletter + VIP signup + Story/FAQ           |
| `before_vip_window`  | Countdown ring + VIP pill | Same as before, plus a VIP-access banner                  |
| `live`               | Hero centrepiece (3D)     | Everything — bundles, tiers, products, lookbook, stock    |
| `live_last_call`     | Surge palette + breathe   | Same as live; tickers tick faster                         |
| `live_sold_out_hold` | Hero centrepiece          | Live blocks; sold-out cards switch to preorder if enabled |
| `ended`              | Monochrome fade           | Ended farewell + redirect-to-storefront CTA               |
| `ended_waitlist`     | Monochrome fade           | "Next drop: …" + signup link to the next campaign         |

## Non-negotiables (canon)

- **Token-driven theming** — never inline hex, font, or radius. Layer-B brand tints set via `data-business="…"` on `<html>`.
- **Glass surfaces** on every overlay (drawer, modal, popup, ticker).
- **Money via the `money()` helper** — NGN truth, locale-formatted.
- **Pricing floors are enforced server-side** — the Hub's discount engine rejects prices that would dip below `pricing_floors.min_price`. The landing never recomputes a price client-side.
- **Permission-aware admin** lives in `apps/admin`; this landing app is public — every endpoint it calls is `/api/public/*`.
- **Honest social proof** — viewer count is smart-hidden below the floor, "just bought" tickers come from real orders only.
- **DHL is real** — no free-shipping meter. The slot is repurposed for the next tier-ladder rung.

## Open follow-ups (not in PR 2)

- Socket.io subscription for live viewer count + just-bought events (currently driven by payload snapshot).
- Apple Wallet / Google Pay pass with refresh on state transitions.
- Cart abandonment recovery is driven by a backend cron — wire the per-user identifier client-side.
- Multi-currency display: detect via `Accept-Language` + IP geo and toggle `Currency` in `lib/format.ts`.
- Multi-vendor checkout (let the Hub's `payment-link.service` decide gateway) instead of the user picking.
