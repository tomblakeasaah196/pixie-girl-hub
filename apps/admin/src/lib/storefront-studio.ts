/**
 * Storefront Studio - admin data layer (queries + mutations).
 *
 * Controls the customer-facing Storefront Website's appearance: theme tokens,
 * navigation, pages/templates, SEO/OG, branding (logo/favicon/OG as theme
 * tokens), and popups. The website renders the PUBLISHED config at SSR via
 * GET /api/public/storefront/site. This is separate from Landing Studio
 * (sales campaign landing) and from the admin/ERP appearance.
 *
 * Brand is injected by the api client from the active business store, so the
 * backend resolves it from req.brand - we don't pass it per call.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

export function useActiveBrand() {
  return useBusinessStore((s) => s.activeKey);
}

export type StudioStatus = "draft" | "published" | "archived";

export interface ThemeRow {
  theme_id: string;
  business: string;
  status: StudioStatus;
  tokens: Record<string, string>;
}

export interface NavRow {
  nav_id?: string;
  status?: StudioStatus;
  header_items: unknown[];
  footer_columns: unknown[];
  socials: Record<string, string>;
}

export interface PageRow {
  page_id?: string;
  page_key: string;
  template_key: string;
  status?: StudioStatus;
  url_path: string;
  meta_title?: string | null;
  meta_description?: string | null;
  og_image_url?: string | null;
  slots: Record<string, unknown>;
}

export interface PopupRow {
  popup_id?: string;
  popup_key: string;
  status?: StudioStatus;
  trigger_type:
    | "time_delay"
    | "scroll_depth"
    | "exit_intent"
    | "page_load"
    | "add_to_cart";
  trigger_value?: number | null;
  audience: "all" | "new" | "returning" | "guest" | "member";
  content: Record<string, unknown>;
  display_rules: Record<string, unknown>;
  display_order: number;
  is_active: boolean;
}

export interface SectionTemplate {
  template_key: string;
  category: string;
  display_name: string;
  description?: string;
  preview_image_url?: string;
  default_slots: Record<string, unknown>;
  display_order: number;
}

const key = (k: string, brand: string | null) => ["storefront-studio", k, brand];

// -- Theme --------------------------------------------------
export function useThemes() {
  const brand = useActiveBrand();
  return useQuery<ThemeRow[]>({
    queryKey: key("theme", brand),
    queryFn: () => api.get<ThemeRow[]>("/storefront-studio/theme"),
  });
}
export function useSaveThemeDraft() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (tokens: Record<string, string>) =>
      api.put("/storefront-studio/theme/draft", { tokens }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("theme", brand) }),
  });
}
export function usePublishTheme() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: () => api.post("/storefront-studio/theme/publish"),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("theme", brand) }),
  });
}

// -- Navigation ---------------------------------------------
export function useNavigation() {
  const brand = useActiveBrand();
  return useQuery<NavRow[]>({
    queryKey: key("nav", brand),
    queryFn: () => api.get<NavRow[]>("/storefront-studio/navigation"),
  });
}
export function useSaveNavDraft() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (nav: NavRow) =>
      api.put("/storefront-studio/navigation/draft", nav),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("nav", brand) }),
  });
}
export function usePublishNav() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: () => api.post("/storefront-studio/navigation/publish"),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("nav", brand) }),
  });
}

// -- Pages --------------------------------------------------
export function usePages() {
  const brand = useActiveBrand();
  return useQuery<PageRow[]>({
    queryKey: key("pages", brand),
    queryFn: () => api.get<PageRow[]>("/storefront-studio/pages"),
  });
}
export function useSavePageDraft() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (page: PageRow) =>
      api.put("/storefront-studio/pages/draft", page),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("pages", brand) }),
  });
}
export function usePublishPage() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (pageKey: string) =>
      api.post(`/storefront-studio/pages/${pageKey}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("pages", brand) }),
  });
}

// -- Popups -------------------------------------------------
export function usePopups() {
  const brand = useActiveBrand();
  return useQuery<PopupRow[]>({
    queryKey: key("popups", brand),
    queryFn: () => api.get<PopupRow[]>("/storefront-studio/popups"),
  });
}
export function useSavePopupDraft() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (popup: PopupRow) =>
      api.put("/storefront-studio/popups/draft", popup),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("popups", brand) }),
  });
}
export function usePublishPopup() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (popupKey: string) =>
      api.post(`/storefront-studio/popups/${popupKey}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("popups", brand) }),
  });
}
export function useDeletePopup() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (popupKey: string) =>
      api.delete(`/storefront-studio/popups/${popupKey}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("popups", brand) }),
  });
}

// -- Section template library -------------------------------
export function useSectionTemplates() {
  const brand = useActiveBrand();
  return useQuery<SectionTemplate[]>({
    queryKey: key("section-templates", brand),
    queryFn: () => api.get<SectionTemplate[]>("/storefront-studio/section-templates"),
  });
}

// -- Branding upload (logo / favicon / OG) ------------------
export async function uploadStorefrontImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await api.postForm<{ url: string }>(
    "/storefront-studio/upload-image",
    form,
  );
  return res.url;
}

// -- Preview (draft preview token + storefront URL) ---------
export interface PreviewInfo {
  token: string;
  base_url: string | null;
}
export function usePreviewInfo() {
  const brand = useActiveBrand();
  return useQuery<PreviewInfo>({
    queryKey: key("preview", brand),
    queryFn: () => api.get<PreviewInfo>("/storefront-studio/preview"),
    staleTime: 10 * 60 * 1000, // token lives 30m; refresh well before expiry
  });
}

// -- Revisions (history + rollback) -------------------------
export interface RevisionRow {
  revision_id: string;
  entity_type: "theme" | "page" | "navigation";
  entity_id: string;
  published_by?: string | null;
  published_at: string;
  change_summary?: string | null;
}
export function useRevisions() {
  const brand = useActiveBrand();
  return useQuery<RevisionRow[]>({
    queryKey: key("revisions", brand),
    queryFn: () => api.get<RevisionRow[]>("/storefront-studio/revisions"),
  });
}
export function useRollbackRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) =>
      api.post(`/storefront-studio/revisions/${revisionId}/rollback`),
    // Rollback restores a draft for whichever entity -> refresh all studio data.
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["storefront-studio"] }),
  });
}

/** Pick the published row (else draft) from a [draft, published] list. */
export function pickActive<T extends { status?: StudioStatus }>(
  rows?: T[],
): T | undefined {
  if (!rows || !rows.length) return undefined;
  return rows.find((r) => r.status === "published") || rows[0];
}
