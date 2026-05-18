/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow Next to transpile workspace packages we'll add later.
    externalDir: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('@node-rs/argon2');
    }
    return config;
  },
};

module.exports = nextConfig;
