/**
 * Link preview (unfurl) service.
 *
 * Given a URL shared inside the messaging module, fetch the page and extract
 * the Open Graph / Twitter-card / bare-HTML metadata (title, description,
 * image, site name, favicon) so the chat can render a WhatsApp-style preview
 * card. Purely read-only — we never follow actions on the page, only read its
 * <head> metadata.
 *
 * Safety (this endpoint fetches an arbitrary, user-supplied URL, so SSRF is
 * the headline risk):
 *   - http/https only; no file://, gopher://, etc.
 *   - Every socket connection (initial request AND every redirect hop) runs
 *     through a custom `lookup` that resolves the host and REFUSES to connect
 *     to a private / loopback / link-local / reserved address. That closes the
 *     DNS-rebinding hole a one-shot "resolve then fetch" check would leave
 *     open, because the guard runs at connect time on the very address the
 *     socket will use.
 *   - Bounded: short timeout, capped redirects, capped body size, browser UA.
 *   - Only text/html (and direct images) are parsed; anything else is ignored.
 *
 * Results are cached in Redis (positive + negative) so a busy thread doesn't
 * re-fetch the same link on every render / every operator.
 */

"use strict";

const http = require("http");
const https = require("https");
const dns = require("dns");
const net = require("net");
const crypto = require("crypto");
const axios = require("axios");
const { getClient: getRedis } = require("../config/redis");
const { logger } = require("../config/logger");
const { AppError } = require("../utils/errors");

const CACHE_PREFIX = "linkpreview:v1:";
const CACHE_TTL_OK = 24 * 60 * 60; // 24h — metadata rarely changes
const CACHE_TTL_FAIL = 30 * 60; // 30m — let transient failures retry sooner
const FETCH_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
const MAX_BYTES = 1_500_000; // 1.5 MB — the <head> is always near the top
const USER_AGENT =
  "Mozilla/5.0 (compatible; PixieGirlHubBot/1.0; +link-preview)";

/**
 * Is this a private / loopback / link-local / reserved IP we must never let
 * the fetcher connect to? Covers the ranges an internal service or cloud
 * metadata endpoint would live on. Pure string/range maths, no network.
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedAddress(ip) {
  const addr = String(ip || "").trim().toLowerCase();
  if (!addr) return true;

  const family = net.isIP(addr);

  if (family === 4) {
    const parts = addr.split(".").map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // 224.0.0.0/4 multicast + 240/4 reserved
    return false;
  }

  if (family === 6) {
    // Normalise IPv4-mapped IPv6 (::ffff:a.b.c.d) back to its v4 check.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    if (mapped) return isBlockedAddress(mapped[1]);
    if (addr === "::" || addr === "::1") return true; // unspecified / loopback
    if (addr.startsWith("fe80")) return true; // link-local
    if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // fc00::/7 unique-local
    if (addr.startsWith("ff")) return true; // multicast
    return false;
  }

  // Not a literal IP — a bare hostname reaching here means the DNS resolver
  // handed us something we couldn't classify. Refuse it.
  return true;
}

/**
 * A DNS lookup shim for the http/https agents: resolve as normal, but throw
 * (aborting the connection) the moment the chosen address is a blocked range.
 * Because Node calls this for the initial connect AND every redirect's
 * connect, it also defeats DNS-rebinding.
 */
function guardedLookup(hostname, options, callback) {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : options || {};
  dns.lookup(hostname, { ...opts, verbatim: true }, (err, address, family) => {
    if (err) return cb(err);
    const addresses = Array.isArray(address)
      ? address
      : [{ address, family }];
    for (const a of addresses) {
      if (isBlockedAddress(a.address)) {
        return cb(
          new AppError(
            "LINK_PREVIEW_BLOCKED_HOST",
            "Refusing to fetch a private or local address",
            400,
          ),
        );
      }
    }
    if (opts.all) return cb(null, addresses);
    return cb(null, addresses[0].address, addresses[0].family);
  });
}

const httpAgent = new http.Agent({ lookup: guardedLookup, keepAlive: false });
const httpsAgent = new https.Agent({ lookup: guardedLookup, keepAlive: false });

/** Validate + normalise the incoming URL string into a URL object, or throw. */
function parseUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) {
    throw new AppError("LINK_PREVIEW_NO_URL", "No URL was provided", 400, {
      user_message: "No link was provided to preview.",
    });
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new AppError("LINK_PREVIEW_BAD_URL", "Not a valid URL", 400, {
      user_message: "That doesn't look like a valid link.",
    });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new AppError("LINK_PREVIEW_BAD_SCHEME", "Only http/https links", 400, {
      user_message: "Only web links (http/https) can be previewed.",
    });
  }
  return u;
}

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 10));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return _;
      }
    });
}

function clean(str, max = 500) {
  if (str === null || str === undefined) return null;
  const out = decodeEntities(String(str)).replace(/\s+/g, " ").trim();
  return out ? out.slice(0, max) : null;
}

/** Pull every <meta ...> tag's (name/property → content) into a lookup map,
 *  tolerant of attribute order (content-before-property is common). */
function collectMeta(html) {
  const map = {};
  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(html))) {
    const tag = m[0];
    const key =
      /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content !== undefined) {
      const k = key.toLowerCase();
      if (!(k in map)) map[k] = content; // first wins
    }
  }
  return map;
}

/** Resolve a possibly-relative asset URL against the page's final URL. */
function absolutize(ref, baseUrl) {
  if (!ref) return null;
  try {
    return new URL(decodeEntities(ref.trim()), baseUrl).toString();
  } catch {
    return null;
  }
}

/** Extract the <link rel="icon"> favicon href (best-effort). */
function extractFavicon(html, baseUrl) {
  const linkRe = /<link\b[^>]*>/gi;
  let m;
  let fallback = null;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!rel || !/\bicon\b/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const abs = absolutize(href, baseUrl);
    if (rel.includes("apple-touch")) return abs; // best-quality, prefer it
    if (!fallback) fallback = abs;
  }
  if (fallback) return fallback;
  // Default well-known location.
  return absolutize("/favicon.ico", baseUrl);
}

/** Parse an HTML document into a preview metadata object. */
function parseHtml(html, finalUrl) {
  const meta = collectMeta(html);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];

  const title =
    clean(meta["og:title"]) ||
    clean(meta["twitter:title"]) ||
    clean(titleTag) ||
    null;
  const description =
    clean(meta["og:description"], 800) ||
    clean(meta["twitter:description"], 800) ||
    clean(meta["description"], 800) ||
    null;
  const image =
    absolutize(
      meta["og:image:secure_url"] ||
        meta["og:image:url"] ||
        meta["og:image"] ||
        meta["twitter:image"] ||
        meta["twitter:image:src"],
      finalUrl,
    ) || null;
  const siteName =
    clean(meta["og:site_name"]) ||
    clean(meta["application-name"]) ||
    new URL(finalUrl).hostname.replace(/^www\./, "");
  const type = clean(meta["og:type"]) || "website";
  const favicon = extractFavicon(html, finalUrl);

  return {
    url: finalUrl,
    title,
    description,
    image,
    site_name: siteName,
    favicon,
    type,
  };
}

/** Fetch + parse a single URL. Throws AppError on any failure. */
async function fetchPreview(url) {
  const u = parseUrl(url);

  const resp = await axios.get(u.toString(), {
    httpAgent,
    httpsAgent,
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    maxContentLength: MAX_BYTES,
    responseType: "arraybuffer",
    decompress: true,
    // Never throw on 4xx/5xx here — we handle status ourselves so a 404
    // becomes a clean "no preview", not an axios exception.
    validateStatus: () => true,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5",
      "Accept-Language": "en",
    },
  });

  if (resp.status >= 400) {
    throw new AppError(
      "LINK_PREVIEW_UPSTREAM",
      `Upstream returned ${resp.status}`,
      502,
    );
  }

  // The URL axios actually landed on after redirects — resolve relative
  // og:image / favicon against THIS, not the originally-requested URL.
  const finalUrl = resp.request?.res?.responseUrl || u.toString();
  const contentType = String(resp.headers["content-type"] || "").toLowerCase();

  // A direct image link is its own preview.
  if (contentType.startsWith("image/")) {
    const name = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() || "");
    return {
      url: finalUrl,
      title: name || null,
      description: null,
      image: finalUrl,
      site_name: new URL(finalUrl).hostname.replace(/^www\./, ""),
      favicon: absolutize("/favicon.ico", finalUrl),
      type: "image",
    };
  }

  if (!contentType.includes("html") && !contentType.includes("xml")) {
    // Nothing to unfurl (PDF, zip, json…). Give a minimal card off the URL.
    return {
      url: finalUrl,
      title: null,
      description: null,
      image: null,
      site_name: new URL(finalUrl).hostname.replace(/^www\./, ""),
      favicon: absolutize("/favicon.ico", finalUrl),
      type: "file",
    };
  }

  const html = Buffer.isBuffer(resp.data)
    ? resp.data.toString("utf8")
    : String(resp.data || "");
  // Only the <head> carries the metadata — parse that slice to keep the regex
  // work bounded even if the body is huge.
  const headEnd = html.search(/<\/head>/i);
  const slice = headEnd > -1 ? html.slice(0, headEnd + 7) : html.slice(0, 200_000);
  return parseHtml(slice, finalUrl);
}

/** True when the parsed preview actually carries something worth showing. */
function hasContent(p) {
  return !!(p && (p.title || p.description || p.image));
}

function cacheKey(url) {
  return CACHE_PREFIX + crypto.createHash("sha1").update(url).digest("hex");
}

async function cacheGet(key) {
  try {
    const raw = await getRedis().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // redis down / not ready → just skip the cache
  }
}

async function cacheSet(key, value, ttl) {
  try {
    await getRedis().set(key, JSON.stringify(value), "EX", ttl);
  } catch {
    /* best-effort */
  }
}

/**
 * Public entry point: return a cached-or-fresh preview for `url`.
 * Always resolves (never throws for an unreachable/blocked link) — a failed
 * unfurl is a normal outcome the UI renders as "just a clickable link".
 *
 * @param {string} url
 * @returns {Promise<{ok:boolean, preview?:object}>}
 */
async function getLinkPreview(url) {
  const u = parseUrl(url); // throws only on truly malformed input (4xx)
  const key = cacheKey(u.toString());

  const cached = await cacheGet(key);
  if (cached) return cached;

  let result;
  try {
    const preview = await fetchPreview(u.toString());
    result = hasContent(preview)
      ? { ok: true, preview }
      : { ok: false, preview };
  } catch (err) {
    logger.debug(
      { err: err.message, url: u.toString() },
      "link-preview: unfurl failed",
    );
    result = { ok: false };
  }

  await cacheSet(key, result, result.ok ? CACHE_TTL_OK : CACHE_TTL_FAIL);
  return result;
}

module.exports = {
  getLinkPreview,
  // exported for unit tests
  isBlockedAddress,
  parseUrl,
  parseHtml,
};
