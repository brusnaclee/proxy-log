// PM2 Configuration for Proxy API
module.exports = {
  apps: [
    {
      name: 'proxy-api',
      script: './packages/proxy/dist/index.js',
      cwd: '/root/proxy-log',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        DATABASE_URL: './packages/proxy/data/gateway.db',
        INTERNAL_API_SECRET: 'change-me-in-production',
        PROXY_INTERNAL_BASE_URL: 'http://localhost:3000',
        SESSION_SECRET: 'change-me-to-a-random-secret-string',
        UPSTREAM_API_KEY: 'sk-16857f01c151b31f-toufiu-bf0391aa',
        UPSTREAM_ENDPOINT: 'https://api3.tokito.xyz/v1',
      },
      error_file: './logs/proxy-error.log',
      out_file: './logs/proxy-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
