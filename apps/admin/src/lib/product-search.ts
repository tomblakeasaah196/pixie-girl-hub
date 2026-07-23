/**
 * Product search & resolution — the single source of truth for "find a product
 * to sell" anywhere in the ERP (orders, quotations, invoices, POS, …).
 *
 * The rule (owner directive): the operator FIRST picks the product KIND —
 * Base, Styled or Bundle — and only then does the autocomplete search. Each
 * kind searches its own endpoint, and a picked hit is RESOLVED into concrete
 * order lines (a base/styled product expands to its sellable variant(s); a
 * bundle expands to its components). Both the picker UI (ProductPicker) and the
 * forms that consume a pick go through here, so every surface behaves
 * identically.
 */

import { api } from "@/lib/api";
import type { Paginated } from "@/lib/catalogue";

export type ProductKind = "base" | "styled" | "bundle" | "service";

// The ERP-wide sellable kinds the shared ProductPicker offers (orders,
// quotations, invoices, Quick Sale). Services are sold as a first-class kind
// alongside products — the picker returns a hit with kind='service' and
// resolvePick() lowers it into a service order line (service_offering_id +
// line_kind='service'). Retained in the in-chat catalogue picker too.
export const PRODUCT_KINDS: { key: ProductKind; label: string }[] = [
  { key: "base", label: "Base Product" },
  { key: "styled", label: "Styled Product" },
  { key: "bundle", label: "Bundle" },
  { key: "service", label: "Service" },
];

/** A search result the picker renders. `id` is the kind's primary key.
 * Optional fields surface the card preview (image + price) for in-chat
 * sharing without forcing every existing caller to update. */
export interface ProductHit {
  kind: ProductKind;
  id: string;
  label: string;
  sub: string;
  image_url?: string | null;
  price?: string | number | null;
}

/** A concrete, sellable line resolved from a pick — ready for any cart. */
export interface ResolvedLine {
  // Empty string when the line is a service (no stock variant); the cart's
  // sameness check keeps working because "" === "" merges services by
  // service_offering_id below.
  variant_id: string;
  label: string;
  sku: string;
  unit_price: number;
  quantity: number;
  // Set when the pick was a styled product. Sales pricing reads this to stamp
  // line_kind='styled' so Stylist Studio auto-opens a job on order.paid.
  styled_id?: string;
  // Set when the pick was a service. Sales writes line_kind='service' and skips
  // stock reservation; the customer pays the service's base price up-front.
  service_offering_id?: string;
  // Snapshot overrides for a styled/bundle pick — the shop-facing name and
  // (for a styled variant) its head-size/lace/colour spec, distinct from
  // `label` (a caller may still want a single combined display string).
  // Sales stamps these onto the order/quote line instead of falling back to
  // the base variant's own name.
  product_name_snapshot?: string;
  variant_label_snapshot?: string;
}

export interface ResolvedPick {
  lines: ResolvedLine[];
  /** Set when a bundle was picked, so the order can attach the bundle offer. */
  bundle_id?: string;
}

// ── Raw API row shapes ───────────────────────────────────────
interface BaseRow {
  product_id: string;
  name: string;
  slug: string;
  primary_image_url?: string | null;
  hero_image_url?: string | null;
}
interface StyledRow {
  styled_id: string;
  name: string;
  styled_code: string;
  retail_price_ngn: string | number | null;
  primary_image_url?: string | null;
}
interface BundleRow {
  bundle_id: string;
  bundle_code: string;
  display_name: string;
  bundle_price_ngn: string | number | null;
  pricing_model: string;
  hero_image_url?: string | null;
}
interface ServiceRow {
  service_id: string;
  name: string;
  slug: string;
  base_price_ngn: number | null;
  image_url: string | null;
  is_active: boolean;
  category: string | null;
}
interface VariantRow {
  variant_id: string;
  sku: string;
  variant_name: string | null;
  price_storefront_ngn: string | number | null;
  price_pos_ngn: string | number | null;
  is_active: boolean;
  is_default?: boolean;
  display_order?: number | null;
}
interface StyledDetail {
  styled_id: string;
  base_product_id: string;
  base_variant_id: string | null;
  styled_code: string;
  name: string;
  retail_price_ngn: string | number | null;
}
interface BundleDetail {
  bundle_id: string;
  display_name: string;
  bundle_price_ngn: string | number | null;
  components: {
    bundle_product_id: string;
    product_id: string | null;
    variant_id: string | null;
    quantity: number;
    role: string;
  }[];
}

const num = (v: string | number | null | undefined): number =>
  v == null ? 0 : Number(v);
const ngn = (v: string | number | null | undefined): string =>
  v == null ? "—" : `₦${num(v).toLocaleString()}`;
const enc = (s: string) => encodeURIComponent(s);

// ── Search (one endpoint per kind) ───────────────────────────
export async function searchByKind(
  kind: ProductKind,
  q: string,
): Promise<ProductHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];

  if (kind === "base") {
    const res = await api.get<Paginated<BaseRow>>(
      `/catalogue/products?q=${enc(term)}&page_size=10`,
    );
    return (res.data ?? []).map((p) => ({
      kind,
      id: p.product_id,
      label: p.name,
      sub: p.slug,
      image_url: p.primary_image_url ?? p.hero_image_url ?? null,
    }));
  }

  if (kind === "styled") {
    const res = await api.get<Paginated<StyledRow>>(
      `/catalogue/styled-products?q=${enc(term)}&page_size=10`,
    );
    return (res.data ?? []).map((p) => ({
      kind,
      id: p.styled_id,
      label: p.name,
      sub: `${p.styled_code} · ${ngn(p.retail_price_ngn)}`,
      image_url: p.primary_image_url ?? null,
      price: p.retail_price_ngn ?? null,
    }));
  }

  if (kind === "bundle") {
    const bundles = await api.get<BundleRow[]>(
      `/retention/bundles?active=true`,
    );
    const lower = term.toLowerCase();
    return (bundles ?? [])
      .filter(
        (b) =>
          b.display_name.toLowerCase().includes(lower) ||
          b.bundle_code.toLowerCase().includes(lower),
      )
      .slice(0, 10)
      .map((b) => ({
        kind,
        id: b.bundle_id,
        label: b.display_name,
        sub: `${b.bundle_code} · ${
          b.bundle_price_ngn != null ? ngn(b.bundle_price_ngn) : b.pricing_model
        }`,
        image_url: b.hero_image_url ?? null,
        price: b.bundle_price_ngn ?? null,
      }));
  }

  // service — fetch all (small list) and filter client-side.
  const services = await api.get<ServiceRow[]>("/service-catalogue");
  const lower = term.toLowerCase();
  return (services ?? [])
    .filter(
      (s) =>
        s.is_active &&
        (s.name.toLowerCase().includes(lower) ||
          s.slug.toLowerCase().includes(lower) ||
          (s.category && s.category.toLowerCase().includes(lower))),
    )
    .slice(0, 10)
    .map((s) => ({
      kind,
      id: s.service_id,
      label: s.name,
      sub: `${s.category ?? "Service"} · ${ngn(s.base_price_ngn)}`,
      image_url: s.image_url,
      price: s.base_price_ngn,
    }));
}

// ── Resolve a pick into concrete sellable lines ──────────────
export async function resolvePick(hit: ProductHit): Promise<ResolvedPick> {
  if (hit.kind === "base") {
    const variants = await api.get<VariantRow[]>(
      `/catalogue/products/${hit.id}/variants`,
    );
    const lines = variants
      .filter((v) => v.is_active)
      .map((v) => ({
        variant_id: v.variant_id,
        label: `${hit.label} — ${v.variant_name ?? v.sku}`,
        sku: v.sku,
        unit_price: num(v.price_storefront_ngn ?? v.price_pos_ngn),
        quantity: 1,
      }));
    return { lines };
  }

  if (hit.kind === "styled") {
    const sp = await api.get<StyledDetail>(
      `/catalogue/styled-products/${hit.id}`,
    );
    // A styled product sells through a base variant (stock lives on the base).
    // Use the pinned base variant when set, else the base's default/first
    // active variant — priced at the styled retail anchor.
    let variantId = sp.base_variant_id;
    let sku = sp.styled_code;
    if (!variantId) {
      const variants = await api.get<VariantRow[]>(
        `/catalogue/products/${sp.base_product_id}/variants`,
      );
      const pick = variants.find((v) => v.is_active) ?? variants[0];
      variantId = pick?.variant_id ?? null;
      sku = pick?.sku ?? sp.styled_code;
    }
    if (!variantId) return { lines: [] };
    return {
      lines: [
        {
          variant_id: variantId,
          label: sp.name,
          sku,
          unit_price: num(sp.retail_price_ngn),
          quantity: 1,
          styled_id: sp.styled_id,
        },
      ],
    };
  }

  if (hit.kind === "service") {
    // A service pick is one line — no variant lookup, no stock reservation.
    // Priced at the service's base_price_ngn (already carried on the hit).
    return {
      lines: [
        {
          variant_id: "",
          service_offering_id: hit.id,
          label: hit.label,
          sku: "Service",
          unit_price: num(hit.price ?? 0),
          quantity: 1,
        },
      ],
    };
  }

  // bundle — expand each component into a line.
  const bundle = await api.get<BundleDetail>(`/retention/bundles/${hit.id}`);
  const fallback =
    num(bundle.bundle_price_ngn) / (bundle.components.length || 1);
  const lines: ResolvedLine[] = [];
  for (const comp of bundle.components) {
    let variantId = comp.variant_id;
    let label = `${bundle.display_name} — ${comp.role}`;
    let sku = comp.bundle_product_id.slice(0, 8);
    let price = fallback;
    if (comp.product_id) {
      const variants = await api.get<VariantRow[]>(
        `/catalogue/products/${comp.product_id}/variants`,
      );
      const match = comp.variant_id
        ? variants.find((v) => v.variant_id === comp.variant_id)
        : variants.find((v) => v.is_active);
      if (match) {
        variantId = match.variant_id;
        label = `${bundle.display_name} — ${match.variant_name ?? match.sku}`;
        sku = match.sku;
        price =
          num(match.price_storefront_ngn ?? match.price_pos_ngn) || fallback;
      }
    }
    if (!variantId) continue;
    lines.push({
      variant_id: variantId,
      label,
      sku,
      unit_price: price,
      quantity: comp.quantity,
    });
  }
  return { lines, bundle_id: bundle.bundle_id };
}

/** A confirmed head-size/lace/colour pick from StyledVariantPicker — kept
 * structurally compatible with (a subset of) that component's `StyledPick`
 * so callers can pass it straight through. */
export interface StyledVariantChoice {
  styled_variant_id: string | null;
  base_product_id?: string | null;
  sku: string | null;
  price: number | null;
  spec: string;
}

// The variant a base product's own catalogue setup treats as canonical —
// mirrors the backend's own tie-break (catalogue.repo.getDefaultVariant):
// the explicit default first, then lowest display_order. Active only; a
// soft-deleted or deactivated variant is never a silent substitute.
function pickDefaultActiveVariant(variants: VariantRow[]): VariantRow | null {
  const active = variants.filter((v) => v.is_active);
  if (!active.length) return null;
  return (
    active.find((v) => v.is_default) ??
    [...active].sort(
      (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
    )[0]
  );
}

/**
 * Resolve a STYLED hit into a sellable line once the operator has chosen a
 * head size / lace / colour combination (or the product has no matrix at
 * all, in which case `pick` carries all-null fields + the anchor price —
 * see StyledVariantPicker's auto-confirm).
 *
 * Every styled_variants row is cut from its OWN base product (a size-adjacent
 * combo is very often a DIFFERENT physical base than the styled listing's own
 * seed — see docs on StyledPick.base_product_id / "Auto-map each size to its
 * own base"). So once the operator has picked a combo, stock MUST resolve
 * strictly within that combo's own base — never fall back to the styled
 * product's seed variant, which belongs to a different size/colour/lace and
 * would silently reserve (or pre-order) the wrong stock item. If that base
 * genuinely has no active variant configured, that's surfaced as an error
 * rather than papered over.
 */
export async function resolveStyledPick(
  hit: ProductHit,
  pick: StyledVariantChoice,
): Promise<ResolvedPick> {
  const sp = await api.get<StyledDetail>(`/catalogue/styled-products/${hit.id}`);
  const spec = pick.spec || "";
  const label = spec ? `${sp.name} — ${spec}` : sp.name;
  const line = (variant_id: string, sku: string): ResolvedPick => ({
    lines: [
      {
        variant_id,
        label,
        sku,
        unit_price: pick.price != null ? pick.price : num(sp.retail_price_ngn),
        quantity: 1,
        styled_id: sp.styled_id,
        product_name_snapshot: sp.name,
        variant_label_snapshot: spec || undefined,
      },
    ],
  });

  if (pick.base_product_id) {
    // The picked combo's base happens to BE the styled listing's own seed —
    // honour the listing's deliberately pinned base_variant_id (it may not
    // be the base's "default" variant; it was chosen on purpose) before
    // falling back to that base's own default variant.
    if (pick.base_product_id === sp.base_product_id && sp.base_variant_id) {
      return line(sp.base_variant_id, pick.sku || sp.styled_code);
    }
    const variants = await api.get<VariantRow[]>(
      `/catalogue/products/${pick.base_product_id}/variants`,
    );
    const match = pickDefaultActiveVariant(variants);
    if (!match) {
      throw new Error(
        `${sp.name}${spec ? ` — ${spec}` : ""} has no stock variant on its base yet — add one in Catalogue before selling this combination.`,
      );
    }
    return line(match.variant_id, pick.sku || match.sku);
  }

  // No matrix combo was picked at all (a matrix-less styled product) — sell
  // through the styled product's own seed base, exactly as before this
  // feature existed.
  if (sp.base_variant_id) return line(sp.base_variant_id, pick.sku || sp.styled_code);
  const variants = await api.get<VariantRow[]>(
    `/catalogue/products/${sp.base_product_id}/variants`,
  );
  const match = variants.find((v) => v.is_active) ?? variants[0];
  if (!match) return { lines: [] };
  return line(match.variant_id, pick.sku || match.sku);
}
