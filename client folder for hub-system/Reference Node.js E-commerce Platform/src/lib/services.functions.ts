/**
 * Public read of services for storefront listing + detail pages.
 * Uses a server publishable client (no service role) — RLS allows anon to
 * SELECT only rows that are visible + published.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

export type ServiceCard = {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  thumbnail_url: string | null;
  tags: string[];
  price_ngn: number | null;
  compare_at_price_ngn: number | null;
  price_is_from: boolean;
  duration_minutes: number | null;
  location_type: "studio" | "home" | "virtual";
  is_featured: boolean;
};

export type ServiceDetail = ServiceCard & {
  long_description: string | null;
  gallery_urls: string[];
  meta_title: string | null;
  meta_description: string | null;
  buffer_minutes: number;
  required_stylist_tier: string | null;
  is_bookable: boolean;
  deposit_required: boolean;
  deposit_pct: number | null;
  deposit_amount_ngn: number | null;
  cancellation_policy: string | null;
};

function client() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

export const listServices = createServerFn({ method: "GET" })
  .handler(async (): Promise<ServiceCard[]> => {
    const { data, error } = await client()
      .from("services")
      .select("id, slug, name, short_description, thumbnail_url, tags, price_ngn, compare_at_price_ngn, price_is_from, duration_minutes, location_type, is_featured")
      .order("is_featured", { ascending: false })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      ...r,
      price_ngn: r.price_ngn == null ? null : Number(r.price_ngn),
      compare_at_price_ngn: r.compare_at_price_ngn == null ? null : Number(r.compare_at_price_ngn),
    })) as ServiceCard[];
  });

export const getService = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ slug: z.string().min(1) }).parse(input))
  .handler(async ({ data }): Promise<ServiceDetail | null> => {
    const { data: row, error } = await client()
      .from("services")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      short_description: row.short_description,
      long_description: row.long_description,
      thumbnail_url: row.thumbnail_url,
      gallery_urls: row.gallery_urls ?? [],
      tags: row.tags ?? [],
      meta_title: row.meta_title,
      meta_description: row.meta_description,
      price_ngn: row.price_ngn == null ? null : Number(row.price_ngn),
      compare_at_price_ngn: row.compare_at_price_ngn == null ? null : Number(row.compare_at_price_ngn),
      price_is_from: row.price_is_from,
      duration_minutes: row.duration_minutes,
      buffer_minutes: row.buffer_minutes,
      required_stylist_tier: row.required_stylist_tier,
      is_bookable: row.is_bookable,
      is_featured: row.is_featured,
      deposit_required: row.deposit_required,
      deposit_pct: row.deposit_pct == null ? null : Number(row.deposit_pct),
      deposit_amount_ngn: row.deposit_amount_ngn == null ? null : Number(row.deposit_amount_ngn),
      location_type: row.location_type,
      cancellation_policy: row.cancellation_policy,
    };
  });
