# apps/stylist — Stylist Partner Programme portal

The public + partner-facing web app for the **Stylist Partner Programme**
(V2.2 §6.26). One deploy, host-agnostic — `style.pixiegirlglobal.com` by
default; the actual subdomain lives in
`shared.stylist_programme_config.portal_subdomain` and DNS decides.
TanStack Start (React 19, SSR) + Tailwind v4, wired entirely to the Hub API.

> Not the storefront (`apps/storefront`) and not the sales landing
> (`apps/landing`). Per the spec, this app never edits either — it is the
> partner surface only.

## Surfaces

| Route                    | What                                                                             | PR  |
| ------------------------ | -------------------------------------------------------------------------------- | --- |
| `/`                      | Programme landing — elite-network positioning, how it works, tiers, badge story  | PR3 |
| `/apply`                 | Application wizard: profile → portfolio → questionnaire (API-driven) → docs      | PR3 |
| `/verify/badge/:token`   | Live badge verification (the QR target — revocation shows instantly)             | PR3 |
| `/stylists`              | Public certified-partner directory                                               | PR3 |
| `/review/:token`         | Tokenised customer review — confirms satisfaction, releases the quality hold     | PR3 |
| `/login`, `/set-password`, `/dashboard/*` | Partner dashboard (offers, earnings, referrals, badge, contract) | PR4 |

## Run

```bash
cd apps/stylist
npm install
npm run dev               # http://localhost:3002 (proxies /api → :7000)
```

Start the Hub backend first (`npm run dev` at the repo root). All data comes
from `/api/public/stylist-programme/*` (public) and `/api/v1/stylist-portal/*`
(partner JWT — PR4).

## Production

`npm run build` emits a runnable Nitro server at `.output/server/index.mjs`
(same deployment shape as `apps/storefront` — see
`docs/STOREFRONT_DEPLOYMENT.md` §5). Point the portal subdomain at it and
forward `/api/*` to the Hub backend at the edge.
