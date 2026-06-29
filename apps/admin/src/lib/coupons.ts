/**
 * Special / VIP discount codes — data layer.
 *
 * Thin TanStack Query hooks over the retention coupon engine
 * (/api/v1/retention/coupons). These are the "share-anywhere" codes a manager
 * hands directly to a VVIP — no exit-intent popup, no campaign binding. The
 * shopper types the code into the checkout's "Have a promo code?" field and the
 * Hub applies the ₦-off server-side (sales.service → couponService.validateCoupon),
 * floor-respecting. Creating a code here is all that's needed for checkout to
 * honour it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

export function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

export type CouponDiscountType =
  | "percentage"
  | "fixed_amount"
  | "free_shipping"
  | "buy_x_get_y";

export interface Coupon {
  coupon_id: string;
  business: string;
  coupon_code: string;
  display_name: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_order_value: number | null;
  valid_from: string;
  valid_to: string | null;
  total_usage_limit: number | null;
  per_customer_limit: number;
  total_redeemed: number;
  total_discount_given: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCouponInput {
  coupon_code: string;
  display_name: string;
  discount_type: CouponDiscountType;
  /** percentage → fraction (0.10 = 10%); fixed_amount → NGN. */
  discount_value: number;
  valid_to?: string;
  is_active?: boolean;
}

/**
 * lib/api unwraps a bare `{ data }` body (no sibling `meta`) down to the inner
 * value, so the list endpoint arrives as a plain array. Normalise to an array
 * either way.
 */
async function getList(path: string): Promise<Coupon[]> {
  const res = await api.get<{ data: Coupon[] } | Coupon[]>(path);
  if (Array.isArray(res)) return res;
  return res?.data ?? [];
}

export function useCouponList(onlyActive = false) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["coupons", "list", brand, onlyActive],
    queryFn: () =>
      getList(`/retention/coupons${onlyActive ? "?active=true" : ""}`),
    staleTime: 30_000,
  });
}

export function useCreateCoupon() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: CreateCouponInput) =>
      api.post<Coupon>("/retention/coupons", input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["coupons", "list", brand] }),
  });
}

export function useSetCouponActive() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch<Coupon>(`/retention/coupons/${id}/active`, { is_active }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["coupons", "list", brand] }),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: boolean }>(`/retention/coupons/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["coupons", "list", brand] }),
  });
}
