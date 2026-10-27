import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Konfigurasi keamanan untuk akses dev dari IP jaringan lokal */
  allowedDevOrigins: ["192.168.1.9", "localhost"],

  /* Konfigurasi bawaan Anda sebelumnya */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;