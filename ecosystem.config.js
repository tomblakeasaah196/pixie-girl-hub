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
  ],
};
