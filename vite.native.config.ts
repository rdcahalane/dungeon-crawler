/**
 * Builds the offline app-store bundle (native/ -> native-dist/) that Capacitor ships inside the iOS and Android apps.
 * The website still builds with Next.js; this config only reuses the game code under src/.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { cpSync } from "node:fs";

export default defineConfig({
  root: fileURLToPath(new URL("./native", import.meta.url)),
  base: "./",
  publicDir: false,
  plugins: [
    react(),
    // The narrator's recorded clips (public/narration) ship inside the app; nothing else from public/ is needed.
    {
      name: "copy-narration",
      closeBundle() {
        cpSync(fileURLToPath(new URL("./public/narration", import.meta.url)), fileURLToPath(new URL("./native-dist/narration", import.meta.url)), { recursive: true });
      },
    },
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: fileURLToPath(new URL("./native-dist", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
