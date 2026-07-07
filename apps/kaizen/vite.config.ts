import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { execSync } from "node:child_process";

// Verifiable build fingerprint, embedded as a <meta> in index.html so the live
// build can be confirmed with one curl.
const BUILD_ID = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return `t${Date.now()}`;
  }
})();

// Kaizen ops console. In dev, /api and /media are proxied to the Express
// backend (default :7000) so the app is same-origin with the API — which also
// makes the httpOnly refresh cookie work through the proxy without CORS.
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    {
      name: "inject-build-id",
      transformIndexHtml(html) {
        return html.replace(
          "</head>",
          `  <meta name="x-build" content="${BUILD_ID}" />\n  </head>`,
        );
      },
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5174,
    host: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:7000",
        changeOrigin: true,
      },
      "/media": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:7000",
        changeOrigin: true,
      },
    },
  },
});
