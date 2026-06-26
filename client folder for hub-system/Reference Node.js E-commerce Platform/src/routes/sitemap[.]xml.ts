import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTS, CATEGORIES } from "@/lib/products";
import { BUNDLES } from "@/lib/bundles";
import { SHADES } from "@/lib/site-content";
import type { Database } from "@/integrations/supabase/types";

// TODO: replace with your project URL once a custom domain is set.
const BASE_URL = "";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
  lastmod?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        // Pull published services from the DB so the sitemap stays accurate.
        let services: { slug: string; updated_at: string | null }[] = [];
        try {
          const supabase = createClient<Database>(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
          );
          const { data } = await supabase
            .from("services")
            .select("slug, updated_at")
            .eq("is_visible_storefront", true)
            .not("published_at", "is", null);
          services = data ?? [];
        } catch {
          // best-effort — leave services empty if DB unreachable
        }

        const entries: SitemapEntry[] = [
          { path: "/",            changefreq: "weekly",  priority: "1.0" },
          { path: "/shop",        changefreq: "daily",   priority: "0.9" },
          { path: "/bundles",     changefreq: "weekly",  priority: "0.8" },
          { path: "/services",    changefreq: "weekly",  priority: "0.8" },
          { path: "/about",       changefreq: "monthly", priority: "0.6" },
          { path: "/contact",     changefreq: "monthly", priority: "0.5" },
          { path: "/journal",     changefreq: "weekly",  priority: "0.6" },
          { path: "/policies/cancellation", changefreq: "yearly", priority: "0.3" },
          ...CATEGORIES.map((c) => ({ path: `/shop/${c.slug}`, changefreq: "weekly" as const, priority: "0.8" })),
          ...SHADES.map((s) => ({ path: `/shop?shade=${s.slug}`, changefreq: "weekly" as const, priority: "0.7" })),
          ...PRODUCTS.map((p) => ({ path: `/product/${p.slug}`, changefreq: "weekly" as const, priority: "0.85" })),
          ...BUNDLES.map((b) => ({ path: `/bundles/${b.slug}`, changefreq: "monthly" as const, priority: "0.7" })),
          ...services.map((s) => ({
            path: `/services/${s.slug}`,
            changefreq: "monthly" as const,
            priority: "0.7",
            lastmod: s.updated_at ?? undefined,
          })),
        ];

        const urls = entries.map((e) =>
          [
            "  <url>",
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            "  </url>",
          ].filter(Boolean).join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
