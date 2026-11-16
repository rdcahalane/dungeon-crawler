"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type FsDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function supported(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}
function active(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Corner toggle for the Fullscreen API (webkit fallback). Renders nothing where the API is missing (iPhone Safari). */
export default function FullscreenButton() {
  // false on the server and during hydration, then the real answer: no mismatch.
  const ok = useSyncExternalStore(() => () => {}, supported, () => false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(active());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  if (!ok) return null;

  const toggle = () => {
    const d = document as FsDoc;
    const el = document.documentElement as FsEl;
    try {
      if (active()) {
        void (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
      } else {
        void (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.());
      }
    } catch {
      /* refused by the browser; nothing to do */
    }
    // Hand focus back to the canvas so keys keep working on desktop.
    document.querySelector<HTMLCanvasElement>(".screen canvas")?.focus({ preventScroll: true });
  };

  return (
    <button
      type="button"
      className="fs-btn arcade-btn"
      onClick={toggle}
      aria-label={on ? "Exit fullscreen" : "Enter fullscreen"}
      title={on ? "Exit fullscreen" : "Fullscreen"}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {on ? (
          <path d="M5 1v4H1M9 1v4h4M5 13V9H1M9 13V9h4" />
        ) : (
          <path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9" />
        )}
      </svg>
    </button>
  );
}
