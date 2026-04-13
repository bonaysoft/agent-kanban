import path from "node:path";
import { defineConfig } from "vitest/config";

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
    coverage: {
      provider: "v8",
      include: ["apps/web/server/**/*.ts", "packages/shared/src/**/*.ts", "packages/cli/src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/types.ts"],
    },
    server: {
      deps: {
        inline: ["jose", "miniflare"],
      },
    },
  },
});
