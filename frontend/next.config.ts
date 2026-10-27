import type { NextConfig } from "next";

// Desktop builds are self-contained by default: /api and /media are handled by
// Next.js route handlers and persisted under Electron's userData directory.
// Set CB_BACKEND_ORIGIN only when you intentionally want to use Django.
const backendOrigin = (process.env.CB_BACKEND_ORIGIN || process.env.BACKEND_ORIGIN || "").trim().replace(/\/$/, "");
const aiOrigin = (process.env.CB_AI_ORIGIN || process.env.AI_ORIGIN || "").trim().replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Development only: allow LAN and public-IP clients to use the dev server's live-update connection.
  allowedDevOrigins: ["192.168.1.58", "192.168.1.114", "122.180.242.125"],
  async rewrites() {
    const beforeFiles: { source: string; destination: string }[] = [];
    if (backendOrigin) {
      beforeFiles.push(
        { source: "/api/:path*", destination: `${backendOrigin}/api/:path*` },
        { source: "/backend-api/:path*", destination: `${backendOrigin}/api/:path*` },
        { source: "/media/:path*", destination: `${backendOrigin}/media/:path*` },
      );
    }
    if (aiOrigin) beforeFiles.push({ source: "/ai-api/:path*", destination: `${aiOrigin}/:path*` });
    return { beforeFiles, afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
