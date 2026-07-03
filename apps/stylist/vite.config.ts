import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Stylist Partner Programme portal — same public plugin set as
 * apps/storefront (see its vite.config.ts for the rationale, incl. why
 * nitroV2Plugin is required for a runnable production server).
 *
 * Dev proxies /api and /media to the Hub backend; in production the portal
 * talks to the Hub over HUB_API_URL from the SSR server and same-origin
 * /api via the edge for the browser.
 */
export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    nitroV2Plugin({ preset: "node-server" }),
    viteReact(),
    tailwindcss(),
  ],
  server: {
    port: 3002,
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
