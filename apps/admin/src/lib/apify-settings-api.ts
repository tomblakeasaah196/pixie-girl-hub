/**
 * Apify Settings — typed client. Mirrors
 * `src/modules/apify_settings/apify-settings.routes.js`. Singleton (one
 * platform-wide key, not per-brand) — same masked/reveal/test shape as
 * `messaging-accounts-api.ts`, just without a per-row id.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface ApifySettings {
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

export interface ApifyUpsertInput {
  api_key?: string;
  is_active?: boolean;
  notes?: string;
}

export interface ApifyTestResult {
  ok: boolean;
  platform: "apify";
  username?: string | null;
  email?: string | null;
  plan?: string | null;
}

export interface ApifyRevealResult {
  field: "api_key";
  value: string;
}

export interface ApifySecretReveal {
  reveal_id: string;
  field: string;
  revealed_at: string;
  source_ip: string | null;
  display_name: string | null;
  email: string | null;
}

export const apifySettingsApi = {
  get: () => api.get<ApifySettings | null>("/apify-settings"),
  upsert: (input: ApifyUpsertInput) =>
    api.post<ApifySettings>("/apify-settings", input),
  test: () => api.post<ApifyTestResult>("/apify-settings/test"),
  reveal: (password: string) =>
    api.post<ApifyRevealResult>("/apify-settings/reveal", {
      field: "api_key",
      password,
    }),
  listReveals: () => api.get<ApifySecretReveal[]>("/apify-settings/reveals"),
};

const KEY = ["apify-settings"] as const;

export function useApifySettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => apifySettingsApi.get(),
    staleTime: 30_000,
  });
}

export function useUpsertApifySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApifyUpsertInput) => apifySettingsApi.upsert(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useTestApifySettings() {
  return useMutation({ mutationFn: () => apifySettingsApi.test() });
}

export function useRevealApifyKey() {
  return useMutation({
    mutationFn: (password: string) => apifySettingsApi.reveal(password),
  });
}

export function useApifySecretReveals(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: [...KEY, "reveals"],
    queryFn: () => apifySettingsApi.listReveals(),
  });
}
