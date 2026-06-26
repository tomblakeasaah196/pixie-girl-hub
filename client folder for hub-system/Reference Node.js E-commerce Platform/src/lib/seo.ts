/**
 * Small, dependency-free helpers for building head metadata + JSON-LD.
 * All URLs are RELATIVE — we don't have a production domain yet, and
 * crawlers will resolve them against the request host.
 */

export type MetaTag =
  | { title: string }
  | { charSet: string }
  | { name: string; content: string }
  | { property: string; content: string };

/** Standard og + twitter pairs for a page. */
export function ogMeta(opts: {
  title: string;
  description: string;
  url: string;
  image?: string;
  type?: "website" | "article" | "product";
}): MetaTag[] {
  const tags: MetaTag[] = [
    { property: "og:title", content: opts.title },
    { property: "og:description", content: opts.description },
    { property: "og:url", content: opts.url },
    { property: "og:type", content: opts.type ?? "website" },
    { property: "og:site_name", content: "Faitlyn Hair" },
    { property: "og:locale", content: "en_US" },
    { name: "twitter:card", content: opts.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: opts.title },
    { name: "twitter:description", content: opts.description },
  ];
  if (opts.image) {
    tags.push({ property: "og:image", content: opts.image });
    tags.push({ property: "og:image:alt", content: opts.title });
    tags.push({ name: "twitter:image", content: opts.image });
  }
  return tags;
}

/** A JSON-LD <script> head entry. */
export function jsonLd(data: unknown) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(data),
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

export function productLd(p: {
  name: string;
  description: string;
  image: string | string[];
  sku?: string;
  url: string;
  priceUsd: number;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description,
    image: Array.isArray(p.image) ? p.image : [p.image],
    sku: p.sku ?? p.url,
    brand: { "@type": "Brand", name: "Faitlyn Hair" },
    offers: {
      "@type": "Offer",
      url: p.url,
      priceCurrency: "USD",
      price: p.priceUsd.toFixed(2),
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
}

export function faqLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

export function itemListLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      url: it.url,
    })),
  };
}

export function collectionPageLd(opts: {
  name: string;
  description: string;
  url: string;
  items: { name: string; url: string }[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    hasPart: opts.items.map((it) => ({ "@type": "Product", name: it.name, url: it.url })),
  };
}

export function serviceLd(s: {
  name: string;
  description: string;
  url: string;
  image?: string;
  priceNgn?: number | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: s.name,
    description: s.description,
    url: s.url,
    image: s.image,
    provider: { "@type": "Organization", name: "Faitlyn Hair" },
    areaServed: "Worldwide",
    ...(s.priceNgn != null && {
      offers: {
        "@type": "Offer",
        priceCurrency: "NGN",
        price: s.priceNgn.toFixed(2),
      },
    }),
  };
}

export function clamp(s: string | null | undefined, n: number, fallback = ""): string {
  const v = (s ?? "").trim() || fallback;
  if (v.length <= n) return v;
  return v.slice(0, n - 1).trimEnd() + "…";
}
