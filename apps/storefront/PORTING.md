# Storefront — porting from the Aura reference

This app was **scaffolded clean**, not copied wholesale. It establishes the
Supabase-free, Hub-wired foundation (brand routing, API client, geo-currency,
SSR theme injection, design tokens). The rest is **ported route-by-route** from
the reference, replacing every Supabase call with a Hub API call.

> **Hard rule:** this is the Storefront **Website**. It is NOT the Sales
> Campaign Landing (`apps/landing`, `/sale/:slug`). Never import from it, never
> reuse its cart. Shared infra is only `salesService.createOrder` + payment rails
> (server-side). See `docs/STOREFRONT_IMPLEMENTATION_GUIDE.md` §0.

## Where the reference lives
`client folder for hub-system/Reference Node.js E-commerce Platform/` (on this
branch). It is the **engineering reference to clone and simplify** (CLAUDE.md).
Copy design/components/routes from there; do **not** copy any `supabase` code.

## What's already done in this scaffold
- `src/lib/api.ts` — the ONE Hub client (replaces all of `integrations/supabase/*`
  and every `*.functions.ts`). Brand header + cookie forwarding + envelope.
- `src/lib/brand.ts` — host → brand (replaces reliance on a Supabase project).
- `src/lib/currency.ts` — `/api/public/geo/currency` (replaces the `geo.ts` stub).
- `src/routes/__root.tsx` — SSR shell: brand + published Studio theme tokens.
- `src/routes/index.tsx` — minimal home proving catalogue wiring.
- `src/styles.css` — design tokens **copied verbatim** from the reference (the
  Aura look is preserved). Keep using token utilities (`bg-ink`, `text-cream`…).

## Supabase → Hub replacement map
Delete each reference file's Supabase usage; call these Hub endpoints via `api`.
Endpoints are specced in the implementation guide §5 (catalogue/cart/checkout),
§6 (pricing/payments), §7 (auth).

| Reference file (`src/lib/…`) | Replace with Hub endpoint(s) |
|---|---|
| `integrations/supabase/*` (client, auth-attacher, auth-middleware, types) | **Delete.** Use `src/lib/api.ts`. |
| `auth.tsx` | `POST /api/public/auth/{register,login,refresh,logout,verify-email,forgot,reset}`, `GET /api/public/auth/me` (§7) |
| `products.ts` | `GET /api/public/storefront/products`, `/products/:slug` (§5.1) |
| `bundles.ts` | `GET /api/public/storefront/bundles`, `/bundles/:slug` (§5.1) |
| `pricing.ts` | **Delete client math.** Use server `effective_price_ngn` / `effective_price_usd` (§6.1) |
| `cart.tsx` | `POST/GET/PATCH/DELETE /api/public/storefront/cart[/items[/:id]]`, `/cart/merge`, `/cart/coupon`, `/cart/quote` (§5.2/§5.3) |
| `currency.tsx` + `geo.ts` | `src/lib/currency.ts` → `GET /api/public/geo/currency` (§5.4) |
| `wishlist.ts` | account wishlist endpoints (`customer_wishlists`) (§5.6/§8.7) |
| `orders.functions.ts` | `POST /api/public/storefront/checkout`; tracking via `GET /api/public/storefront/track/:token` (§5.3/§8.8) |
| `services.functions.ts` | `GET /api/public/storefront/services[/:slug]`, `POST …/booking-request` (§5.6) |
| `bookings.functions.ts` | same services/booking endpoints (§5.6) |
| `site-content.ts`, `site-content.functions.ts`, `use-site-content.ts`, `theme.tsx` | `GET /api/public/storefront/site` (published Studio theme/nav/pages/popups) (§5.6/§9) |
| `seo.ts` | per-page SEO from `storefront_pages` via `/site` (§9 SEO tab) |
| `lovable-error-reporting.ts`, `error-capture.ts`, `error-page.ts` | Replace with Hub error reporting or drop. **No Lovable.** |

## Routes to port (file-based; guide §8.1)
`shop.tsx`, `shop.$category.tsx`, `product.$slug.tsx` (colour/size/lace **boxes**
→ `styled_variant_id`), `shades.tsx` + `shades.$slug.tsx` (**NEW** browse axis),
`collections.*`, `bundles.*`, `services.*`, `cart.tsx`, `checkout.tsx`,
`checkout.thank-you.tsx`, `track.$token.tsx`, `install.$token.tsx`, `auth.tsx`,
`_authenticated/*` (account/orders/addresses/wishlist/loyalty/referrals/prefs),
`about`, `contact`, `journal`, `policies.*`, `sitemap.xml`.

When you add a route file, the TanStack Start plugin regenerates
`src/routeTree.gen.ts` on `vite dev` (it's gitignored).

## Acceptance (Phase 0 → Phase 1 gate)
- `grep -ri supabase apps/storefront/src` returns **only explanatory comments**
  (no imports, no `supabase.*` calls); no `@supabase/*` or `@lovable.dev/*` in
  `package.json` (the word only appears in the package description). ✅
- `npm install && npm run dev` boots; home renders brand theme + products from
  the Hub. ⚠️ **Not yet install/build-verified in CI** — run it once and pin any
  TanStack Start version drift (see below).

## Build fallback
If the standard `@tanstack/react-start/plugin/vite` setup in `vite.config.ts`
hits a version mismatch, the reference builds via `@lovable.dev/vite-tanstack-config`
(`vite.config.ts` there). You may temporarily adopt that wrapper to unblock,
but the goal is to stay off Lovable-specific tooling.
