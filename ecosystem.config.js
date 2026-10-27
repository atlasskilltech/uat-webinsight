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
      // from the wrong directory).
      script: "node_modules/next/dist/bin/next",
      args: "start -p 9091",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: "9091",
      },
    },
  ],
};
