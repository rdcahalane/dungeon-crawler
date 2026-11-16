import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dungeon Crawler",
    short_name: "Dungeon Crawler",
    description: "An Atari-style tomb crawl in the browser",
    start_url: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#08080d",
    theme_color: "#08080d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
