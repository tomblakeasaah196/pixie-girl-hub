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
    alias: {
      // Shared landing renderer + config, consumed as source. Listed before
      // "@" so the longer, more specific prefix wins.
      "@landing-kit": fileURLToPath(
        new URL("../../packages/landing-kit", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    // The @landing-kit source lives outside this app's root; force its bare
    // deps to resolve to this app's single copy so the bundle never ends up
    // with two Reacts / two three.js instances (which would break hooks/WebGL).
    dedupe: [
      "react",
      "react-dom",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "framer-motion",
      "lucide-react",
    ],
  },
  server: {
    port: 5173,
    host: true,
    // Allow the dev server to read the shared package that lives outside this
    // app's root (../../packages/landing-kit).
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
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
