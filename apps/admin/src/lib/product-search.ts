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

export type ProductKind = "base" | "styled" | "bundle";

export const PRODUCT_KINDS: { key: ProductKind; label: string }[] = [
  { key: "base", label: "Base Product" },
  { key: "styled", label: "Styled Product" },
  { key: "bundle", label: "Bundle" },
];

/** A search result the picker renders. `id` is the kind's primary key. */
export interface ProductHit {
  kind: ProductKind;
  id: string;
  label: string;
  sub: string;
}

/** A concrete, sellable line resolved from a pick — ready for any cart. */
export interface ResolvedLine {
  variant_id: string;
  label: string;
  sku: string;
  unit_price: number;
  quantity: number;
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
}
interface StyledRow {
  styled_id: string;
  name: string;
  styled_code: string;
  retail_price_ngn: string | number | null;
}
interface BundleRow {
  bundle_id: string;
  bundle_code: string;
  display_name: string;
  bundle_price_ngn: string | number | null;
  pricing_model: string;
}
interface VariantRow {
  variant_id: string;
  sku: string;
  variant_name: string | null;
  price_storefront_ngn: string | number | null;
  price_pos_ngn: string | number | null;
  is_active: boolean;
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
    }));
  }

  // bundle — the list endpoint returns a bare array; filter client-side.
  const bundles = await api.get<BundleRow[]>(`/retention/bundles?active=true`);
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
        },
      ],
    };
  }

  // bundle — expand each component into a line.
  const bundle = await api.get<BundleDetail>(`/retention/bundles/${hit.id}`);
  const fallback = num(bundle.bundle_price_ngn) / (bundle.components.length || 1);
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
        price = num(match.price_storefront_ngn ?? match.price_pos_ngn) || fallback;
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
