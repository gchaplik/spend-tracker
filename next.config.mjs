/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep better-sqlite3 on the server only — it's a native Node module
  serverExternalPackages: ['better-sqlite3'],

  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
  },
};

export default nextConfig;
