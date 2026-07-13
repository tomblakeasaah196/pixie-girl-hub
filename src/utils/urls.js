/**
 * URL helpers for outbound message bodies.
 *
 * Instagram bounces plain-text DMs that carry a raw URL (Meta's spam
 * filter rejects them with the opaque "Invalid message id" — code 508,
 * subcode 2534122 — the same code it uses for a bad recipient id). The
 * sanctioned way to put a link in an IG DM is a button template, so the
 * instagram-send processor pulls the URLs out of the text and re-sends
 * them as tappable web_url buttons. These helpers do the extraction and
 * pick a human button title for known link shapes.
 */

"use strict";

// Matches http(s) URLs in free text. Trailing sentence punctuation is
// trimmed afterwards so "…watch this: https://youtu.be/x." keeps the
// dot out of the URL.
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

/** Extract all http(s) URLs from a text body, in order, de-duplicated. */
function extractUrls(text) {
  if (!text) return [];
  const found = String(text).match(URL_RE) || [];
  const seen = new Set();
  const urls = [];
  for (let raw of found) {
    // Strip punctuation a sentence may have glued onto the URL.
    raw = raw.replace(/[)\]}>.,;:!?'"]+$/, "");
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    urls.push(raw);
  }
  return urls;
}

/**
 * Remove the given URLs from a text body, collapsing the whitespace
 * they leave behind so the remaining prose reads naturally.
 */
function stripUrls(text, urls) {
  let out = String(text || "");
  for (const u of urls || []) {
    out = out.split(u).join("");
  }
  return out
    .replace(/[ \t]+/g, " ") // collapse doubled spaces
    .replace(/ *\n */g, "\n") // trim spaces around newlines
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs
    .trim();
}

// Button titles are capped at 20 characters by Meta.
const TITLE_MAX = 20;

/**
 * Pick a tappable button title for a URL. Known product surfaces get a
 * task-shaped label ("Open the form"); everything else falls back to
 * the bare hostname so the customer still knows where the button goes.
 */
function buttonTitleForUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "Open link";
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const path = parsed.pathname || "";
  if (host === "youtu.be" || host.endsWith("youtube.com")) return "Watch on YouTube";
  if (path.startsWith("/welcome/")) return "Open the form";
  if (path.startsWith("/order/capture/")) return "Order here";
  if (path.startsWith("/pay/")) return "Pay here";
  if (host.endsWith("instagram.com")) return "Open on Instagram";
  if (host.endsWith("wa.me") || host.endsWith("whatsapp.com")) return "Open WhatsApp";
  if (host.endsWith("tiktok.com")) return "Watch on TikTok";
  const trimmed = host.length > TITLE_MAX ? host.slice(0, TITLE_MAX - 1) + "…" : host;
  return trimmed || "Open link";
}

module.exports = { extractUrls, stripUrls, buttonTitleForUrl };
