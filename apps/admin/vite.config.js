var _a, _b;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
// Admin PWA dev/build config. The API base is read from VITE_API_URL at
// runtime; if it's omitted (or set to a relative path), the dev proxy
// below forwards /api/* to the Express backend on port 7000 (the default
// PORT in the backend .env.example) so we don't need CORS during local
// development. Override the target with VITE_API_PROXY_TARGET if the
// backend runs elsewhere.
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
                target: (_a = process.env.VITE_API_PROXY_TARGET) !== null && _a !== void 0 ? _a : "http://localhost:7000",
                changeOrigin: true,
            },
            "/media": {
                target: (_b = process.env.VITE_API_PROXY_TARGET) !== null && _b !== void 0 ? _b : "http://localhost:7000",
                changeOrigin: true,
            },
        },
    },
});
