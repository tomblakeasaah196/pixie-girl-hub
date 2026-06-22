// @ts-nocheck
"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItem, CartState } from "./cart-types";

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
      partialize: (s) => ({
        campaign_slug: s.campaign_slug,
        items: s.items,
        shown_upsell_ids: s.shown_upsell_ids,
      }),
    },
  ),
);
