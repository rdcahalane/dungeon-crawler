import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Phaser (and the game modules that import it) from being bundled
  // on the server — the game runs client-side only.
  serverExternalPackages: ["phaser"],
};

export default nextConfig;
