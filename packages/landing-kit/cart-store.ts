/**
 * Cart store — typed facade.
 *
 * The zustand implementation lives in cart-store.impl.ts (@ts-nocheck, because
 * tsc can't resolve `zustand` from the package location). This facade re-exports
 * the hook with a hand-written type so type-checked consumers — the checkout
 * pages, etc. — get full inference on `useCart((s) => …)`.
 */
import { useCart as useCartImpl } from "./cart-store.impl";
import type { UseCart } from "./cart-types";

export type { CartItem, CartState } from "./cart-types";

export const useCart = useCartImpl as unknown as UseCart;
