/**
 * Entry point for the app-store builds (Capacitor, iOS and Android). The whole game is bundled into the app and
 * plays offline. There is no server and no sign-in: the save store's API calls fail and it keeps saves on the
 * device, the same as a guest in the browser. The web build (Next.js, src/app) is untouched by this file.
 * Build with `npm run native:build`; Capacitor copies `native-dist` into the iOS and Android projects.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PhaserGame from "@/game/PhaserGame";
import "@/app/globals.css";
import "./native.css";

function App() {
  return (
    <main className="native-stage">
      <div className="screen">
        <PhaserGame />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
