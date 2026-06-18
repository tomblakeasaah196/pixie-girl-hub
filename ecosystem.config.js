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
  ],
};
