// pm2 process config for the UAT server.
// Start/reload with:  pm2 startOrReload ecosystem.config.js
//
// cwd and PORT are pinned here so the app always runs from the project
// directory on port 9091 (the port the reverse proxy forwards to), regardless
// of which directory pm2 is invoked from.
module.exports = {
  apps: [
    {
      name: "uat-webinsight",
      cwd: "/home/ubuntu/uat-webinsight",
      // Run Next directly (no npm wrapper, so there is no package.json lookup
      // from the wrong directory). The port comes from env.PORT below — do NOT
      // pass `-p` here, as the arg can be mis-parsed as a project directory.
      script: "node_modules/next/dist/bin/next",
      args: "start",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: "9091",
      },
    },
    {
      // Atlas Invoice Agent background worker. Thin loop that drives the
      // bearer-protected /api/invoices/cron/* endpoints on the app above, so
      // Gmail sync, due-date reminders, recurring drafts and queued jobs run
      // without a human. Needs INVOICE_CRON_SECRET (or CRON_SECRET) and APP_URL
      // in the project's .env. Safe to omit if you drive the cron endpoints with
      // an external scheduler instead.
      name: "uat-invoice-worker",
      cwd: "/home/ubuntu/uat-webinsight",
      script: "scripts/invoice-worker.mjs",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
