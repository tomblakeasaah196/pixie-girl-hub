import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { getSiteContent } from "./site-content.functions";

/**
 * Hook for components to read a site-content override with a typed fallback.
 *
 * - Returns `fallback` immediately (no flash) while the query loads.
 * - Once overrides arrive, deep-merges shallow overrides into the fallback
 *   when the override is an object, otherwise replaces.
 *
 * `key` examples:
 *   "why_choose"
 *   "artistry:product:signature-pixie"
 *   "faq:collection:signature"
 *
 * This is studio-ready: any key written via the future admin UI will surface
 * immediately on the storefront.
 */
export function useSiteContent<T>(key: string, fallback: T): T {
  const fetcher = useServerFn(getSiteContent);
  const { data } = useQuery({
    queryKey: ["site-content", key],
    queryFn: () => fetcher({ data: { keys: [key] } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  return useMemo(() => {
    const raw = data?.[key];
    if (raw == null) return fallback;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return fallback; }
    if (
      parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      typeof fallback === "object" && fallback !== null && !Array.isArray(fallback)
    ) {
      return { ...(fallback as object), ...(parsed as object) } as T;
    }
    return parsed as T;
  }, [data, key, fallback]);
}
