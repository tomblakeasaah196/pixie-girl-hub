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

export async function uploadLandingImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { url } = await api.postForm<{ url: string }>(
    "/landing-studio/upload-image",
    form,
  );
  return url;
}

/** Upload any image and get back a composed 1200×630 Open Graph share banner. */
export async function uploadLandingOgBanner(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { url } = await api.postForm<{ url: string }>(
    "/landing-studio/upload-og",
    form,
  );
  return url;
}
