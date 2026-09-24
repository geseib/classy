import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The page is fully static: results are read from data/ at build time.
  poweredByHeader: false,
};

export default nextConfig;
