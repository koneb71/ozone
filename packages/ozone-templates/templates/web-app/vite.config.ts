import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    // Bind mounts on macOS and Windows do not always deliver file events.
    watch: process.env.OZONE_WATCH_POLL === "1" ? { usePolling: true, interval: 300 } : undefined,
  },
  plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
});
