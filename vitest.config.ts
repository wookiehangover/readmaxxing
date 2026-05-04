import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["fake-indexeddb/auto"],
    include: ["app/**/*.test.{ts,tsx}"],
  },
  resolve: {
    tsconfigPaths: true,
  },
});
