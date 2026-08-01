/**
 * Linkify — turn URLs inside a plain-text message into clickable anchors, and
 * pull out the URLs a message carries so the thread can unfurl them into
 * WhatsApp-style preview cards.
 *
 * Deliberately conservative: we only ever auto-link http(s):// and bare
 * `www.` URLs. No `javascript:` / `data:` / `mailto:` autolinking, so a
 * message can never become a script-bearing link.
 */

import type { ReactNode } from "react";

// A URL is http(s)://… or www.…; we stop at whitespace / angle brackets and
// then trim trailing sentence punctuation below so "(see https://x.com)." or
// "link: https://x.com," don't swallow the paren / comma / full stop.
const URL_RE = /(https?:\/\/[^\s<>[\]{}"']+|www\.[^\s<>[\]{}"']+)/gi;

/** Strip trailing punctuation that almost always belongs to the sentence, not
 *  the URL — and balance a closing paren only if the URL has no opening one. */
function trimTrailing(raw: string): string {
  let url = raw;
  // Peel sentence-ending punctuation off the end.
  while (url.length && /[.,;:!?"'»)]$/.test(url)) {
    const last = url[url.length - 1];
    if (last === ")") {
      // Keep a ')' that closes a '(' inside the URL (e.g. a Wikipedia link).
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes <= opens) break;
    }
    url = url.slice(0, -1);
  }
  return url;
}

/** The href to actually navigate to — bare `www.` links get https:// so the
 *  browser doesn't resolve them relative to the current app origin. */
export function toHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * Extract the unique http(s)/www URLs from a block of text, in order, capped
 * so a link-spam message can't fire dozens of preview fetches. Bare `www.`
 * links are normalised to an https:// href (what the preview endpoint needs).
 */
export function extractUrls(text: string | null | undefined, max = 3): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const href = toHref(trimTrailing(m[0]));
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Render `text` with its URLs as clickable anchors, everything else as plain
 * text. Returns an array of React nodes safe to drop inside a <p>/<span>.
 */
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const m of text.matchAll(URL_RE)) {
    const matchStart = m.index ?? 0;
    const trimmed = trimTrailing(m[0]);
    // Text before the URL.
    if (matchStart > lastIndex) {
      nodes.push(text.slice(lastIndex, matchStart));
    }
    nodes.push(
      <a
        key={`lnk-${key++}`}
        href={toHref(trimmed)}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent-glow underline underline-offset-2 break-all hover:text-accent"
        onClick={(e) => e.stopPropagation()}
      >
        {trimmed}
      </a>,
    );
    // Any trailing punctuation we peeled off stays as plain text.
    const tail = m[0].slice(trimmed.length);
    if (tail) nodes.push(tail);
    lastIndex = matchStart + m[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
