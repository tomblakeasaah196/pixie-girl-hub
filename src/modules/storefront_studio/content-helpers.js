/**
 * Storefront Content CMS — pure helpers (no I/O), so the "one thing the
 * operator types becomes a complete, correct post" logic is unit-testable.
 *
 * The editor only asks for a title (and body/answer). Everything else — the
 * URL slug, reading time, and empty SEO fields — is derived here.
 */

"use strict";

/** Title → URL-safe slug. Accent-fold, lowercase, hyphenate, trim. */
function slugify(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/['"]/g, "") // drop apostrophes/quotes rather than hyphenate them
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/**
 * Ensure a slug is unique for the brand. `taken(candidate)` reports whether a
 * candidate collides (excluding the post being edited). Appends -2, -3, … .
 */
async function uniqueSlug(base, taken) {
  const root = slugify(base) || "post";
  if (!(await taken(root))) return root;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  // Astronomically unlikely; fall back to a time-suffixed slug.
  return `${root}-${Date.now().toString(36)}`;
}

/** Words / 200 wpm, rounded up, minimum 1. */
function readingTimeMinutes(...texts) {
  const words = texts
    .filter(Boolean)
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function clamp(str, max) {
  const v = String(str || "").trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/**
 * Normalise an editor payload into a full DB row shape. FAQ posts carry the
 * question in `faq_question` and the answer in `body`; the title mirrors the
 * question when the operator didn't set one. Blank SEO fields fall back to the
 * title/excerpt so every published page is share-ready.
 */
function buildPostFields(input) {
  const isFaq = input.post_type === "faq";
  const title =
    (input.title && input.title.trim()) ||
    (isFaq && input.faq_question ? input.faq_question.trim() : "") ||
    "Untitled";
  const excerpt = input.excerpt ? input.excerpt.trim() : null;
  const body = input.body ? input.body : null;
  return {
    post_type: input.post_type,
    title,
    excerpt,
    body,
    hero_image_url: input.hero_image_url || null,
    hero_image_alt: input.hero_image_alt || null,
    faq_category: isFaq ? input.faq_category || "general" : null,
    faq_question: isFaq ? input.faq_question || title : null,
    tags: input.tags || [],
    meta_title: (input.meta_title && input.meta_title.trim()) || clamp(title, 200),
    meta_description:
      (input.meta_description && input.meta_description.trim()) ||
      clamp(excerpt || body || title, 300),
    is_featured: !!input.is_featured,
    display_order: Number.isFinite(input.display_order) ? input.display_order : 0,
    reading_time_minutes: readingTimeMinutes(title, excerpt, body),
  };
}

module.exports = {
  slugify,
  uniqueSlug,
  readingTimeMinutes,
  buildPostFields,
};
