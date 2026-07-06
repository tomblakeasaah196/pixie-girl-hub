/**
 * Search API client (Hub-wide ⌘K palette).
 *
 * Talks to /api/v1/search — see src/modules/search on the backend for the
 * unified fan-out design. Every call inherits the X-Brand-Context header via
 * lib/api.ts, so a search returns records from the ACTIVE brand only, unless
 * the caller explicitly asks for scope="all" (CEO / multi-brand toggle).
 */

import { api } from "@/lib/api";

export type ResultType =
  | "sale_order"
  | "crm_deal"
  | "smartcomm_thread"
  | "product"
  | "stock_variant"
  | "delivery"
  | "invoice"
  | "payment"
  | "expense"
  | "cash_request"
  | "contact"
  | "employee"
  | "sales_campaign"
  | "help_article"
  | "document";

export interface SearchHit {
  id: string;
  type: ResultType;
  title: string;
  subtitle: string;
  meta: Record<string, unknown>;
  route: string;
  /** Present only when scope='all' — surfaces which brand this hit came from. */
  brand?: string;
}

export interface SearchGroup {
  key: ResultType;
  label: string;
  group: string;
  icon: string;
  hits: SearchHit[];
}

export interface SearchResponse {
  groups: SearchGroup[];
  scope: "brand" | "all";
  brands_searched: string[];
}

export interface Suggestions {
  orders: SearchHit[];
  contacts: SearchHit[];
  invoices: SearchHit[];
}

export interface AvailableType {
  key: ResultType;
  label: string;
  group: string;
  icon: string;
}

export async function search(
  q: string,
  opts: {
    types?: ResultType[];
    limit?: number;
    scope?: "brand" | "all";
    signal?: AbortSignal;
  } = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  if (opts.types?.length) params.set("types", opts.types.join(","));
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.scope) params.set("scope", opts.scope);
  return api.get<SearchResponse>(`/search?${params.toString()}`);
}

export async function suggestions(): Promise<Suggestions> {
  return api.get<Suggestions>("/search/suggestions");
}

export async function availableTypes(): Promise<AvailableType[]> {
  return api.get<AvailableType[]>("/search/types");
}
