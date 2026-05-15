/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow Next to transpile workspace packages we'll add later.
    externalDir: true,
  },
};

module.exports = nextConfig;
