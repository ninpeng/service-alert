/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/adapter-better-sqlite3", "better-sqlite3"],
  typedRoutes: true
};

export default nextConfig;
