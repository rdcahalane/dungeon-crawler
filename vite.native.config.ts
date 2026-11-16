/**
 * Builds the offline app-store bundle (native/ -> native-dist/) that Capacitor ships inside the iOS and Android apps.
 * The website still builds with Next.js; this config only reuses the game code under src/.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./native", import.meta.url)),
  base: "./",
  publicDir: false,
  plugins: [react()],
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
