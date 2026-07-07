# Kaizen — Frontend Error Reporting Rollout (Phase 1)

How to make each client app report its crashes to Kaizen. The backend ingest
endpoint (`POST /api/v1/kaizen/ingest/client-error`) and the reusable reporter
already exist; this is the per-app wiring.

## What already exists

- **Backend:** ingest endpoint (guarded by `X-Kaizen-Ingest-Key` + origin
  allowlist + rate limit + 100 KB cap), server/worker/process capture, grouping,
  auto-reopen, resolve/ignore/export. See `src/modules/kaizen/errors/`.
- **Reference reporter + boundary (already wired in Kaizen itself):**
  `apps/kaizen/src/lib/errorReporter.ts` and `apps/kaizen/src/components/ErrorBoundary.tsx`.

## Per-app steps (admin, storefront, stylist, landing)

For each app:

1. **Copy the reporter** `apps/kaizen/src/lib/errorReporter.ts` into the app's
   `src/lib/` (it is framework-agnostic and dependency-free). Copy
   `ErrorBoundary.tsx` too if the app doesn't already have one — several apps do
   (e.g. `apps/admin/src/components/common/ErrorBoundary.tsx`); in that case just
   add a `reportError(error, "<source>")` call in its `componentDidCatch`.

2. **Install the hooks at startup** — in the app's `main.tsx`/entry, before
   rendering:

   ```ts
   import { installErrorReporter } from "@/lib/errorReporter";
   installErrorReporter({ source: "admin" }); // "storefront" | "stylist" | "landing"
   ```

   And wrap the root in the boundary (or reuse the existing one, adding the
   `reportError` call).

3. **Set the build-time env vars** (per app `.env` / deploy):

   ```
   VITE_KAIZEN_INGEST_URL=https://kaizen.pixiegirlglobal.com/api/v1/kaizen/ingest/client-error
   VITE_KAIZEN_INGEST_KEY=<same value as backend KAIZEN_INGEST_KEY>
   VITE_APP_VERSION=<git short sha or build id>   # optional
   ```

   If URL or KEY is unset the reporter is a **no-op**, so dev builds stay quiet.
   The ingest key is a low-sensitivity static key (it only permits rate-limited,
   origin-allowlisted error reporting) — safe to embed in the client bundle, per
   guide §7.3.

## Backend env to set (once)

```
KAIZEN_INGEST_KEY=<generate: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))">
KAIZEN_INGEST_ALLOWED_ORIGINS=https://admin.pixiegirlglobal.com,https://pixiegirlglobal.com,https://kaizen.pixiegirlglobal.com,https://<storefront>,https://<stylist>
```

Add every client origin that should be allowed to report. The Kaizen host is
included so Kaizen's own crashes report too.

## Cloudflare Access caveat (important)

Since we're putting a Cloudflare Access policy in front of
`kaizen.pixiegirlglobal.com`, the ingest path must be reachable **without** a
human Access login (the client apps call it machine-to-machine). Add an Access
**bypass / service-token** rule for the path
`kaizen.pixiegirlglobal.com/api/v1/kaizen/ingest/*` so browser error reports
from admin/storefront/etc. aren't redirected to the Access login page. The
static ingest key + origin allowlist + rate limit remain the guard on that path.

## Verify

- Throw a test error in one app; confirm a 202 from the ingest endpoint and a
  new grouped row in Kaizen → Errors with `source` = that app.
- Confirm no PII (emails/phones/tokens) appears in the stored occurrence — the
  reporter scrubs client-side and the server scrubs again.
- Send the same error twice within 5s → the client dedupe drops the repeat; send
  it later → the group's `occurrence_count` increments (one row, not two).
