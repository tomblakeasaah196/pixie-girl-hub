/**
 * Social platform registry — typed client. Mirrors
 * `src/modules/social_platforms/social-platforms.routes.js`.
 *
 * This is what makes the Accounts dashboard's platform list data-driven
 * instead of hardcoded to Instagram/Facebook/TikTok/YouTube: every card and
 * every "Add handle" platform option is rendered from these rows, so
 * registering X/Pinterest/Threads/whatever else Apify covers is a form
 * submit here, not a deploy.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface MetricSpec {
  key: string;
  label: string;
  aliases: string[];
}

export interface SocialPlatformDef {
  platform_key: string;
  display_name: string;
  brand_color: string;
  icon_glyph: string;
  apify_actor_id: string | null;
  apify_input_template: Record<string, unknown>;
  metrics_schema: MetricSpec[];
  supports_bio: boolean;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialPlatformCreateInput {
  platform_key: string;
  display_name: string;
  brand_color: string;
  icon_glyph?: string;
  apify_actor_id?: string;
  apify_input_template?: Record<string, unknown>;
  metrics_schema?: MetricSpec[];
  supports_bio?: boolean;
  sort_order?: number;
  notes?: string;
}

export type SocialPlatformUpdateInput = Partial<
  Omit<SocialPlatformCreateInput, "platform_key">
>;

export const socialPlatformsApi = {
  list: (includeInactive = true) =>
    api.get<SocialPlatformDef[]>(
      `/social-platforms${includeInactive ? "" : "?active=true"}`,
    ),
  create: (input: SocialPlatformCreateInput) =>
    api.post<SocialPlatformDef>("/social-platforms", input),
  update: (key: string, input: SocialPlatformUpdateInput) =>
    api.patch<SocialPlatformDef>(`/social-platforms/${key}`, input),
  setActive: (key: string, is_active: boolean) =>
    api.post<SocialPlatformDef>(`/social-platforms/${key}/active`, { is_active }),
};

const KEY = ["social-platforms"] as const;

export function useSocialPlatforms(includeInactive = true) {
  return useQuery({
    queryKey: [...KEY, includeInactive],
    queryFn: () => socialPlatformsApi.list(includeInactive),
    staleTime: 60_000,
  });
}

export function useCreateSocialPlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SocialPlatformCreateInput) =>
      socialPlatformsApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateSocialPlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { key: string; input: SocialPlatformUpdateInput }) =>
      socialPlatformsApi.update(args.key, args.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetSocialPlatformActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { key: string; is_active: boolean }) =>
      socialPlatformsApi.setActive(args.key, args.is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
