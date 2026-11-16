import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dungeon Crawler",
  description: "An Atari-style tomb crawl in the browser",
  manifest: "/manifest.webmanifest",
  // iPhone "Add to Home Screen" launches without Safari chrome.
  appleWebApp: {
    capable: true,
    title: "Dungeon Crawler",
    statusBarStyle: "black-translucent",
  },
  other: { "mobile-web-app-capable": "yes" },
};

// No maximumScale: pinch zoom stays available for accessibility; the game box itself opts out via touch-action.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#08080d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#08080d] text-[#f4f0f8]">
        {children}
      </body>
    </html>
  );
}
