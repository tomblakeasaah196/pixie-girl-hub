import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { execSync } from "node:child_process";

// A verifiable build fingerprint. Embedded as a <meta> tag in index.html so
// the live build can be confirmed with one curl (the CI post-deploy check
// asserts the served page carries the current commit). Falls back to a
// timestamp when git isn't available (e.g. a tarball build).
const BUILD_ID = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return `t${Date.now()}`;
  }
})();

// Admin PWA dev/build config. The API base is read from VITE_API_URL at
// runtime; if it's omitted (or set to a relative path), the dev proxy
// below forwards /api/* to the Express backend on port 7000 (the default
// PORT in the backend .env.example) so we don't need CORS during local
// development. Override the target with VITE_API_PROXY_TARGET if the
// backend runs elsewhere.
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    {
      // Stamp the build id into the served HTML so it's curl-verifiable.
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
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
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
