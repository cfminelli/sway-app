import type { NextConfig } from "next";

const API_URL = process.env.API_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/rooms/:path*",
        destination: `${API_URL}/rooms/:path*`,
      },
    ];
  },
};

export default nextConfig;
