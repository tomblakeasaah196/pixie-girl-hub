import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import type { Category, ProductImage } from "@/lib/catalogue";

/** The PXG-only authoring surface. The server repeats the brand + flag check on
 * every route; hiding a tab is never our security boundary. */
const ROOT = "/catalogue/care-accessories";
const useBrand = () => useBusinessStore((s) => s.activeKey);

export interface CareVariant {
  variant_id: string;
  product_id: string;
  sku: string;
  variant_name: string;
  barcode: string | null;
  price_storefront_ngn: number | string | null;
  price_storefront_usd: number | string | null;
  price_pos_ngn: number | string | null;
  price_pos_usd: number | string | null;
  reorder_point: number;
  is_default: boolean;
  is_active: boolean;
  is_deleted: boolean;
  stock_on_hand: number;
  stock_available: number;
  has_operational_cost?: boolean;
}

export interface CareProduct {
  product_id: string;
  product_code: string;
  name: string;
  slug: string;
  category_id: string | null;
  category_name?: string | null;
  primary_image_url: string | null;
  retail_status: "draft" | "live" | "archived";
  short_description: string | null;
  long_description: string | null;
  ingredients: string | null;
  directions: string | null;
  warnings: string | null;
  search_keywords: string[];
  taxable: boolean;
  vat_rate: number | string | null;
  is_visible_storefront: false; // PR1: never customer-facing
  stock_on_hand: number;
  stock_available: number;
  variants?: CareVariant[];
  images?: ProductImage[];
  has_cost_gap?: boolean;
}

export interface CareVariantInput {
  sku?: string;
  label?: string;
  barcode?: string | null;
  price_storefront_ngn?: number | null;
  price_storefront_usd?: number | null;
  price_pos_ngn?: number | null;
  price_pos_usd?: number | null;
  reorder_point?: number;
}

export interface CareCreateInput {
  name: string;
  product_code?: string;
  category_id?: string;
  short_description?: string | null;
  long_description?: string | null;
  ingredients?: string | null;
  directions?: string | null;
  warnings?: string | null;
  search_keywords?: string[];
  taxable: boolean;
  vat_rate?: number | null;
  variants: CareVariantInput[];
}

export type CareUpdateInput = Partial<Omit<CareCreateInput, "variants" | "product_code">>;

export interface CareCountLine {
  row: number | null;
  kind: "counted" | "unlisted";
  variant_id: string;
  product_name: string;
  sku: string;
  system_count: number;
  physical_count: number;
  delta: number;
}
export interface CareCountResult {
  lines: CareCountLine[];
  blockers: string[];
  skipped: { sku: string; row: number }[];
  summary: {
    rows_read: number;
    corrections: number;
    zeroed: number;
    unchanged: number;
    surplus: number;
    write_down: number;
    net: number;
    system_total: number;
    ends_at: number;
  };
  adjustment: { adjustment_id: string; adjustment_number: string; status: string } | null;
}
export interface CareCountInput {
  location_id: string;
  rows: Record<string, unknown>[];
  blank: "skip" | "zero";
  unlisted: "skip" | "zero";
  reason: string;
  commit: boolean;
}

export function useCareAvailability() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["care", brand, "availability"],
    queryFn: () => api.get<{ enabled: boolean }>(`${ROOT}/availability`),
    enabled: brand === "pixiegirl",
    staleTime: 30_000,
    retry: false,
  });
}

export function useCareProducts(filters: { q?: string; category_id?: string; status?: string; page?: number; page_size?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["care", brand, "list", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
      return api.get<{ data: CareProduct[]; meta: { total: number; has_more: boolean; page: number } }>(`${ROOT}?${params}`);
    },
    enabled: brand === "pixiegirl",
  });
}

export function useCareProduct(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["care", brand, "one", id],
    queryFn: () => api.get<CareProduct>(`${ROOT}/${id}`),
    enabled: !!id && brand === "pixiegirl",
  });
}

export function useCareTrash(open: boolean) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["care", brand, "trash"],
    queryFn: () => api.get<{ data: CareProduct[]; meta: { total: number; has_more: boolean } }>(`${ROOT}/trash?page_size=100`),
    enabled: open && brand === "pixiegirl",
  });
}

export function useCareCategories() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["care", brand, "categories"],
    queryFn: () => api.get<Category[]>(`${ROOT}/categories`),
    enabled: brand === "pixiegirl",
  });
}

export function useCareActions() {
  const brand = useBrand();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["care", brand] });
  return {
    create: useMutation({ mutationFn: (input: CareCreateInput) => api.post<CareProduct>(ROOT, input), onSuccess: refresh }),
    clone: useMutation({ mutationFn: ({ id, input }: { id: string; input: { name: string; product_code?: string; variants: { sku: string; label?: string; barcode?: string | null }[] } }) => api.post<CareProduct>(`${ROOT}/${id}/clone`, input), onSuccess: refresh }),
    restore: useMutation({ mutationFn: (id: string) => api.post<CareProduct>(`${ROOT}/${id}/restore`), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: CareUpdateInput }) => api.patch<CareProduct>(`${ROOT}/${id}`, patch), onSuccess: refresh }),
    addVariant: useMutation({ mutationFn: ({ id, input }: { id: string; input: CareVariantInput }) => api.post<CareVariant>(`${ROOT}/${id}/variants`, input), onSuccess: refresh }),
    editVariant: useMutation({ mutationFn: ({ id, variantId, patch }: { id: string; variantId: string; patch: CareVariantInput & { is_active?: boolean } }) => api.patch<CareVariant>(`${ROOT}/${id}/variants/${variantId}`, patch), onSuccess: refresh }),
    removeVariant: useMutation({ mutationFn: ({ id, variantId }: { id: string; variantId: string }) => api.delete<void>(`${ROOT}/${id}/variants/${variantId}`), onSuccess: refresh }),
    publish: useMutation({ mutationFn: (id: string) => api.post<CareProduct>(`${ROOT}/${id}/publish`), onSuccess: refresh }),
    unpublish: useMutation({ mutationFn: ({ id, archive }: { id: string; archive: boolean }) => api.post<CareProduct>(`${ROOT}/${id}/unpublish`, { archive }), onSuccess: refresh }),
    trash: useMutation({ mutationFn: (id: string) => api.delete<void>(`${ROOT}/${id}`), onSuccess: refresh }),
    uploadImage: useMutation({ mutationFn: ({ id, file, alt_text }: { id: string; file: File; alt_text?: string }) => {
      const form = new FormData(); form.append("file", file); if (alt_text) form.append("alt_text", alt_text);
      return api.postForm<ProductImage>(`/catalogue/products/${id}/images`, form);
    }, onSuccess: refresh }),
    removeImage: useMutation({ mutationFn: ({ id, imageId }: { id: string; imageId: string }) => api.delete<void>(`/catalogue/products/${id}/images/${imageId}`), onSuccess: refresh }),
  };
}

export interface CareSkuAtLocation {
  variant_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  variant_name: string;
  is_active: boolean;
  on_hand: number;
  reserved: number;
  has_operational_cost: boolean;
}
export const careStockApi = {
  skus: (location_id: string) => api.get<{ location: { location_id: string; display_name: string }; rows: CareSkuAtLocation[] }>(`/stock/adjustments/care-skus?location_id=${encodeURIComponent(location_id)}`),
  count: (input: CareCountInput) => api.post<CareCountResult>("/stock/adjustments/import-care-count", input),
  receipt: (input: {
    destination_location_id: string;
    notes?: string;
    lines: { variant_id: string; quantity: number; unit_cost_ngn: number; po_line_id?: string }[];
    purchase_order_id?: string;
  }) => api.post("/stock/goods-receipts", input),
};
