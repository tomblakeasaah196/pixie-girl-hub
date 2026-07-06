/**
 * Help Center API client.
 *
 * The backend exposes the article catalogue at `/api/v1/help/*` and
 * mirrors article bodies into `ai_knowledge_chunks` so Praxis can ground
 * answers in the same text the user reads.
 */

import { api } from "@/lib/api";

export type HelpAudience = "all" | "ceo" | "staff" | "stylist";

export interface HelpCategory {
  category_id: string;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  sort_order: number;
}

export interface HelpArticleSummary {
  article_id: string;
  slug: string;
  title: string;
  summary?: string | null;
  audience: HelpAudience;
  related_module?: string | null;
  tags: string[];
  sort_order: number;
  view_count: number;
  updated_at: string;
  category_slug?: string | null;
  category_name?: string | null;
  category_icon?: string | null;
}

export interface HelpArticle extends HelpArticleSummary {
  body_markdown: string;
  praxis_indexed: boolean;
  is_active: boolean;
  category_id?: string | null;
  last_updated_by?: string | null;
  created_at: string;
}

export interface ArticleQuery {
  category?: string;
  module?: string;
  audience?: HelpAudience;
  q?: string;
  limit?: number;
}

function qs(params: ArticleQuery) {
  const u = new URLSearchParams();
  if (params.category) u.set("category", params.category);
  if (params.module) u.set("module", params.module);
  if (params.audience) u.set("audience", params.audience);
  if (params.q) u.set("q", params.q);
  if (params.limit) u.set("limit", String(params.limit));
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Admin (editor) shapes — the list includes retired/inactive rows. */
export interface HelpArticleAdmin extends HelpArticleSummary {
  praxis_indexed: boolean;
  is_active: boolean;
}

export interface ArticleWriteInput {
  slug?: string; // required on create, immutable on update
  title: string;
  summary?: string | null;
  body_markdown: string;
  audience: HelpAudience;
  category_slug: string;
  related_module?: string | null;
  tags?: string[];
  sort_order?: number;
  praxis_indexed?: boolean;
  is_active?: boolean;
}

export interface CategoryWriteInput {
  slug?: string; // required on create
  name: string;
  description?: string | null;
  icon?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export const helpApi = {
  listCategories: () => api.get<HelpCategory[]>("/help/categories"),
  listArticles: (params: ArticleQuery = {}) =>
    api.get<HelpArticleSummary[]>(`/help/articles${qs(params)}`),
  getArticle: (slug: string) => api.get<HelpArticle>(`/help/articles/${slug}`),

  // ── Editor (needs help_center edit/create/delete) ──
  admin: {
    listArticles: (params: ArticleQuery = {}) =>
      api.get<HelpArticleAdmin[]>(`/help/admin/articles${qs(params)}`),
    getArticle: (id: string) =>
      api.get<HelpArticle>(`/help/admin/articles/${id}`),
    listCategories: () => api.get<HelpCategory[]>("/help/admin/categories"),
    createArticle: (input: ArticleWriteInput) =>
      api.post<HelpArticle>("/help/articles", input),
    updateArticle: (id: string, patch: Partial<ArticleWriteInput>) =>
      api.patch<HelpArticle>(`/help/articles/${id}`, patch),
    retireArticle: (id: string) => api.delete<HelpArticle>(`/help/articles/${id}`),
    createCategory: (input: CategoryWriteInput) =>
      api.post<HelpCategory>("/help/categories", input),
    updateCategory: (id: string, patch: Partial<CategoryWriteInput>) =>
      api.patch<HelpCategory>(`/help/categories/${id}`, patch),
  },
};
