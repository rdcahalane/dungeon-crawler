"use client";

import dynamic from "next/dynamic";

const PhaserGame = dynamic(() => import("@/game/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div
      className="bg-[#0a0a0f] border border-gray-800 flex items-center justify-center"
      style={{ width: "min(100vw - 24px, 960px)", height: "min(calc((100vw - 24px) * 0.6667), 640px)" }}
    >
      <p className="text-gray-600 font-mono text-sm animate-pulse">Loading dungeon…</p>
    </div>
  ),
});

export default function GameWrapper() {
  return <PhaserGame />;
}
