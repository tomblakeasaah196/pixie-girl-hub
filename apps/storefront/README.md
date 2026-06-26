# apps/storefront — Storefront Website

The customer-facing **Storefront Website** for Pixie Girl Hub, one deploy per
brand by host (`pixiegirlglobal.com`, `thefaitlynbrand.com`, …). TanStack Start
(React 19, SSR) + Tailwind v4, wired entirely to the Hub API. **No Supabase.**

> This is **not** the Sales Campaign Landing (`apps/landing`, `/sale/:slug`).
> See `docs/STOREFRONT_IMPLEMENTATION_GUIDE.md` §0 for the hard separation rule.

## Status: Phase 0 scaffold
Foundation only — brand routing, Hub API client, geo-currency, SSR theme
injection, design tokens, and a minimal home that loads products from the Hub.
The full catalogue/cart/checkout/account UI is **ported from the reference**
(`client folder for hub-system/Reference Node.js E-commerce Platform`) per
`PORTING.md` (Phases 1–4 in the guide).

## Run
```bash
cd apps/storefront
cp .env.example .env      # set HUB_API_URL / DEFAULT_BRAND
npm install
npm run dev               # http://localhost:3000 (proxies /api → :7000)
```
Force a brand in dev with `?brand=faitlynhair` host substring or
`VITE_STOREFRONT_BRAND` in `.env`.

## Layout
```
src/
  lib/api.ts          # the one Hub client (replaces all Supabase calls)
  lib/brand.ts        # host → brand (X-Brand-Context)
  lib/currency.ts     # /api/public/geo/currency + money formatting
  lib/utils.ts        # cn() (from reference)
  routes/__root.tsx   # SSR shell: brand + published Studio theme tokens
  routes/index.tsx    # home (scaffold placeholder)
  styles.css          # design tokens (verbatim from reference)
```

See `PORTING.md` for the route-by-route port plan and the Supabase→Hub map.
