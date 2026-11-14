"use client";

import dynamic from "next/dynamic";

const PhaserGame = dynamic(() => import("@/game/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div className="screen flex items-center justify-center bg-[#12101a]">
      <p className="arcade-text text-[#7d7890] animate-pulse">Loading dungeon...</p>
    </div>
  ),
});

export default function GameWrapper() {
  // `.screen` (globals.css) sizes the canvas box at 3:2 and keeps pixels crisp.
  return (
    <div className="screen">
      <PhaserGame />
    </div>
  );
}
