import type { NextConfig } from "next";

// The web app is frontend only: the story, the voices and the API keys live in
// ../server.ts, which the browser reaches over NEXT_PUBLIC_STORY_SERVER.
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
