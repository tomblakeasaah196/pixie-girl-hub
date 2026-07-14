# Upload size limits — fixing HTTP 413 on file uploads

**Symptom:** uploading a file (most often a looping video in Storefront
Studio) fails instantly or part-way with **HTTP 413 (Content Too Large)** on
the live server, while the same upload works in local dev. This is the
"works locally, fails live" gotcha for uploads, the same species as
`docs/PDF_RENDERING_SETUP.md` is for PDFs.

## Why it happens

A request body passes through up to three gatekeepers, each with its own
cap. **The smallest one wins**, and only the last one belongs to this app:

```
Browser ──▶ Cloudflare ──▶ nginx ──▶ Node/Express (the app)
             plan cap       client_max_body_size    multer / express.json
```

| Layer | Cap | Where it's set | 413 body |
| --- | --- | --- | --- |
| Cloudflare (orange-clouded records only) | **100MB** on Free/Pro, 200MB Business, 500MB+ Enterprise | Cloudflare plan | Cloudflare HTML page |
| nginx | `client_max_body_size` — **defaults to 1MB** when the directive is absent; our reference blocks (`ops/kaizen/nginx-kaizen.conf`, `docs/STOREFRONT_DEPLOYMENT.md` §7) use `20m` | the site's `server`/`location` block on the box | nginx HTML page |
| App — video upload | **200MB** (multer disk storage) | `src/modules/storefront_studio/studio.routes.js` `VIDEO_MAX_BYTES` | JSON `FILE_TOO_LARGE` with a friendly `user_message` |
| App — all image uploads (branding/logo/favicon/OG/section images via Storefront Studio, catalogue/styled-variant product images) | multer accepts the raw file (25MB on the Studio route, 200MB — `MEDIA_MAX_FILE_SIZE_MB` — on the catalogue routes); `compressUploadChecked` then applies the real policy: reject raw uploads over 20MB, else compress (resize + re-encode) and re-check the *result* against a 10MB stored ceiling | `src/services/media-compression.service.js` (`compressUploadChecked`, used by `studio.service.js`, `catalogue.service.js`, `styled_variants.service.js`) | JSON `IMAGE_TOO_LARGE`/`FILE_TOO_LARGE` with a friendly `user_message` |
| App — JSON bodies | 10MB | `src/middleware/index.js` (`express.json`) | JSON error |

**How to tell who rejected it:** the app's own 413 is JSON with an
`error.code` (`FILE_TOO_LARGE`) and a human message, which the admin UI
shows verbatim. A 413 that surfaces in the UI as a bare **"HTTP 413"** had a
non-JSON body — it came from nginx or Cloudflare and **never reached the
app**, so nothing in this repo's Node code can fix it.

## The fix (nginx, on the deploy box)

Raise the body cap for the hub's server block — ideally scoped to just the
upload routes so the rest of the API keeps a small cap:

```nginx
server {
    server_name hub.pixiegirlglobal.com;
    # ... existing TLS / root / SPA fallback ...

    # Studio video upload: raw phone clips can be 100MB+. Cap slightly above
    # the app's own 200MB multer limit so the app's friendly FILE_TOO_LARGE
    # message (not an nginx error page) is what an over-limit user sees.
    location = /api/v1/storefront-studio/upload-video {
        proxy_pass http://127.0.0.1:7000;
        include /etc/nginx/proxy_params;
        client_max_body_size 210m;
        proxy_request_buffering off;   # stream to Node; don't spool 200MB to nginx tmp first
        proxy_read_timeout 300s;       # FFmpeg trims/compresses after the upload finishes
    }

    location /api/ {
        proxy_pass http://127.0.0.1:7000;
        include /etc/nginx/proxy_params;
        client_max_body_size 20m;      # generous default for the rest of the API
    }

    # ... /media/, /socket.io/ blocks unchanged ...
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`.

Notes:

- The hub's live server block is **not** checked into this repo (only the
  kaizen console's and the storefront's reference blocks are), so this must
  be applied on the box / in the hosting panel's vhost editor. Mind the
  panel `{{root}}` duplicate-directive gotcha documented at the top of
  `ops/kaizen/nginx-kaizen.conf`.
- `client_max_body_size` can sit at `http`, `server` or `location` level;
  a `location`-level value overrides the outer ones, which is what makes
  the scoped fix above safe.
- `proxy_request_buffering off` also keeps the browser's upload progress
  bar honest — with buffering on, nginx swallows the whole body first and
  the app only sees it afterwards.
- The app's own image-upload ceiling (20MB raw intake, `compressUploadChecked`)
  sits right at the reference `client_max_body_size 20m` used for the generic
  `/api/` block above — no headroom. If the live box's `/api/` block is also
  set to `20m`, a photo just over 20MB gets nginx's bare, unfriendly 413
  instead of the app's `IMAGE_TOO_LARGE` message. Same fix as the video
  route: give the API block a little headroom (e.g. `client_max_body_size
  25m`) so the app's own ceiling — and its friendly error — is always what
  wins.

## The Cloudflare ceiling

If `hub.pixiegirlglobal.com` is **orange-clouded** (proxied) on a Free or
Pro plan, Cloudflare rejects request bodies over **100MB** with its own 413
— no nginx setting can help. Options, in order of preference:

1. Keep clips under 100MB (a 10s phone clip almost always is; a multi-minute
   4K recording is not — trim on the phone first).
2. Grey-cloud (DNS-only) the hub record so uploads bypass Cloudflare.
3. Upgrade the zone plan (Business raises the cap to 200MB).

## How the app behaves today

- The Studio upload UI pre-checks the file against the app's 200MB cap
  before uploading.
- If a proxy still answers 413 (`apps/admin/src/pages/storefront-studio/VideoField.tsx`),
  the operator gets a toast explaining the file was blocked *before reaching
  the app*, with the file size and a report action that points triage at
  this document.
- Over-limit files that do reach the app get multer's `LIMIT_FILE_SIZE`
  translated into a friendly `FILE_TOO_LARGE` JSON error — both the video
  route (`acceptVideoUpload`) and the image route (`acceptImageUpload`) in
  `src/modules/storefront_studio/studio.routes.js` do this, so a too-big
  upload never surfaces as an opaque 500.
