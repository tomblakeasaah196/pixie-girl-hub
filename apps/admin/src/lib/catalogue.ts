/**
 * Catalogue — data layer (canon §5). Typed TanStack Query hooks for the
 * base→styled product model (P0-6), categories, collections, the cost vault
 * (P0-1), AI drafting (P0-8) and promotional bundles (retention engine).
 *
 * Per-brand resources carry the active brand key in their query key so a
 * brand switch refetches; the API attaches the brand via X-Brand-Context
 * (lib/api.ts). The access boundary is the server — these hooks never
 * request a hidden field (cost) unless access is confirmed first.
 */

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api, getAccessToken } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import { getSocket, rooms } from "@/lib/socket";

export function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

/** A BASE product — the China-origin, stock-bearing record (the only place
 *  stock lives). Marketing skins (StyledProduct) sit on top of this. */
export interface BaseProduct {
  product_id: string;
  category_id: string | null;
  product_code: string;
  name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  texture_type: string | null;
  lace_type: string | null;
  hair_length_inches: number | null;
  density: string | null;
  cap_size: string | null;
  primary_colour: string | null;
  hair_origin: string | null;
  care_instructions: string | null;
  product_type: string | null;
  is_visible_storefront: boolean;
  brand_name: string | null;
  track_stock: boolean;
  // Pre-order / production timeline (P0-7).
  preorder_enabled: boolean;
  expected_ready_date: string | null;
  production_lead_days: number | null;
  primary_image_url?: string | null;
  is_deleted?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Variant {
  variant_id: string;
  product_id: string;
  sku: string | null;
  variant_name: string | null;
  variant_length_inches: number | null;
  variant_colour: string | null;
  price_storefront_ngn: number | null;
  price_pos_ngn: number | null;
  // Operational wholesale price stays visible to ops/sales (NOT cost).
  price_wholesale_ngn: number | null;
  price_partner_ngn: number | null;
  compare_at_price_ngn: number | null;
  reorder_point: number | null;
  is_default: boolean;
  is_active: boolean;
  // cost_price_ngn / min_price_ngn are NEVER present here — true cost is
  // server-redacted and lives in the vault.
}

export type StyledStatus = "draft" | "live" | "archived";
export type AvailabilityState = "in_stock" | "preorder" | "out_of_stock";

export interface Availability {
  state: AvailabilityState;
  available: number;
  message?: string;
  expected_ready_date?: string | null;
  production_lead_days?: number | null;
}

/** A STYLED product — a storefront skin over exactly one base product. No
 *  stock of its own; availability + price are derived from the base. */
export interface StyledProduct {
  styled_id: string;
  base_product_id: string;
  base_variant_id: string | null;
  styled_code: string;
  name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  style_addon_price_ngn: number | null;
  // Styled retail is its OWN price (the size-S anchor), not base + add-on.
  retail_price_ngn: number | null;
  compare_at_price_ngn: number | null;
  category_id: string | null;
  status: StyledStatus;
  is_visible_storefront: boolean;
  meta_title: string | null;
  meta_description: string | null;
  search_keywords: string[] | null;
  // AI provenance (P0-8).
  ai_drafted?: boolean;
  ai_model?: string | null;
  ai_confidence?: number | null;
  published_by?: string | null;
  published_at?: string | null;
  // Joined / derived.
  base_name: string;
  base_product_code: string;
  availability: Availability;
  base_price_ngn: number | null;
  effective_price_ngn: number | null;
  // Attached on the detail fetch.
  colours?: StyledColour[];
  variants?: StyledVariant[];
  price_range?: { min: number; max: number } | null;
  created_at: string;
}

/** A colour option on a styled product — owns its own pictures + optional
 *  video/IG link and an optional per-colour price bump. */
export interface StyledColour {
  colour_id: string;
  styled_id: string;
  name: string;
  hex: string | null;
  premium_ngn: number;
  video_url: string | null;
  external_video_url: string | null;
  display_order: number;
  is_default: boolean;
  is_active: boolean;
  image_count?: number;
}

/** A sellable colour × size SKU. effective_price_ngn is the computed retail
 *  (anchor + colour premium + size premium) unless price_override_ngn is set. */
export interface StyledVariant {
  styled_variant_id: string;
  styled_id: string;
  colour_id: string;
  size_code: string;
  sku: string;
  price_override_ngn: number | null;
  compare_at_price_ngn: number | null;
  is_active: boolean;
  is_default: boolean;
  display_order: number;
  // Joined / computed by the server.
  colour_name: string;
  colour_hex: string | null;
  colour_premium_ngn: number;
  size_label: string;
  size_premium_ngn: number;
  anchor_price_ngn: number | null;
  effective_price_ngn: number | null;
}

/** Brand-wide head-size ladder (S/M/L/XL) — premium + circumference + tip. */
export interface SizeTier {
  tier_id?: string;
  size_code: string;
  label: string;
  premium_ngn: number;
  circumference_min_in: number | null;
  circumference_max_in: number | null;
  circumference_min_cm: number | null;
  circumference_max_cm: number | null;
  guidance_text: string | null;
  display_order: number;
  is_active: boolean;
}
export interface CatalogueConfig {
  size_guide_title: string;
  head_size_guide_md: string | null;
}
export interface SizeConfig {
  tiers: SizeTier[];
  config: CatalogueConfig | null;
}

export interface ProductImage {
  image_id: string;
  cdn_url: string | null;
  alt_text: string | null;
  caption: string | null;
  display_order: number;
}

export interface Category {
  category_id: string;
  parent_category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
  is_visible_storefront: boolean;
  is_active: boolean;
}

export interface Collection {
  collection_id: string;
  name: string;
  slug: string;
  description: string | null;
  /** 'manual' = explicit members; 'rule' = auto-populated. Matches the DB
   *  column (was wrongly read as `collection_type` before). */
  mode: "manual" | "rule";
  is_visible_storefront: boolean;
  is_active: boolean;
}

/** A service offering (Service Catalogue) — revamps, installs, repairs.
 *  Lives in shared.service_offerings, scoped by `business`. */
export interface ServiceOffering {
  service_id: string;
  business: string;
  name: string;
  slug: string;
  description: string | null;
  base_price_ngn: number | null;
  duration_minutes: number | null;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  required_stylist_tier: string | null;
  created_at: string;
}

export interface VariantCost {
  variant_id: string;
  cost_ngn: number | null;
  cost_native: { amount: number; currency: string } | null;
  supplier_id: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  cost_source: string | null;
  cost_last_refreshed_at: string | null;
}

export interface VaultGrant {
  grant_id: string;
  user_id: string;
  user_email: string | null;
  business: string;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
}

export interface Bundle {
  bundle_id: string;
  bundle_code: string;
  display_name: string;
  description: string | null;
  pricing_model: string;
  bundle_price_ngn: number | null;
  discount_value: number | null;
  valid_from: string;
  valid_to: string | null;
  is_visible_storefront: boolean;
  is_active: boolean;
  display_order: number;
}

// ════════════════════════════════════════════════════════════
// Base products
// ════════════════════════════════════════════════════════════
export interface BaseFilters {
  q?: string;
  category_id?: string;
  visible?: boolean;
}

function qs(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!parts.length) return "";
  return "?" + parts.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
}

export function useBaseProducts(filters: BaseFilters = {}) {
  const brand = useBrand();
  return useQuery<BaseProduct[]>({
    queryKey: ["catalogue", "base", brand, filters],
    queryFn: () =>
      api.get<BaseProduct[]>(
        `/catalogue/products${qs({
          q: filters.q,
          category_id: filters.category_id,
          visible: filters.visible === undefined ? undefined : String(filters.visible),
          page_size: "100",
        })}`,
      ),
  });
}

export function useBaseProduct(id: string | null) {
  const brand = useBrand();
  return useQuery<BaseProduct>({
    queryKey: ["catalogue", "base", brand, "one", id],
    queryFn: () => api.get<BaseProduct>(`/catalogue/products/${id}`),
    enabled: !!id,
  });
}

export function useCreateBaseProduct() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Partial<BaseProduct>) =>
      api.post<BaseProduct>("/catalogue/products", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "base", brand] }),
  });
}

// ── Bulk import (Excel/CSV) ───────────────────────────────
/** One spreadsheet row, normalised. Codes/slugs/SKUs are generated server-side
 *  — the operator's sheet only carries the merchandising fields. Weight (g)
 *  rides on the auto-created default variant (the shipping-weight field). */
export interface BulkImportRow {
  name: string;
  texture_type?: string;
  lace_type?: string;
  hair_length_inches?: number;
  weight_g?: number;
}
export interface BulkImportCreated {
  row: number;
  product_id: string;
  product_code: string;
  name: string;
  variant_id: string;
  weight_g: number | null;
}
export interface BulkImportResult {
  count: number;
  created: BulkImportCreated[];
}
export function useBulkImportProducts() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (rows: BulkImportRow[]) =>
      api.post<BulkImportResult>("/catalogue/products/bulk-import", { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "base", brand] }),
  });
}

export function useUpdateBaseProduct(id: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: Partial<BaseProduct>) =>
      api.patch<BaseProduct>(`/catalogue/products/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "base", brand] }),
  });
}

export function useDeleteBaseProduct() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/catalogue/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "base", brand] }),
  });
}

// ── Variants (under a base product) ──────────────────────
export function useVariants(productId: string | null) {
  const brand = useBrand();
  return useQuery<Variant[]>({
    queryKey: ["catalogue", "variants", brand, productId],
    queryFn: () => api.get<Variant[]>(`/catalogue/products/${productId}/variants`),
    enabled: !!productId,
  });
}

export function useAddVariant(productId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Partial<Variant>) =>
      api.post<Variant>(`/catalogue/products/${productId}/variants`, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["catalogue", "variants", brand, productId] }),
  });
}

export function useUpdateVariant(productId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ variantId, patch }: { variantId: string; patch: Partial<Variant> }) =>
      api.patch<Variant>(`/catalogue/products/${productId}/variants/${variantId}`, patch),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["catalogue", "variants", brand, productId] }),
  });
}

// ════════════════════════════════════════════════════════════
// Styled products
// ════════════════════════════════════════════════════════════
export interface StyledFilters {
  q?: string;
  status?: StyledStatus;
  base_product_id?: string;
  category_id?: string;
}

export function useStyledProducts(filters: StyledFilters = {}) {
  const brand = useBrand();
  return useQuery<StyledProduct[]>({
    queryKey: ["catalogue", "styled", brand, filters],
    queryFn: () =>
      api.get<StyledProduct[]>(
        `/catalogue/styled-products${qs({
          q: filters.q,
          status: filters.status,
          base_product_id: filters.base_product_id,
          category_id: filters.category_id,
          page_size: "100",
        })}`,
      ),
  });
}

export function useStyledProduct(id: string | null) {
  const brand = useBrand();
  return useQuery<StyledProduct>({
    queryKey: ["catalogue", "styled", brand, "one", id],
    queryFn: () => api.get<StyledProduct>(`/catalogue/styled-products/${id}`),
    enabled: !!id,
  });
}

function invalidateStyled(qc: QueryClient, brand: string) {
  qc.invalidateQueries({ queryKey: ["catalogue", "styled", brand] });
}

export function useCreateStyled() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Partial<StyledProduct>) =>
      api.post<StyledProduct>("/catalogue/styled-products", input),
    onSuccess: () => invalidateStyled(qc, brand),
  });
}

export function useUpdateStyled(id: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: Partial<StyledProduct>) =>
      api.patch<StyledProduct>(`/catalogue/styled-products/${id}`, patch),
    onSuccess: () => invalidateStyled(qc, brand),
  });
}

export function usePublishStyled() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<StyledProduct>(`/catalogue/styled-products/${id}/publish`),
    onSuccess: () => invalidateStyled(qc, brand),
  });
}

export function useUnpublishStyled() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive?: boolean }) =>
      api.post<StyledProduct>(`/catalogue/styled-products/${id}/unpublish`, { archive: !!archive }),
    onSuccess: () => invalidateStyled(qc, brand),
  });
}

export function useRemoveStyled() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/catalogue/styled-products/${id}`),
    onSuccess: () => invalidateStyled(qc, brand),
  });
}

export interface AiDraftInput {
  base_product_id: string;
  instructions?: string;
  tone?: string;
  category_id?: string;
}
export interface AiDraftResult {
  draft: StyledProduct;
  generated: Record<string, unknown>;
}

export function useAiDraftStyled() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: AiDraftInput) =>
      api.post<AiDraftResult>("/catalogue/styled-products/ai-draft", input),
    onSuccess: () => invalidateStyled(qc, brand),
  });
}

// ════════════════════════════════════════════════════════════
// Categories & Collections
// ════════════════════════════════════════════════════════════
export function useCategories() {
  const brand = useBrand();
  return useQuery<Category[]>({
    queryKey: ["catalogue", "categories", brand],
    queryFn: () => api.get<Category[]>("/catalogue/categories"),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Partial<Category>) =>
      api.post<Category>("/catalogue/categories", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "categories", brand] }),
  });
}

export function useUpdateCategory(id: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: Partial<Category>) =>
      api.patch<Category>(`/catalogue/categories/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "categories", brand] }),
  });
}

export function useArchiveCategory() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/catalogue/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "categories", brand] }),
  });
}

export function useCollections() {
  const brand = useBrand();
  return useQuery<Collection[]>({
    queryKey: ["catalogue", "collections", brand],
    queryFn: () => api.get<Collection[]>("/catalogue/collections"),
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Partial<Collection>) =>
      api.post<Collection>("/catalogue/collections", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "collections", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Service Catalogue (revamps, installs, repairs) — /service-catalogue
// ════════════════════════════════════════════════════════════
export interface ServiceInput {
  name: string;
  slug: string;
  description?: string | null;
  base_price_ngn?: number;
  duration_minutes?: number | null;
  category?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

/** Admin list — includes inactive so they can be toggled back on. */
export function useServices() {
  const brand = useBrand();
  return useQuery<ServiceOffering[]>({
    queryKey: ["catalogue", "services", brand],
    queryFn: () =>
      api.get<ServiceOffering[]>("/service-catalogue?include_inactive=true"),
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: ServiceInput) =>
      api.post<ServiceOffering>("/service-catalogue", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "services", brand] }),
  });
}

export function useToggleService() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch<ServiceOffering>(`/service-catalogue/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "services", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Cost vault (P0-1) — server is the boundary
// ════════════════════════════════════════════════════════════
/** Boolean-only access probe so the UI can decide whether to render the
 *  cost section. Never returns cost/supplier data. */
export function useVaultAccess() {
  const brand = useBrand();
  return useQuery<{ can_see: boolean }>({
    queryKey: ["catalogue", "vault-access", brand],
    queryFn: () => api.get<{ can_see: boolean }>("/catalogue/cost-vault/access"),
    staleTime: 5 * 60_000,
  });
}

/** Fetch a variant's true cost — ONLY call when access is confirmed. */
export function useVariantCost(productId: string, variantId: string | null, enabled: boolean) {
  const brand = useBrand();
  return useQuery<VariantCost | null>({
    queryKey: ["catalogue", "cost", brand, variantId],
    queryFn: () =>
      api.get<VariantCost | null>(
        `/catalogue/products/${productId}/variants/${variantId}/cost`,
      ),
    enabled: enabled && !!variantId,
  });
}

export interface SetCostInput {
  cost_ngn?: number;
  cost_native?: { amount: number; currency: string };
  supplier_id?: string | null;
  cost_source?: string;
}

export function useSetVariantCost(productId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ variantId, input }: { variantId: string; input: SetCostInput }) =>
      api.put<{ variant_id: string }>(
        `/catalogue/products/${productId}/variants/${variantId}/cost`,
        input,
      ),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["catalogue", "cost", brand, vars.variantId] }),
  });
}

// ── Grants (owner only) ──────────────────────────────────
export function useVaultGrants(enabled: boolean) {
  const brand = useBrand();
  return useQuery<VaultGrant[]>({
    queryKey: ["catalogue", "vault-grants", brand],
    queryFn: () => api.get<VaultGrant[]>("/catalogue/cost-vault/grants"),
    enabled,
  });
}

export function useGrantVault() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: { user_id: string; business?: string }) =>
      api.post<VaultGrant>("/catalogue/cost-vault/grants", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "vault-grants", brand] }),
  });
}

export function useRevokeVault() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      api.delete<void>(`/catalogue/cost-vault/grants/${userId}${qs({ reason })}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "vault-grants", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Bundles (promotional engine, retention module)
// ════════════════════════════════════════════════════════════
export function useBundles() {
  const brand = useBrand();
  return useQuery<Bundle[]>({
    queryKey: ["catalogue", "bundles", brand],
    queryFn: () => api.get<Bundle[]>("/retention/bundles"),
  });
}

/** A bundle component points at a base product (or a specific variant) with a
 *  quantity. The backend requires at least one. */
export interface BundleComponentInput {
  product_id?: string;
  variant_id?: string;
  quantity?: number;
  role?: "core" | "free" | "discounted" | "optional";
}

export interface BundleCreateInput {
  bundle_code: string;
  display_name: string;
  description?: string | null;
  pricing_model: string;
  bundle_price_ngn?: number;
  discount_value?: number;
  is_visible_storefront?: boolean;
  components: BundleComponentInput[];
}

export function useCreateBundle() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: BundleCreateInput) =>
      api.post<Bundle>("/retention/bundles", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "bundles", brand] }),
  });
}

export function useToggleBundle() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch<Bundle>(`/retention/bundles/${id}/active`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "bundles", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Real-time: live availability via the stock room
// ════════════════════════════════════════════════════════════
/**
 * Subscribe to the brand's stock room and invalidate styled-availability
 * queries whenever stock moves elsewhere (POS sale, adjustment, receipt).
 * Degrades silently if the socket can't connect — the cache simply stays
 * until the next refetch.
 */
export function useStockRealtime() {
  const qc = useQueryClient();
  const brand = useBrand();
  useEffect(() => {
    if (!getAccessToken()) return;
    const socket = getSocket();
    const room = rooms.stock(brand);
    const join = () => socket.emit("join", room ? { room } : { room });
    if (socket.connected) join();
    socket.on("connect", join);

    const onChange = () => {
      qc.invalidateQueries({ queryKey: ["catalogue", "styled", brand] });
      qc.invalidateQueries({ queryKey: ["catalogue", "variants", brand] });
    };
    const evts = [
      "stock:moved",
      "stock:adjustment.posted",
      "stock:transfer.received",
      "stock:shipment.received",
    ];
    evts.forEach((e) => socket.on(e, onChange));

    return () => {
      socket.emit("leave", { room });
      socket.off("connect", join);
      evts.forEach((e) => socket.off(e, onChange));
    };
  }, [brand, qc]);
}

// ════════════════════════════════════════════════════════════
// Styled colours, colour×size variants, size config (this PR)
// ════════════════════════════════════════════════════════════

/** Invalidate everything that depends on a styled product's detail (the
 *  detail query carries colours + variants + price range). */
function invalidateStyledDetail(qc: QueryClient, brand: string, id: string) {
  qc.invalidateQueries({ queryKey: ["catalogue", "styled", brand, "one", id] });
  qc.invalidateQueries({ queryKey: ["catalogue", "styled-colours", brand, id] });
  qc.invalidateQueries({ queryKey: ["catalogue", "styled-variants", brand, id] });
  qc.invalidateQueries({ queryKey: ["catalogue", "styled", brand] });
}

// ── Size-tier ladder + head-size guide (one modal) ───────
export function useSizeConfig() {
  const brand = useBrand();
  return useQuery<SizeConfig>({
    queryKey: ["catalogue", "size-config", brand],
    queryFn: () => api.get<SizeConfig>("/catalogue/styled-products/size-config"),
  });
}

export interface SaveSizeConfigInput {
  tiers?: Partial<SizeTier>[];
  size_guide_title?: string | null;
  head_size_guide_md?: string | null;
}
export function useSaveSizeConfig() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: SaveSizeConfigInput) =>
      api.put<SizeConfig>("/catalogue/styled-products/size-config", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogue", "size-config", brand] });
      qc.invalidateQueries({ queryKey: ["catalogue", "styled", brand] });
    },
  });
}

// ── Colours ──────────────────────────────────────────────
export function useStyledColours(styledId: string | null) {
  const brand = useBrand();
  return useQuery<StyledColour[]>({
    queryKey: ["catalogue", "styled-colours", brand, styledId],
    queryFn: () =>
      api.get<StyledColour[]>(`/catalogue/styled-products/${styledId}/colours`),
    enabled: !!styledId,
  });
}
export function useCreateColour(styledId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Partial<StyledColour>) =>
      api.post<StyledColour>(`/catalogue/styled-products/${styledId}/colours`, input),
    onSuccess: () => invalidateStyledDetail(qc, brand, styledId),
  });
}
export function useUpdateColour(styledId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ colourId, patch }: { colourId: string; patch: Partial<StyledColour> }) =>
      api.patch<StyledColour>(
        `/catalogue/styled-products/${styledId}/colours/${colourId}`,
        patch,
      ),
    onSuccess: () => invalidateStyledDetail(qc, brand, styledId),
  });
}
export function useDeleteColour(styledId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (colourId: string) =>
      api.delete<void>(`/catalogue/styled-products/${styledId}/colours/${colourId}`),
    onSuccess: () => invalidateStyledDetail(qc, brand, styledId),
  });
}

// ── Per-colour images (2–3 pictures per colour) ──────────
export function useColourImages(styledId: string | null, colourId: string | null) {
  const brand = useBrand();
  return useQuery<ProductImage[]>({
    queryKey: ["catalogue", "colour-images", brand, styledId, colourId],
    queryFn: () =>
      api.get<ProductImage[]>(
        `/catalogue/styled-products/${styledId}/colours/${colourId}/images`,
      ),
    enabled: !!styledId && !!colourId,
  });
}
export function useAddColourImage(styledId: string, colourId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm<ProductImage>(
        `/catalogue/styled-products/${styledId}/colours/${colourId}/images`,
        form,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["catalogue", "colour-images", brand, styledId, colourId],
      });
      qc.invalidateQueries({ queryKey: ["catalogue", "styled-colours", brand, styledId] });
    },
  });
}
export function useRemoveColourImage(styledId: string, colourId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (imageId: string) =>
      api.delete<void>(
        `/catalogue/styled-products/${styledId}/colours/${colourId}/images/${imageId}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["catalogue", "colour-images", brand, styledId, colourId],
      });
      qc.invalidateQueries({ queryKey: ["catalogue", "styled-colours", brand, styledId] });
    },
  });
}

// ── Colour × size variants ───────────────────────────────
export function useStyledVariants(styledId: string | null) {
  const brand = useBrand();
  return useQuery<StyledVariant[]>({
    queryKey: ["catalogue", "styled-variants", brand, styledId],
    queryFn: () =>
      api.get<StyledVariant[]>(`/catalogue/styled-products/${styledId}/variants`),
    enabled: !!styledId,
  });
}
export interface BulkVariantInput {
  colour_ids?: string[];
  all_sizes?: boolean;
  size_codes?: string[];
}
export function useBulkCreateVariants(styledId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: BulkVariantInput) =>
      api.post<{ created_count: number; skipped: number }>(
        `/catalogue/styled-products/${styledId}/variants/bulk`,
        input,
      ),
    onSuccess: () => invalidateStyledDetail(qc, brand, styledId),
  });
}
export function useUpdateStyledVariant(styledId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ variantId, patch }: { variantId: string; patch: Partial<StyledVariant> }) =>
      api.patch<StyledVariant>(
        `/catalogue/styled-products/${styledId}/variants/${variantId}`,
        patch,
      ),
    onSuccess: () => invalidateStyledDetail(qc, brand, styledId),
  });
}
export function useDeleteStyledVariant(styledId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (variantId: string) =>
      api.delete<void>(`/catalogue/styled-products/${styledId}/variants/${variantId}`),
    onSuccess: () => invalidateStyledDetail(qc, brand, styledId),
  });
}

// ════════════════════════════════════════════════════════════
// Trash + Restore (free-the-name model)
// ════════════════════════════════════════════════════════════
export function useProductTrash(enabled = true) {
  const brand = useBrand();
  return useQuery<BaseProduct[]>({
    queryKey: ["catalogue", "trash", "products", brand],
    queryFn: () => api.get<BaseProduct[]>("/catalogue/products/trash?page_size=100"),
    enabled,
  });
}
export function useRestoreProduct() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<BaseProduct & { renamed: boolean }>(`/catalogue/products/${id}/restore`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogue", "trash", "products", brand] });
      qc.invalidateQueries({ queryKey: ["catalogue", "base", brand] });
    },
  });
}
export function useStyledTrash(enabled = true) {
  const brand = useBrand();
  return useQuery<StyledProduct[]>({
    queryKey: ["catalogue", "trash", "styled", brand],
    queryFn: () =>
      api.get<StyledProduct[]>("/catalogue/styled-products/trash?page_size=100"),
    enabled,
  });
}
export function useRestoreStyled() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<StyledProduct & { renamed: boolean }>(
        `/catalogue/styled-products/${id}/restore`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogue", "trash", "styled", brand] });
      invalidateStyled(qc, brand);
    },
  });
}

// ════════════════════════════════════════════════════════════
// Quick add-to-collection (from a product)
// ════════════════════════════════════════════════════════════
export function useAddCollectionMember() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ collectionId, productId }: { collectionId: string; productId: string }) =>
      api.post<{ member_id: string }>(
        `/catalogue/collections/${collectionId}/members`,
        { product_id: productId },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalogue", "collections", brand] }),
  });
}
