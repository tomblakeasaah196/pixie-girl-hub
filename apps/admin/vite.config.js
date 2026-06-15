var _a;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
// Admin PWA dev/build config. The API base is read from VITE_API_URL at
// runtime; if it's omitted (or set to a relative path), the dev proxy
// below forwards /api/* to the Express backend on port 4000 so we don't
// need CORS during local development.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
        port: 5173,
        host: true,
        proxy: {
            "/api": {
                target: (_a = process.env.VITE_API_PROXY_TARGET) !== null && _a !== void 0 ? _a : "http://localhost:4000",
                changeOrigin: true,
            },
        },
    },
});
