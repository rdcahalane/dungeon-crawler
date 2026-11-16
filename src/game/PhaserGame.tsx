"use client";

import { useEffect, useRef } from "react";
import type Phaser from "phaser";

export default function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (gameRef.current || !containerRef.current) return;
    // React strict mode mounts, unmounts and mounts again; the imports below
    // resolve after that, so without this flag both mounts create a game.
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let detachScaleListeners: (() => void) | undefined;
    // iOS Safari pinch gestures ignore touch-action; stop them on the game box only.
    const box = containerRef.current;
    const stopGesture = (e: Event) => e.preventDefault();
    box.addEventListener("gesturestart", stopGesture);
    box.addEventListener("gesturechange", stopGesture);

    // Dynamic import keeps Phaser out of the SSR bundle
    import("phaser").then((PhaserModule) => {
      import("./config").then(({ gameConfig }) => {
        if (cancelled || gameRef.current || !containerRef.current) return;
        const Phaser = PhaserModule;
        const config: Phaser.Types.Core.GameConfig = {
          ...gameConfig,
          parent: containerRef.current!,
        };
        const game = new Phaser.Game(config);
        gameRef.current = game;
        // Keys must work from the first frame, before anyone clicks: make the canvas focusable and focus it.
        const focusCanvas = () => {
          const canvas = game.canvas;
          if (!canvas) return;
          canvas.setAttribute("tabindex", "0");
          canvas.style.outline = "none";
          canvas.focus({ preventScroll: true });
          canvas.addEventListener("pointerdown", () => canvas.focus({ preventScroll: true }));
        };
        if (game.canvas) focusCanvas();
        else game.events.once(Phaser.Core.Events.READY, focusCanvas);
        // FIT reads the parent's size on window resize; also refresh when the box itself changes
        // (orientation change, dvh shifts, fullscreen) so the canvas never stays at a stale size.
        const refresh = () => game.scale?.refresh();
        const settle = () => {
          refresh();
          window.setTimeout(refresh, 250); // iOS reports the new size a beat after orientationchange
        };
        window.addEventListener("resize", refresh);
        window.addEventListener("orientationchange", settle);
        document.addEventListener("fullscreenchange", settle);
        document.addEventListener("webkitfullscreenchange", settle);
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(refresh);
          resizeObserver.observe(containerRef.current!);
        }
        detachScaleListeners = () => {
          window.removeEventListener("resize", refresh);
          window.removeEventListener("orientationchange", settle);
          document.removeEventListener("fullscreenchange", settle);
          document.removeEventListener("webkitfullscreenchange", settle);
          resizeObserver?.disconnect();
        };
        if (process.env.NODE_ENV !== "production") {
          (window as unknown as { __game?: Phaser.Game }).__game = gameRef.current;
        }
      });
    });

    return () => {
      cancelled = true;
      box.removeEventListener("gesturestart", stopGesture);
      box.removeEventListener("gesturechange", stopGesture);
      detachScaleListeners?.();
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="game-box overflow-hidden"
    />
  );
}
