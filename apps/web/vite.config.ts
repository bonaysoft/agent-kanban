import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.VITE_DEV_PORT) || 5173;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(__dirname, "dist"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8788",
      },
      "/.well-known": {
        target: "http://localhost:8788",
      },
      "/agents": {
        target: "http://localhost:8788",
        bypass(req) {
          // Only proxy .gpg requests, let SPA handle the rest
          if (!req.url?.endsWith(".gpg")) return req.url;
        },
      },
    },
  },
});
