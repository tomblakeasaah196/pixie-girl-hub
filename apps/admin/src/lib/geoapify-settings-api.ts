/**
 * Geoapify Settings — typed client. Mirrors
 * `src/modules/geoapify_settings/geoapify-settings.routes.js`. Singleton
 * (one platform-wide key, not per-brand) — same masked/reveal/test shape as
 * `apify-settings-api.ts`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface GeoapifySettings {
  setting_id: string;
  is_active: boolean;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  secrets_last_rotated_at: string | null;
  notes: string | null;
  has_api_key: boolean;
  api_key_first4: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeoapifyUpsertInput {
  api_key?: string;
  is_active?: boolean;
  notes?: string;
}

export interface GeoapifyTestResult {
  ok: boolean;
  platform: "geoapify";
  sample_address?: string | null;
}

export interface GeoapifyRevealResult {
  field: "api_key";
  value: string;
}

export interface GeoapifySecretReveal {
  reveal_id: string;
  field: string;
  revealed_at: string;
  source_ip: string | null;
  display_name: string | null;
  email: string | null;
}

export const geoapifySettingsApi = {
  get: () => api.get<GeoapifySettings | null>("/geoapify-settings"),
  upsert: (input: GeoapifyUpsertInput) =>
    api.post<GeoapifySettings>("/geoapify-settings", input),
  test: () => api.post<GeoapifyTestResult>("/geoapify-settings/test"),
  reveal: (password: string) =>
    api.post<GeoapifyRevealResult>("/geoapify-settings/reveal", {
      field: "api_key",
      password,
    }),
  listReveals: () => api.get<GeoapifySecretReveal[]>("/geoapify-settings/reveals"),
};

const KEY = ["geoapify-settings"] as const;

export function useGeoapifySettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => geoapifySettingsApi.get(),
    staleTime: 30_000,
  });
}

export function useUpsertGeoapifySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GeoapifyUpsertInput) => geoapifySettingsApi.upsert(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useTestGeoapifySettings() {
  return useMutation({ mutationFn: () => geoapifySettingsApi.test() });
}

export function useRevealGeoapifyKey() {
  return useMutation({
    mutationFn: (password: string) => geoapifySettingsApi.reveal(password),
  });
}

export function useGeoapifySecretReveals(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: [...KEY, "reveals"],
    queryFn: () => geoapifySettingsApi.listReveals(),
  });
}
