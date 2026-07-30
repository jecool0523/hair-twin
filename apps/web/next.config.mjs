import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // Web Workers created via `new Worker(new URL(...), { type: "module" })`
  // are bundled by Next/Turbopack automatically. No extra config required.
  experimental: {
    // Keep server-only secrets out of the client bundle by default.
  },
};

export default nextConfig;
