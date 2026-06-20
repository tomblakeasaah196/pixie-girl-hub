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
  async rewrites() {
    const target = process.env.HUB_API_URL || "http://localhost:7000";
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      { source: "/media/:path*", destination: `${target}/media/:path*` },
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
