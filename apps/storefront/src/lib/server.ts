import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { api } from "./api";
import { brandFromHost, type BrandKey } from "./brand";
import {
  getProducts,
  getProduct,
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
} {
  try {
    const req = getRequest();
    let preview: string | undefined;
    try {
      preview = new URL(req.url).searchParams.get("preview") || undefined;
    } catch {
      /* non-absolute url */
    }
    return {
      brand: brandFromHost(req?.headers?.get("host")),
      cookie: req?.headers?.get("cookie") ?? undefined,
      preview,
    };
  } catch {
    return { brand: brandFromHost(null) };
  }
}

interface StudioPage {
  page_key?: string;
  template_key?: string;
  url_path?: string;
  slots?: { sections?: unknown[] } & Record<string, unknown>;
}

interface SiteConfig {
  brand: BrandKey;
  theme?: { tokens?: Record<string, string> };
  navigation?: unknown;
  pages?: StudioPage[];
  popups?: unknown[];
  preview?: boolean;
}

export const ssrSite = createServerFn({ method: "GET", strict: false }).handler(
  async (): Promise<SiteConfig> => {
    const { brand, cookie, preview } = reqBrandCookie();
    const qs = preview ? `?preview=${encodeURIComponent(preview)}` : "";
    try {
      const site = await api.get<SiteConfig>(
        `/api/public/storefront/site${qs}`,
        { brand, cookie },
      );
      return { ...site, brand };
    } catch {
      return { brand };
    }
  },
);

export const ssrProducts = createServerFn({ method: "GET", strict: false })
  .validator((d: { pageSize?: number }) => ({ pageSize: d?.pageSize ?? 24 }))
  .handler(
    async ({
      data,
    }): Promise<{ brand: BrandKey; products: ProductCard[] }> => {
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

// Home: the published 'home' page (template_key + slots, if Studio published one)
// plus a product preview for the default layout / product_grid sections.
export const ssrHome = createServerFn({ method: "GET", strict: false }).handler(
  async (): Promise<{
    brand: BrandKey;
    page: StudioPage | null;
    products: ProductCard[];
  }> => {
    const { brand, cookie } = reqBrandCookie();
    let page: StudioPage | null = null;
    let products: ProductCard[] = [];
    try {
      const site = await api.get<SiteConfig>(
        "/api/public/storefront/site?path=/",
        { brand, cookie },
      );
      page =
        (site.pages || []).find(
          (p) => p.page_key === "home" || p.url_path === "/",
        ) || null;
    } catch {
      /* /site not live yet */
    }
    try {
      const r = await getProducts("?page=1&page_size=8", { brand, cookie });
      products = (unwrap(r) as ProductCard[]) ?? [];
    } catch {
      /* catalogue offline */
    }
    return { brand, page, products };
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
