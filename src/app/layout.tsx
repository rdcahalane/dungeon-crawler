import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dungeon Crawler",
  description: "An Atari-style tomb crawl in the browser",
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
