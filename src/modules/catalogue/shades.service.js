/**
 * Product Shades (V2.2 §6.4 — "Shop by shade") — business logic.
 *
 * A shade is a standalone storefront section (cover, copy, SEO slug) beside
 * Collections. This layer owns slug uniqueness, audit + events, and the
 * Flow-2 bulk assignment of styled products to a shade.
 */

"use strict";

const repo = require("./shades.repo");
const events = require("./catalogue.events");
const { audit } = require("../../middleware/audit");
const { NotFoundError } = require("../../utils/errors");

const A = (brand, user_id, action_key, target_id, after, request_id, before) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type: "styled_shade",
    target_id,
    before,
    after,
    request_id,
  });

/** Kebab-case a shade name into a URL slug. */
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A collision-free slug: prefer the supplied/derived slug, else suffix it. */
async function uniqueSlug({ brand, name, slug, excludeId = null }) {
  const baseSlug = slugify(slug || name) || "shade";
  let candidate = baseSlug;
  let n = 2;
  // Probe until free. An update keeps its own slug (excludeId) without bumping.
  while (await repo.slugTaken({ brand, slug: candidate })) {
    const existing = await repo.getBySlug({ brand, slug: candidate });
    if (existing && excludeId && existing.shade_id === excludeId) break;
    candidate = `${baseSlug}-${n++}`;
  }
  return candidate;
}

/** A collision-free shade_code (NOT NULL on the table, unique among live rows).
 *  Derived from the name: SCREAMING form of the slug, suffixed on a clash. */
async function uniqueCode({ brand, name }) {
  const baseCode =
    slugify(name).toUpperCase().replace(/-/g, "").slice(0, 24) || "SHADE";
  let candidate = baseCode;
  let n = 2;
  while (await repo.codeTaken({ brand, code: candidate })) {
    candidate = `${baseCode}-${n++}`;
  }
  return candidate;
}

const list = ({ brand }) => repo.list({ brand });

async function getById({ brand, id }) {
  const shade = await repo.getById({ brand, id });
  if (!shade) throw new NotFoundError("Shade");
  shade.members = await repo.listMembers({ brand, shade_id: id });
  return shade;
}

/** Storefront read by slug — shade metadata + its styled products. */
async function getBySlug({ brand, slug }) {
  const shade = await repo.getBySlug({ brand, slug });
  if (!shade) throw new NotFoundError("Shade");
  shade.members = await repo.listMembers({ brand, shade_id: shade.shade_id });
  return shade;
}

async function create({ brand, user, request_id, input }) {
  const slug = await uniqueSlug({ brand, name: input.name, slug: input.slug });
  const shade_code = await uniqueCode({ brand, name: input.name });
  const shade = await repo.create({
    brand,
    input: { ...input, slug },
    shade_code,
    created_by: user.user_id,
  });
  await A(
    brand,
    user.user_id,
    "catalogue.shade.create",
    shade.shade_id,
    shade,
    request_id,
  );
  events.emit("shade.created", { brand, id: shade.shade_id });
  return shade;
}

async function update({ brand, user, request_id, id, patch }) {
  const before = await repo.getById({ brand, id });
  if (!before) throw new NotFoundError("Shade");
  // Re-slug only when name or slug actually change (keeps the SEO URL stable).
  if (patch.slug !== undefined || patch.name !== undefined) {
    patch.slug = await uniqueSlug({
      brand,
      name: patch.name ?? before.name,
      slug: patch.slug ?? before.slug,
      excludeId: id,
    });
  }
  const shade = await repo.update({ brand, id, patch });
  await A(
    brand,
    user.user_id,
    "catalogue.shade.update",
    id,
    shade,
    request_id,
    before,
  );
  events.emit("shade.updated", { brand, id });
  return shade;
}

async function remove({ brand, user, request_id, id }) {
  const before = await repo.getById({ brand, id });
  if (!before) throw new NotFoundError("Shade");
  await repo.remove({ brand, id });
  await A(
    brand,
    user.user_id,
    "catalogue.shade.delete",
    id,
    null,
    request_id,
    before,
  );
  events.emit("shade.deleted", { brand, id });
}

/** Bulk assign styled products to a shade (Flow-2). Returns rows affected. */
async function assignMembers({ brand, user, request_id, id, styled_ids }) {
  const shade = await repo.getById({ brand, id });
  if (!shade) throw new NotFoundError("Shade");
  const assigned = await repo.assignMembers({
    brand,
    shade_id: id,
    styled_ids,
  });
  await A(
    brand,
    user.user_id,
    "catalogue.shade.member.assign",
    id,
    { styled_ids, assigned },
    request_id,
  );
  events.emit("shade.updated", { brand, id });
  return { assigned };
}

async function unassignMember({ brand, user, request_id, id, styled_id }) {
  const shade = await repo.getById({ brand, id });
  if (!shade) throw new NotFoundError("Shade");
  const ok = await repo.unassignMember({ brand, shade_id: id, styled_id });
  if (!ok) throw new NotFoundError("Shade member");
  await A(
    brand,
    user.user_id,
    "catalogue.shade.member.remove",
    id,
    { styled_id },
    request_id,
  );
  events.emit("shade.updated", { brand, id });
}

module.exports = {
  slugify,
  list,
  getById,
  getBySlug,
  create,
  update,
  remove,
  assignMembers,
  unassignMember,
};
