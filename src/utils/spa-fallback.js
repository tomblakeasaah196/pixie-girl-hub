"use strict";

/**
 * SPA fallback routing decision (server.js).
 *
 * For a non-/api, non-/media GET that express.static did NOT resolve to a
 * real file, the server must decide:
 *   - STATIC ASSET  → let it fall through to a clean JSON 404 (a missing
 *                     hashed chunk / favicon means a partial deploy; we
 *                     must NOT answer with index.html, or the browser gets
 *                     HTML where it expected JS/CSS — "MIME type
 *                     ('text/html') is not a supported stylesheet").
 *   - SPA ROUTE     → serve index.html so React Router owns it.
 *
 * The OLD heuristic treated ANY path ending in `.<alphanumerics>` as a
 * file (`/\.[a-z0-9]+$/i`). That misfired catastrophically on every
 * token-in-path public route. A JWT is `header.payload.signature`, and a
 * signature is 43 base64url chars (alphabet A-Za-z0-9-_). When it happens
 * to contain NO `-` and NO `_` — which is ~(62/64)^43 ≈ 26% of the time —
 * the trailing `.signature` looked exactly like a file extension, so
 * `/order/capture/<jwt>` (and `/welcome/:token`, `/sign/:token`,
 * `/offer/:token`) got 404'd ("Route not found") at random for roughly
 * one customer in four, instead of loading the page.
 *
 * Fix: only treat a path as a static asset when it ends in a REAL
 * web-asset extension from an allow-list. A JWT's trailing
 * `.<43-char-base64url>` is never one of these, so the SPA is always
 * served; a genuinely missing `/assets/x.js` or `/favicon.ico` still 404s
 * cleanly. Anything under `/assets/` is always an asset (Vite's hashed
 * output lives there) regardless of extension.
 */
const STATIC_ASSET_EXT =
  /\.(?:js|mjs|cjs|css|map|json|webmanifest|txt|xml|ico|png|jpe?g|gif|svg|webp|avif|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac|pdf|wasm|zip|csv)$/i;

/**
 * @param {string} pathname  Express `req.path` (no query string).
 * @returns {boolean} true → treat as static asset (fall through to 404);
 *                    false → serve the SPA shell.
 */
function isStaticAssetPath(pathname) {
  if (typeof pathname !== "string" || pathname.length === 0) return false;
  if (pathname.startsWith("/assets/")) return true;
  // Only the final path segment can be a filename — a dot in an earlier
  // segment (or in a JWT's header/payload) must never count.
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return STATIC_ASSET_EXT.test(lastSegment);
}

module.exports = { isStaticAssetPath, STATIC_ASSET_EXT };
