/**
 * Cart store — public type contract.
 *
 * The implementation (cart-store.impl.ts) is @ts-nocheck because tsc can't
 * resolve `zustand` from the package's own location (it's resolved by each
 * consuming app's bundler). These hand-written types are what type-checked
 * consumers see via the cart-store.ts facade, so `useCart((s) => …)` stays
 * fully typed.
 */

export interface CartItem {
  id: string;
  type: "bundle" | "product";
  bundle_id?: string;
  product_id?: string;
  name: string;
  image_url?: string;
  unit_price_ngn: number;
  retail_price_ngn?: number;
  quantity: number;
  preorder?: boolean;
  preorder_lead_weeks?: number;
}

export interface CartState {
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

/** The shape of the zustand hook the impl exports (selector + store API). */
export type UseCart = {
  (): CartState;
  <T>(selector: (state: CartState) => T): T;
  getState: () => CartState;
  setState: (
    partial: Partial<CartState> | ((state: CartState) => Partial<CartState>),
  ) => void;
  subscribe: (
    listener: (state: CartState, prev: CartState) => void,
  ) => () => void;
};
