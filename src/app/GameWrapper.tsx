"use client";

import dynamic from "next/dynamic";

const PhaserGame = dynamic(() => import("@/game/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div
      className="rounded-lg bg-[#0a0a0f] border border-gray-800 flex items-center justify-center"
      style={{ width: 960, height: 640 }}
    >
      <p className="text-gray-600 font-mono text-sm animate-pulse">Loading dungeon…</p>
    </div>
  ),
});

export default function GameWrapper() {
  return <PhaserGame />;
}
