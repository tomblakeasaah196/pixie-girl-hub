/**
 * Landing Studio — admin data layer (queries + mutations).
 *
 * The design contract (types, brand defaults, withDefaults, hexToTriplet)
 * now lives in the shared @landing-kit package so the studio preview and the
 * public sales site render from one source of truth. It is re-exported here
 * so existing imports from "@/lib/landing-studio" keep working unchanged.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import type { LandingConfig } from "@landing-kit";
import type { LandingBlock } from "@/lib/campaigns";

// ── Shared config contract (re-exported from @landing-kit) ──────────
export type {
  ChannelOption,
  SocialLink,
  LandingTheme,
  RevealThreeD,
  LandingConfig,
} from "@landing-kit";
export { defaultConfig, withDefaults, hexToTriplet } from "@landing-kit";

export function useActiveBrand() {
  return useBusinessStore((s) => s.activeKey);
}

export interface LandingStudioPayload {
  business_key: string;
  config: LandingConfig | null;
  published_config: LandingConfig | null;
  is_published: boolean;
  published_at: string | null;
  updated_at: string | null;
}

// ════════════════════════════════════════════════════════════
// Queries + mutations
// ════════════════════════════════════════════════════════════

export function useLandingStudio() {
  const brand = useActiveBrand();
  return useQuery<LandingStudioPayload>({
    queryKey: ["landing-studio", brand],
    queryFn: () => api.get<LandingStudioPayload>("/landing-studio"),
  });
}

export function useSaveLandingDraft() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (config: LandingConfig) =>
      api.put<LandingStudioPayload>("/landing-studio", { config }),
    onSuccess: (data) => {
      qc.setQueryData(["landing-studio", brand], data);
    },
  });
}

export function usePublishLanding() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: () => api.post<LandingStudioPayload>("/landing-studio/publish"),
    onSuccess: (data) => {
      qc.setQueryData(["landing-studio", brand], data);
    },
  });
}

export async function uploadLandingImage(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { url } = await api.postForm<{ url: string }>(
    "/landing-studio/upload-image",
    form,
    { onProgress },
  );
  return url;
}

/** Upload any image and get back a composed 1200×630 Open Graph share banner. */
export async function uploadLandingOgBanner(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { url } = await api.postForm<{ url: string }>(
    "/landing-studio/upload-og",
    form,
    { onProgress },
  );
  return url;
}

// ════════════════════════════════════════════════════════════
// Campaign landing layer
// ════════════════════════════════════════════════════════════

/** Extra fields stored in the landing_extras JSONB column. */
export interface LandingExtras {
  live_now_pill?: string;
  browse_cta_text?: string;
  hero_overlay_opacity?: number;
  watermark_opacity?: number;
  countdown_closes_label?: string;
  favicon_url?: string | null;
  browser_tab_name?: string;
}

/** Full campaign landing payload returned by GET /:id/landing. */
export interface CampaignLanding {
  id: string;
  name: string;
  slug: string;
  starts_at: string;
  ends_at: string;
  landing_hero_title: string | null;
  landing_hero_subtitle: string | null;
  landing_hero_image_url: string | null;
  landing_cta_text: string | null;
  landing_blocks: LandingBlock[];
  countdown_message: string | null;
  ended_message: string | null;
  ended_redirect_to: string | null;
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
  landing_extras: LandingExtras;
}

export function useCampaignLanding(id: string | null) {
  const brand = useActiveBrand();
  return useQuery<CampaignLanding>({
    queryKey: ["campaign-landing", brand, id],
    // `api.get` already unwraps the backend's { data: ... } envelope, so the
    // return value IS the CampaignLanding. Unwrapping `.data` again yields
    // undefined, which React Query rejects → the query never resolves and the
    // studio's campaign panels spin forever. Return the value directly.
    queryFn: () => api.get<CampaignLanding>(`/sales-campaigns/${id}/landing`),
    enabled: !!id,
  });
}

export function useSaveCampaignLanding() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation<
    unknown,
    Error,
    { id: string; patch: Partial<CampaignLanding> }
  >({
    mutationFn: ({ id, patch }) =>
      api.patch(`/sales-campaigns/${id}/landing`, patch),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["campaign-landing", brand, id] });
      qc.invalidateQueries({ queryKey: ["campaigns", brand] });
    },
  });
}
