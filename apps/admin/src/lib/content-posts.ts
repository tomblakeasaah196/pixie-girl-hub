/**
 * Storefront Content — admin data layer (queries + mutations).
 *
 * The customer-facing FAQ / care-guide / journal / policy library. Published
 * posts render on the storefront AND feed Praxis's Brand Brain, so the shop
 * can talk about care, delivery and services without a developer. Drafts are
 * private to Studio. Brand is injected by the api client from the active
 * business store.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import type { ContentBlock } from "@/pages/storefront-studio/content-blocks";

export type ContentKind = "faq" | "guide" | "journal" | "policy";
export type ContentStatus = "draft" | "published" | "scheduled" | "archived";
export type FaqCategory =
  | "shipping"
  | "returns"
  | "care"
  | "payment"
  | "sizing"
  | "general";

export interface ContentPost {
  post_id: string;
  post_type: ContentKind;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  faq_category: FaqCategory | null;
  faq_question: string | null;
  tags: string[];
  content_blocks: ContentBlock[];
  meta_title: string | null;
  meta_description: string | null;
  status: ContentStatus;
  published_at: string | null;
  is_featured: boolean;
  display_order: number;
  reading_time_minutes: number | null;
  updated_at: string;
}

/** The fields the editor actually sends — everything else is derived server-side. */
export interface ContentPostInput {
  post_type: ContentKind;
  title: string;
  slug?: string | null;
  excerpt?: string | null;
  body?: string | null;
  hero_image_url?: string | null;
  hero_image_alt?: string | null;
  faq_category?: FaqCategory | null;
  faq_question?: string | null;
  tags?: string[];
  content_blocks?: ContentBlock[];
  is_featured?: boolean;
  display_order?: number;
}

function useActiveBrand() {
  return useBusinessStore((s) => s.activeKey);
}
const key = (brand: string | null) => ["storefront-content", brand];

export function useContentPosts() {
  const brand = useActiveBrand();
  return useQuery<ContentPost[]>({
    queryKey: key(brand),
    queryFn: () => api.get<ContentPost[]>("/storefront-studio/content"),
  });
}

export function useCreateContent() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (input: ContentPostInput) =>
      api.post<ContentPost>("/storefront-studio/content", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(brand) }),
  });
}

export function useUpdateContent() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: ({ postId, input }: { postId: string; input: ContentPostInput }) =>
      api.put<ContentPost>(`/storefront-studio/content/${postId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(brand) }),
  });
}

export function usePublishContent() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (postId: string) =>
      api.post<ContentPost>(`/storefront-studio/content/${postId}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(brand) }),
  });
}

export function useUnpublishContent() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (postId: string) =>
      api.post<ContentPost>(`/storefront-studio/content/${postId}/unpublish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(brand) }),
  });
}

export function useDeleteContent() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (postId: string) =>
      api.delete(`/storefront-studio/content/${postId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(brand) }),
  });
}

// ── UI metadata for the four content kinds ──────────────────
export const CONTENT_KINDS: {
  key: ContentKind;
  label: string;
  singular: string;
  blurb: string;
}[] = [
  {
    key: "faq",
    label: "FAQs",
    singular: "FAQ",
    blurb: "Quick answers. Praxis quotes these word-for-word — great for delivery, returns and care questions.",
  },
  {
    key: "guide",
    label: "Care guides",
    singular: "care guide",
    blurb: "How-to advice (wash day, storage, detangling). Shows on the storefront and helps Praxis give real care tips.",
  },
  {
    key: "journal",
    label: "Journal",
    singular: "journal post",
    blurb: "Editorial / blog stories with their own page and share image.",
  },
  {
    key: "policy",
    label: "Policies",
    singular: "policy",
    blurb: "Shipping, returns, privacy and the like. Each gets a policy page shoppers can read.",
  },
];

export const FAQ_CATEGORIES: { value: FaqCategory; label: string }[] = [
  { value: "general", label: "General" },
  { value: "shipping", label: "Shipping & delivery" },
  { value: "returns", label: "Returns & refunds" },
  { value: "care", label: "Care & maintenance" },
  { value: "payment", label: "Payment" },
  { value: "sizing", label: "Sizing & fit" },
];
