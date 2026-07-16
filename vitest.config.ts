import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // This repo is often tested on high-core shared hosts. Unbounded fork
    // startup can exhaust memory and turn a ten-second suite into worker
    // timeouts; four workers retains parallelism without resource thrash.
    maxWorkers: 4,
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
