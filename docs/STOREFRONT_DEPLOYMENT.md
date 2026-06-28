# Storefront Website — Deployment Guide (both brands)

**Status:** Deployment SSOT for `apps/storefront`. Grounded in the live repo (2026-06-27).
**Goal:** Serve the customer-facing Storefront Website on the **main domains of both brands** —
`thefaitlynbrand.com` / `faitlynhair.com` → `faitlynhair`, and `pixiegirlglobal.com` → `pixiegirl` —
from **one deployed SSR process**, rendering per-brand from the request **Host header**.

> This is the **Storefront Website**, not the Sales Campaign Landing (`apps/landing`, `sale.<brand>`).
> The two never share a process, a cart, or imports. See `docs/STOREFRONT_IMPLEMENTATION_GUIDE.md` §0.

---

## 1. Why a single process serves both brands

The storefront is **TanStack Start (React 19 + Nitro SSR)** — it runs as a long-lived Node server,
not a static bundle. Brand is **not** baked into the build: every SSR loader resolves it per request:

```ts
// apps/storefront/src/routes/__root.tsx (already implemented)
const req = getWebRequest();
brand = brandFromHost(req?.headers.get("host"));   // host → "faitlynhair" | "pixiegirl"
```

`brandFromHost()` (`src/lib/brand.ts`) maps each apex/`www` host to a brand and falls back to
`DEFAULT_BRAND` for unknown hosts. The brand is then sent to the Hub on every server-side fetch as
`X-Brand-Context`, and stamped onto `<html data-brand>` so the browser inherits it.

**Consequence:** one PM2 instance, one port, two (or more) domains pointed at it. nginx does not need
to know about brands — it just forwards the original `Host`. Adding a brand later = a DNS record + one
line in `HOST_BRAND_MAP`, no new process.

---

## 2. Topology

```
                          ┌────────────────────────── VPS ──────────────────────────┐
 thefaitlynbrand.com ─┐   │                                                          │
 faitlynhair.com      ├──▶ nginx :443 ──┬─ Host: *faitlyn*  ─┐                        │
 www.* (both)         │   │             │                    ├─▶ storefront SSR :3002 │  (one PM2 app,
 pixiegirlglobal.com ─┘   │             └─ Host: *pixie*    ─┘     brand from Host     │   both brands)
                          │                                                          │
                          │   /api/*  /media/*  ───────────────▶ Hub API :7000       │  (pm2: pixie-girl-hub)
                          │   sale.<brand> ────────────────────▶ landing SSR :3000   │  (pm2: pixie-girl-landing)
                          └──────────────────────────────────────────────────────────┘
                                              postgres :5432   redis :6379
```

Port assignments (avoid the existing collisions — landing already uses 3000):

| Process            | PM2 name              | Port |
|--------------------|-----------------------|------|
| Hub API            | `pixie-girl-hub`      | 7000 |
| Sales Landing      | `pixie-girl-landing`  | 3000 |
| **Storefront**     | **`pixie-girl-storefront`** | **3002** |

---

## 3. Prerequisites (run once, on the live box)

1. **Database** — the storefront migrations already exist in the repo; apply them:
   ```bash
   npm run db:migrate:shared      # 000242 customer_auth, 000243 storefront_studio_ext
   npm run db:repair              # applies template 000062 shades to pixiegirl + faitlynhair
   npm run db:verify
   ```
2. **`business_config` rows** for both brands must have:
   - `storefront_domain` set to the apex host (drives `X-Brand-Context` table-driven fallback).
   - `storefront_enabled = true` (kill-switch; `false` → branded "coming soon", catalogue/checkout 404).
3. **DNS** — point both apexes + `www` at the VPS (A / CNAME) **before** TLS issuance.
4. **TLS** — issue certs for all four names (`certbot --nginx -d thefaitlynbrand.com -d www.thefaitlynbrand.com -d pixiegirlglobal.com -d www.pixiegirlglobal.com`, plus `faitlynhair.com` if used).

---

## 4. Environment (`apps/storefront/.env`)

```bash
# Server-side base for all SSR fetches to the Hub (same box → localhost).
HUB_API_URL=http://127.0.0.1:7000

# Fallback brand when a host is not in HOST_BRAND_MAP (unknown/preview hosts only).
DEFAULT_BRAND=pixiegirl

# SSR listen port (matches ecosystem + nginx upstream).
PORT=3002
```

Notes:
- `VITE_API_PROXY_TARGET` / `VITE_STOREFRONT_BRAND` are **dev-only** (the Vite proxy). Not used in prod.
- No Supabase keys — by design. If anything asks for `VITE_SUPABASE_*`, that file isn't ported yet.
- The httpOnly customer refresh cookie is forwarded by `src/lib/api.ts` automatically; nginx must pass
  cookies through (default) and keep the same parent domain per brand for cookie scoping.

---

## 5. Build & release

```bash
# from repo root
cd apps/storefront
npm ci
npm run build            # TanStack Start → Nitro server bundle in .output/
```

The build emits a Nitro server at `apps/storefront/.output/server/index.mjs`. Production start is
`node .output/server/index.mjs` with `PORT=3002` (wired in `ecosystem.config.js`, §6).

Root convenience scripts were added to drive this from the repo root:

```bash
npm run storefront:install   # cd apps/storefront && npm ci
npm run storefront:build     # cd apps/storefront && npm run build
npm run storefront:start     # PORT=3002 node apps/storefront/.output/server/index.mjs
```

> **First-deploy caution:** the storefront has not yet been CI build-verified (`apps/storefront/PORTING.md`).
> Run `npm run storefront:build` once on a staging checkout and pin any TanStack Start version drift
> before the production cutover. If the standard plugin fails, see PORTING.md → "Build fallback".

---

## 6. Process management (PM2 — one instance)

`ecosystem.config.js` gains a third app (added in this change):

```js
{
  name: "pixie-girl-storefront",
  script: ".output/server/index.mjs",
  cwd: "/var/www/pixie-girl-hub/apps/storefront",
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: "1G",
  env: {
    NODE_ENV: "production",
    PORT: 3002,
    HUB_API_URL: "http://127.0.0.1:7000",
    DEFAULT_BRAND: "pixiegirl",
  },
}
```

Deploy / reload:

```bash
git pull
npm ci --omit=dev
npm run db:migrate:shared && npm run db:repair      # if migrations changed
npm run storefront:install && npm run storefront:build
pm2 reload ecosystem.config.js --only pixie-girl-storefront
pm2 save
```

One process, both brands. To roll back: `pm2 reload` the previous build, or `pm2 stop pixie-girl-storefront`
(domains then show nginx 502 — set `storefront_enabled=false` first for a graceful "coming soon").

---

## 7. nginx (both apexes → one upstream)

```nginx
upstream storefront { server 127.0.0.1:3002; keepalive 32; }

# --- Faitlyn ---
server {
  listen 443 ssl http2;
  server_name thefaitlynbrand.com www.thefaitlynbrand.com faitlynhair.com www.faitlynhair.com;
  # ssl_certificate ... ssl_certificate_key ...;

  location /api/   { proxy_pass http://127.0.0.1:7000; include /etc/nginx/proxy_params; }
  location /media/ { proxy_pass http://127.0.0.1:7000; include /etc/nginx/proxy_params; }
  # sitemap.xml is generated per-brand by the backend (host → brand).
  location = /sitemap.xml { proxy_pass http://127.0.0.1:7000/sitemap.xml; include /etc/nginx/proxy_params; }

  location / {
    proxy_pass http://storefront;
    proxy_http_version 1.1;
    proxy_set_header Host $host;                 # CRITICAL: brand is resolved from this
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;     # GeoIP currency uses the client IP
    proxy_set_header Upgrade $http_upgrade;      # Socket.io (order tracking)
    proxy_set_header Connection "upgrade";
  }
}

# --- Pixie Girl --- (identical block, server_name pixiegirlglobal.com www.pixiegirlglobal.com)
```

The two `server` blocks are byte-identical except `server_name`; both proxy to the same upstream.
**`proxy_set_header Host $host` is the load-bearing line** — drop it and every request resolves to
`DEFAULT_BRAND`. Keep `sale.<brand>` pointing at the landing app's port (unchanged).

---

## 8. Post-deploy verification

```bash
# Brand resolves from Host on a single upstream:
curl -s -H "Host: thefaitlynbrand.com"  http://127.0.0.1:3002/ | grep -o 'data-brand="[a-z]*"'   # faitlynhair
curl -s -H "Host: pixiegirlglobal.com"  http://127.0.0.1:3002/ | grep -o 'data-brand="[a-z]*"'   # pixiegirl

# Catalogue + geo reachable through the same host:
curl -s https://thefaitlynbrand.com/api/public/storefront/products | head
curl -s https://pixiegirlglobal.com/api/public/geo/currency
```

Acceptance:
- Each apex renders its own brand (`<html data-brand>`), theme, catalogue.
- `/api/*` and `/media/*` proxy to the Hub; storefront orders land in **Sales → Orders** as channel `storefront`.
- `storefront_enabled=false` serves a branded "coming soon", not a stack trace.
- No imports/links to `apps/landing`; `sale.<brand>` still served by the landing process.

---

## 9. Operational notes

- **Logs:** `pm2 logs pixie-girl-storefront`. SSR errors surface via the Start error middleware (`src/start.ts`).
- **Cache:** the `/site` (published Studio config) response is cached ~60s; theme/nav edits appear within the TTL.
- **Scaling:** if SSR CPU becomes the bottleneck, bump `instances` to `"max"` (cluster mode) — brand
  resolution is stateless per request, so cluster mode is safe. Cart/session state lives in Postgres/cookies, not memory.
- **Adding a brand:** DNS record → add the host to `HOST_BRAND_MAP` + a `business_config` row → add an
  nginx `server` block (same upstream). No new process, no rebuild of the others.
```

