import { api, type ApiError } from "./api";
import { deviceId } from "./device";
import type { ProductCard } from "./storefront";

/**
 * Shop AI Search ("ask Praxis") — the shop page's search box, upgraded.
 * Plain keywords still filter instantly client-side (see shop.tsx); pressing
 * enter / tapping "Ask Praxis" escalates to this Gemini-backed endpoint for
 * a real-life ask ("what should I wear for a first date"). Stateless: we
 * resend the last few turns as `history` so a follow-up can refine without
 * a server session.
 */

export interface AiSearchTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiSearchMatch {
  collection: { slug: string; name: string } | null;
  bundle: { bundle_code: string; display_name: string } | null;
  shade: { slug: string; name: string } | null;
}

export interface AiSearchQuota {
  used: number;
  limit: number;
  remaining: number;
  resets_in_seconds: number;
}

export interface AiSearchResult {
  message: string;
  followup_question: string | null;
  products: ProductCard[];
  matched: AiSearchMatch;
  quota: AiSearchQuota;
}

export const askPraxisSearch = (query: string, history?: AiSearchTurn[]) =>
  api.post<AiSearchResult>(
    "/api/public/storefront/search/ai",
    { query, history },
    { headers: { "X-Device-Id": deviceId() } },
  );

export function isQuotaError(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as ApiError).code === "QUOTA_EXCEEDED";
}
