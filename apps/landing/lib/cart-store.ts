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

interface CartState {
  campaign_slug: string | null;
  items: CartItem[];
  open: boolean;
  /** Upsell rungs already shown this cart open. */
  shown_upsell_ids: string[];

  init: (slug: string) => void;
  add: (item: CartItem) => void;
  setQuantity: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
  markUpsellShown: (id: string) => void;

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
      version: 2,
      partialize: (s) => ({
        campaign_slug: s.campaign_slug,
        items: s.items,
        shown_upsell_ids: s.shown_upsell_ids,
      }),
    },
  ),
);
