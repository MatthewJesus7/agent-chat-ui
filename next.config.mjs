/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,  // 🚀 Ignora TS/ESLint erros
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: true,
  },
};

export default nextConfig;
