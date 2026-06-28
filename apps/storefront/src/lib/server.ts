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

function reqBrandCookie(): { brand: BrandKey; cookie?: string } {
  try {
    const req = getRequest();
    return {
      brand: brandFromHost(req?.headers?.get("host")),
      cookie: req?.headers?.get("cookie") ?? undefined,
    };
  } catch {
    return { brand: brandFromHost(null) };
  }
}

interface SiteConfig {
  brand: BrandKey;
  theme?: { tokens?: Record<string, string> };
  navigation?: unknown;
  popups?: unknown[];
}

export const ssrSite = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteConfig> => {
    const { brand, cookie } = reqBrandCookie();
    try {
      const site = await api.get<SiteConfig>("/api/public/storefront/site", {
        brand,
        cookie,
      });
      return { ...site, brand };
    } catch {
      return { brand };
    }
  },
);

export const ssrProducts = createServerFn({ method: "GET" })
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

export const ssrProduct = createServerFn({ method: "GET" })
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
