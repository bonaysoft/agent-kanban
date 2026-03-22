import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@agent-kanban/shared": path.resolve(__dirname, "packages/shared/src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    server: {
      deps: {
        inline: ["jose", "miniflare"],
      },
    },
  },
});
