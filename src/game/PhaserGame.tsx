"use client";

import { useEffect, useRef } from "react";
import type Phaser from "phaser";

export default function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (gameRef.current || !containerRef.current) return;

    // Dynamic import keeps Phaser out of the SSR bundle
    import("phaser").then((PhaserModule) => {
      import("./config").then(({ gameConfig }) => {
        const Phaser = PhaserModule;
        const config: Phaser.Types.Core.GameConfig = {
          ...gameConfig,
          parent: containerRef.current!,
        };
        gameRef.current = new Phaser.Game(config);
      });
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="overflow-hidden shadow-2xl shadow-black/50"
      style={{ width: "min(100vw - 24px, 960px)", height: "min(calc((100vw - 24px) * 0.6667), 640px)" }}
    />
  );
}
