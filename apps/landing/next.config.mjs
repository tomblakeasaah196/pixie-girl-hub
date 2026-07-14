import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow remote images served from the brand storefront, the Hub media
  // CDN, and Instagram (for embed previews).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.pixiegirlglobal.com" },
      { protocol: "https", hostname: "pixiegirlglobal.com" },
      { protocol: "https", hostname: "**.thefaitlynbrand.com" },
      { protocol: "https", hostname: "thefaitlynbrand.com" },
      { protocol: "https", hostname: "**.faitlynhair.com" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "**.scdn.co" },
      // The Hub backend's /media static mount is at the same origin in
      // some configs; allow http for dev only.
      { protocol: "http", hostname: "localhost" },
    ],
  },
  // The landing app calls /api/public/sale/:slug on the Hub backend.
  // In production the sales subdomain proxies /api/* to the Hub via the
  // edge / load-balancer. In dev, set HUB_API_URL to the local backend.
  //
  // Order links (`/o/<slug>`) are minted on the BRAND domain so a Faitlyn
  // shopper never sees a Pixie URL — but the checkout page itself is a route
  // of the Hub admin SPA, not this storefront. We proxy the checkout HTML
  // (`/o/*`, served by the Hub's SPA fallback → index.html) and the Vite
  // assets it loads (`/assets/*`, content-hashed JS/CSS) to the Hub so the
  // page renders on the brand domain. `/api/*` (below) already covers the
  // page's public API calls + its manifest; the storefront owns none of
  // these paths, so there is no collision.
  async rewrites() {
    const target = process.env.HUB_API_URL || "http://localhost:7000";
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      { source: "/media/:path*", destination: `${target}/media/:path*` },
      { source: "/o/:path*", destination: `${target}/o/:path*` },
      { source: "/assets/:path*", destination: `${target}/assets/:path*` },
    ];
  },
  experimental: {
    typedRoutes: false,
    // Compile the shared @landing-kit source that lives outside this app's
    // root (../../packages/landing-kit) instead of erroring on it.
    externalDir: true,
  },
  // The shared kit is imported as source from outside node_modules, so its
  // bare deps (react, three, framer-motion, …) must resolve against THIS
  // app's node_modules — keeping a single React instance.
  webpack: (config) => {
    config.resolve.modules = [
      path.join(process.cwd(), "node_modules"),
      ...(config.resolve.modules ?? ["node_modules"]),
    ];
    return config;
  },
};

export default nextConfig;
