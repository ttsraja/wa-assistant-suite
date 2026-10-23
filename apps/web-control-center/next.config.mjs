/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for Electron / engine-hosted UI (no Node server required for pages)
  output: 'export',
  images: { unoptimized: true },
  // Stable paths for express.static + file links
  trailingSlash: true,
};

export default nextConfig;
