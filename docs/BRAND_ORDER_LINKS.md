# Brand-domain order links (`/o/<slug>`)

## What changed & why

The shared-catalogue order link used to be a **signed JWT baked into the URL
path** — the whole cart (item ids, styled specs, prices) was encoded into
`hub.pixiegirlglobal.com/order/capture/<~1,400-char-token>`. Two problems:

1. **Instagram rejected it.** IG caps DM messages at 1,000 characters
   (`code 100 subcode 2534038`); the link alone blew past that.
2. **Wrong brand on the URL.** A Faitlyn customer opened a
   `pixiegirlglobal.com` link and hesitated to pay.

Now:

- The cart lives in `shared.smartcomm_order_links` (it already did). The URL
  carries only a **short, unguessable slug** (`public_slug`, 12 base64url
  chars): `https://faitlynhair.com/o/Ab3xK9mP2q` — ~40 chars, well under the
  IG cap.
- The link is minted on the **brand's own customer-facing domain**
  (`business_config.storefront_domain`) via
  `src/utils/brand-urls.js` → `orderLinkUrl(brand, slug)`. Pixie links read
  `pixiegirlglobal.com`, Faitlyn links read `faitlynhair.com`.
- The old `/order/capture/:token` route and the JWT minter are **removed**
  (clean break — links already in a customer's DM stop working; re-share from
  the thread).

## The one-time ops step (required for #3)

The `/o/<slug>` checkout page and the public API it calls are served by the
**Hub app** (the admin deployment). For a brand domain to serve them, that
host must route the following paths to the Hub app (reverse proxy, or a
CNAME/host alias if the Hub already answers on that host):

| Path              | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `/o/*`            | the checkout SPA route (React Router owns it)          |
| `/pay/*`          | the pay page / gateway return                          |
| `/welcome/*`      | onboarding form (already hub-hosted; leave as-is)      |
| `/assets/*`       | hashed JS/CSS the SPA loads                             |
| `/api/public/*`   | the public endpoints the page calls (`order-link`, `order-form`, `pay`, `storefront` geo, `catalogue`) |

Example (nginx on `faitlynhair.com`):

```nginx
location ~ ^/(o|pay|welcome|assets)/ { proxy_pass https://hub-app-origin; }
location /api/public/            { proxy_pass https://hub-app-origin; }
```

Until a brand's `storefront_domain` is configured (and its host proxies the
above), `orderLinkUrl` falls back to `STOREFRONT_BASE_URL` / the hub base, so
links still resolve in dev — they just won't show the brand domain.

Enabling another brand later is config only: set its `storefront_domain` in
Business Setup and point the host at the Hub app — no code change.

## Payment

Placing an order from `/o/<slug>` creates a real Sales order, then the page
redirects **straight to the active payment gateway** (Nomba today) via
`POST /api/public/pay/<public_tracking_token>`:

- **Pay in full** → charges the full balance.
- **Flexi Pay (instalment)** → charges the plan deposit (`pay_now_ngn`,
  computed server-side).
- **Service-only** (bookings, no product order) → no redirect; the team
  confirms and follows up.

The active gateway is chosen per brand in **Sales → Payments → Payment
gateways** (toggle a provider on/off) and configured (credentials, currencies,
fees) in **Settings → Payment Gateways**. The gateway chain routes Nomba-first
for NGN; adding Stripe/Paystack/OPay later is a one-click activation once their
credentials exist.

The displayed order total is NGN, with a `≈ $X` equivalent computed from the
brand's **Catalogue → Config USD exchange rate** (`catalogue_config.usd_fx_rate`,
via `currency.service.systemFxRate`).
