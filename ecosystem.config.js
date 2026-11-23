// pm2 process config for the UAT server.
// Start/reload with:  pm2 startOrReload ecosystem.config.js
//
// Single app: the Next.js server. The Atlas Invoice Agent background worker now
// runs IN-PROCESS inside this same server (started from src/instrumentation.ts),
// so there is no separate pm2 app. Disable it with INVOICE_WORKER_DISABLED=1.
// scripts/invoice-worker.mjs is kept for manual/fallback runs
// (`npm run invoice:worker`) but is no longer supervised by pm2.
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
      // Fork mode (a single process), NOT cluster. pm2 switches to cluster
      // whenever `instances` is set, so set exec_mode explicitly instead.
      // The in-process invoice worker REQUIRES a single instance.
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: "9091",
      },
    },
  ],
};
