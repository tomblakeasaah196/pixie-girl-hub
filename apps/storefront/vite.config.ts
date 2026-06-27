import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Standard (de-Lovable) TanStack Start config.
 *
 * The Aura reference (`client folder for hub-system/Reference Node.js E-commerce
 * Platform`) builds via the proprietary `@lovable.dev/vite-tanstack-config`
 * wrapper. We do NOT depend on it here — this is the documented public plugin
 * set. If a TanStack Start version mismatch makes this fail to build, see
 * PORTING.md → "Build fallback" for the wrapper escape hatch.
 *
 * SSR proxies /api and /media to the Hub backend in dev, mirroring apps/admin's
 * vite proxy. In production the storefront talks to the Hub over HUB_API_URL.
 */
export default defineConfig({
  plugins: [tsConfigPaths(), tanstackStart(), viteReact(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:7000",
        changeOrigin: true,
        secure: false,
      },
      "/media": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:7000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
