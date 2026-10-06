/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Server actions default to a 1MB body limit, which silently
      // drops larger file uploads (e.g. a 2-3MB BEO PDF). Bump to 15MB
      // so a 10MB BEO comfortably fits with FormData overhead.
      bodySizeLimit: "15mb",
    },
  },
};
export default nextConfig;
