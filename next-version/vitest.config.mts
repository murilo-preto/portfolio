import { defineConfig } from "vitest/config";
import path from "node:path";

// The subjects here are API route handlers and the server-side helpers they
// use. Those are Node modules, not components — no DOM, so no jsdom.
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Mirrors the "@/*" path in tsconfig.json. Without it the routes' own
      // imports (@/lib/constants, @/lib/flask-client) fail to resolve and every
      // test errors on import rather than on anything it meant to assert.
      "@": path.resolve(__dirname, "."),
    },
  },
});
