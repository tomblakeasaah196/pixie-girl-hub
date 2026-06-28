module.exports = {
  apps: [
    {
      name: "pixie-girl-hub",
      script: "src/server.js",
      cwd: "/var/www/pixie-girl-hub",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: "/var/www/pixie-girl-hub/logs/error.log",
      out_file: "/var/www/pixie-girl-hub/logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "pixie-girl-landing",
      script: "node_modules/.bin/next",
      args: "start --port 3000",
      cwd: "/var/www/pixie-girl-hub/apps/landing",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: "/var/www/pixie-girl-hub/logs/landing-error.log",
      out_file: "/var/www/pixie-girl-hub/logs/landing-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
    {
      // Storefront Website (TanStack Start / Nitro SSR). ONE instance serves
      // BOTH brands — brand is resolved per request from the Host header
      // (apps/storefront/src/lib/brand.ts). See docs/STOREFRONT_DEPLOYMENT.md.
      // NOT the Sales Campaign Landing above.
      name: "pixie-girl-storefront",
      script: ".output/server/index.mjs",
      cwd: "/var/www/pixie-girl-hub/apps/storefront",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: "/var/www/pixie-girl-hub/logs/storefront-error.log",
      out_file: "/var/www/pixie-girl-hub/logs/storefront-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
        PORT: 3002,
        HUB_API_URL: "http://127.0.0.1:7000",
        // Fallback brand for unknown hosts only; real traffic resolves by Host.
        DEFAULT_BRAND: "pixiegirl",
      },
    },
  ],
};
