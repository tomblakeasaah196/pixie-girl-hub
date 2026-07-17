import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { api } from "./api";
import { brandFromHost, type BrandKey } from "./brand";
import {
  getProducts,
  getProduct,
  getShades,
  getBundles,
  unwrap,
  type ProductCard,
  type ProductDetail,
} from "./storefront";

/**
 * Server functions: the ONLY place that touches the server-only request
 * (getWebRequest). Route loaders call these so no route file imports
 * "@tanstack/react-start/server" directly (which would trip the client
 * import-protection guard). Each resolves brand + cookie from the live request
 * and fetches brand-correct, authenticated data from the Hub.
 */

function reqBrandCookie(): {
  brand: BrandKey;
  cookie?: string;
  preview?: string;
  /** Absolute origin (e.g. https://faitlynhair.com) for absolute OG URLs. */
  origin?: string;
  /** Current request path, to match a Studio page's per-page SEO overrides. */
  path?: string;
} {
  try {
    const req = getRequest();
    let preview: string | undefined;
    let path = "/";
    try {
      const u = new URL(req.url);
      preview = u.searchParams.get("preview") || undefined;
      path = u.pathname || "/";
    } catch {
      /* non-absolute url */
    }
    const host = req?.headers?.get("host") || "";
    // Behind nginx/Cloudflare the edge terminates TLS; trust the forwarded
    // scheme, defaulting to https (the storefront is https in production).
    const proto = req?.headers?.get("x-forwarded-proto") || "https";
    return {
      brand: brandFromHost(host),
      cookie: req?.headers?.get("cookie") ?? undefined,
      preview,
      origin: host ? `${proto}://${host}` : undefined,
      path,
    };
  } catch {
    return { brand: brandFromHost(null) };
  }
}

/** Per-page SEO overrides resolved from the published Studio pages for the
 *  current path — brand-level defaults (from theme tokens) are applied in the
 *  root shell so a page that leaves these blank still gets a rich share card. */
interface SiteSeo {
  origin: string;
  path: string;
  pageTitle: string;
  pageDescription: string;
  pageImage: string;
}

function resolveSeo(
  site: SiteConfig,
  origin: string,
  path: string,
): SiteSeo {
  const page =
    (site.pages || []).find(
      (p) => p.url_path === path || (path === "/" && p.page_key === "home"),
    ) || null;
  return {
    origin,
    path,
    pageTitle: page?.meta_title || "",
    pageDescription: page?.meta_description || "",
    pageImage: page?.og_image_url || "",
  };
}

interface StudioPage {
  page_key?: string;
  template_key?: string;
  url_path?: string;
  meta_title?: string;
  meta_description?: string;
  og_image_url?: string;
  slots?: { sections?: unknown[] } & Record<string, unknown>;
}

interface SiteConfig {
  brand: BrandKey;
  theme?: { tokens?: Record<string, string> };
  navigation?: unknown;
  pages?: StudioPage[];
  popups?: unknown[];
  preview?: boolean;
  seo?: SiteSeo;
}

export const ssrSite = createServerFn({ method: "GET", strict: false }).handler(
  async (): Promise<SiteConfig> => {
    const { brand, cookie, preview, origin, path } = reqBrandCookie();
    const o = origin || "";
    const p = path || "/";
    const qs = preview ? `?preview=${encodeURIComponent(preview)}` : "";
    try {
      const site = await api.get<SiteConfig>(
        `/api/public/storefront/site${qs}`,
        { brand, cookie },
      );
      return { ...site, brand, seo: resolveSeo(site, o, p) };
    } catch {
      return {
        brand,
        seo: { origin: o, path: p, pageTitle: "", pageDescription: "", pageImage: "" },
      };
    }
  },
);

export const ssrProducts = createServerFn({ method: "GET", strict: false })
  .validator((d: { pageSize?: number }) => ({ pageSize: d?.pageSize ?? 24 }))
  .handler(
    async ({ data }): Promise<{ brand: BrandKey; products: ProductCard[] }> => {
      const { brand, cookie } = reqBrandCookie();
      try {
        const r = await getProducts(`?page=1&page_size=${data.pageSize}`, {
          brand,
          cookie,
        });
        return { brand, products: (unwrap(r) as ProductCard[]) ?? [] };
      } catch {
        return { brand, products: [] };
      }
    },
  );

// Home: the published 'home' page slots (Studio template content) + the live
// catalogue (products/shades/bundles + their images). Each read fails soft so
// the website renders the ported maison defaults when a source is empty.
export const ssrHome = createServerFn({ method: "GET", strict: false }).handler(
  async (): Promise<{
    brand: BrandKey;
    homeSlots: Record<string, unknown> | null;
    products: ProductCard[];
    shades: unknown[];
    bundles: unknown[];
  }> => {
    const { brand, cookie } = reqBrandCookie();
    const ctx = { brand, cookie };
    let homeSlots: Record<string, unknown> | null = null;
    let products: ProductCard[] = [];
    let shades: unknown[] = [];
    let bundles: unknown[] = [];

    const [siteR, prodR, shadeR, bundleR] = await Promise.allSettled([
      api.get<SiteConfig>("/api/public/storefront/site?path=/", ctx),
      getProducts("?page=1&page_size=8", ctx),
      getShades(ctx),
      getBundles(ctx),
    ]);

    if (siteR.status === "fulfilled") {
      const page =
        (siteR.value.pages || []).find(
          (p) => p.page_key === "home" || p.url_path === "/",
        ) || null;
      homeSlots = (page?.slots as Record<string, unknown> | undefined) ?? null;
    }
    if (prodR.status === "fulfilled")
      products = (unwrap(prodR.value) as ProductCard[]) ?? [];
    if (shadeR.status === "fulfilled")
      shades = (unwrap(shadeR.value) as unknown[]) ?? [];
    if (bundleR.status === "fulfilled")
      bundles = (unwrap(bundleR.value) as unknown[]) ?? [];

    return { brand, homeSlots, products, shades, bundles };
  },
);

export const ssrProduct = createServerFn({ method: "GET", strict: false })
  .validator((d: { slug: string }) => ({ slug: d.slug }))
  .handler(async ({ data }): Promise<{ product: ProductDetail | null }> => {
    const { brand, cookie } = reqBrandCookie();
    try {
      const product = await getProduct(data.slug, { brand, cookie });
      return { product };
    } catch {
      return { product: null };
    }
  });
