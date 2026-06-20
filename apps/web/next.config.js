/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a minimal standalone server bundle for Docker/production.
  output: 'standalone',

  // Proxy /api/* to the backend. In production (Docker compose) the API is
  // reachable at the service name 'api'; in local dev it's localhost:3001.
  async rewrites() {
    const apiBase = process.env.API_PROXY_TARGET || 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
