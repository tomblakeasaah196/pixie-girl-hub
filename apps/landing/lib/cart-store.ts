"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  id: string;
  type: "bundle" | "product" | "styled";
  bundle_id?: string;
  product_id?: string;
  /** Styled product/colour/size SKU. Set for styled items; the server prices
   *  the line from the styled tables (styled_product_variants). */
  styled_variant_id?: string;
  name: string;
  /** Human-readable summary of the chosen options (e.g. "Small · HD Lace
   *  13x6"). Shown under the line name in the cart + checkout so the buyer
   *  can see the head size / lace they picked. */
  variant_label?: string;
  image_url?: string;
  unit_price_ngn: number;
  retail_price_ngn?: number;
  quantity: number;
  /** "Buy unstyled / raw": ordered without styling premiums. Priced server-side
   *  at the anchor and counted as a raw wig for the reseller/bulk tier. */
  unstyled?: boolean;
  preorder?: boolean;
  preorder_lead_weeks?: number;
  /** In-stock delivery lead time (weeks) set in the campaign builder. Shown
   *  in the cart + checkout so an in-stock buyer sees when it ships. */
  delivery_weeks?: number;
}

/**
 * A cart line is "broken" if it would silently fail at quote/checkout — the
 * symptom buyers hit during the checkout glitch. Two known shapes:
 *   1. A non-positive / non-finite unit price → the line prices to ₦0, which
 *      the Hub refuses to bill, so the order dies after the buyer clicks Pay.
 *   2. A styled item with no `styled_variant_id` (a pre-v2 cart that stored the
 *      base product_id for a styled product) → the server can't price it.
 * Anything matching this is the population we clear + apologise to; clean carts
 * are left exactly as they are.
 */
export function isBrokenCartItem(it: unknown): boolean {
  if (!it || typeof it !== "object") return true;
  const item = it as Partial<CartItem>;
  const price = Number(item.unit_price_ngn);
  if (!Number.isFinite(price) || price <= 0) return true;
  const qty = Number(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return true;
  if (item.type === "styled" && !item.styled_variant_id) return true;
  return false;
}

interface CartState {
  campaign_slug: string | null;
  items: CartItem[];
  open: boolean;
  /** Upsell rungs already shown this cart open. */
  shown_upsell_ids: string[];
  /** Set true (once) when a stale, broken cart was discarded on rehydrate by the
   *  checkout-glitch migration. Drives the one-time apology + gift modal; the
   *  modal calls `acknowledgeGlitch` to lower it so it shows exactly once. */
  glitchCleared: boolean;

  init: (slug: string) => void;
  add: (item: CartItem) => void;
  setQuantity: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
  markUpsellShown: (id: string) => void;
  acknowledgeGlitch: () => void;

  totalQty: () => number;
  subtotalNgn: () => number;
  retailSubtotalNgn: () => number;
  savingsNgn: () => number;
  distinctBundleCount: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      campaign_slug: null,
      items: [],
      open: false,
      shown_upsell_ids: [],
      glitchCleared: false,

      init(slug) {
        if (get().campaign_slug !== slug) {
          set({ campaign_slug: slug, items: [], shown_upsell_ids: [] });
        }
      },
      add(item) {
        set((s) => {
          const existing = s.items.find((i) => i.id === item.id);
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.id === item.id
                  ? { ...i, quantity: i.quantity + item.quantity }
                  : i,
              ),
            };
          }
          return { items: [...s.items, item] };
        });
      },
      setQuantity(id, qty) {
        if (qty <= 0) return get().remove(id);
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, quantity: qty } : i,
          ),
        }));
      },
      remove(id) {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },
      clear() {
        set({ items: [], shown_upsell_ids: [] });
      },
      openCart() {
        set({ open: true });
      },
      closeCart() {
        set({ open: false });
      },
      toggleCart() {
        set((s) => ({ open: !s.open }));
      },
      markUpsellShown(id) {
        set((s) =>
          s.shown_upsell_ids.includes(id)
            ? s
            : { shown_upsell_ids: [...s.shown_upsell_ids, id] },
        );
      },
      acknowledgeGlitch() {
        set({ glitchCleared: false });
      },

      totalQty() {
        return get().items.reduce((a, i) => a + i.quantity, 0);
      },
      subtotalNgn() {
        return get().items.reduce(
          (a, i) => a + i.unit_price_ngn * i.quantity,
          0,
        );
      },
      retailSubtotalNgn() {
        return get().items.reduce(
          (a, i) => a + (i.retail_price_ngn ?? i.unit_price_ngn) * i.quantity,
          0,
        );
      },
      savingsNgn() {
        return Math.max(0, get().retailSubtotalNgn() - get().subtotalNgn());
      },
      distinctBundleCount() {
        return new Set(
          get()
            .items.filter((i) => i.type === "bundle")
            .map((i) => i.id),
        ).size;
      },
    }),
    {
      name: "pgh-landing-cart",
      // Bump when the persisted CartItem shape changes so old carts are
      // discarded instead of replayed. v2: items now carry styled_variant_id;
      // a v1 cart could still hold a base product_id for a styled product
      // (which prices at ₦0 and fails payment), so drop pre-v2 carts.
      // v3: targeted checkout-glitch recovery — instead of dropping every old
      // cart, the migration below inspects items and only clears carts that
      // carry a broken (silently-failing) line, raising `glitchCleared` so the
      // buyer gets a one-time apology + gift. Clean carts are preserved.
      version: 3,
      // Runs once per browser when a cart persisted at an older version is
      // rehydrated. We never trust the old contents blindly: a single broken
      // line is the signature of the checkout glitch, so we wipe the whole cart
      // (matching the apology's "your cart has been reset" copy) and flag it.
      // A wholly clean cart is handed back untouched — no clear, no apology.
      migrate: (persisted) => {
        const prev = (persisted ?? {}) as Partial<CartState>;
        const items = Array.isArray(prev.items) ? prev.items : [];
        const hasBroken = items.length > 0 && items.some(isBrokenCartItem);
        return {
          campaign_slug: prev.campaign_slug ?? null,
          items: hasBroken ? [] : items,
          shown_upsell_ids: hasBroken
            ? []
            : Array.isArray(prev.shown_upsell_ids)
              ? prev.shown_upsell_ids
              : [],
          glitchCleared: hasBroken,
        } as CartState;
      },
      partialize: (s) => ({
        campaign_slug: s.campaign_slug,
        items: s.items,
        shown_upsell_ids: s.shown_upsell_ids,
        glitchCleared: s.glitchCleared,
      }),
    },
  ),
);
