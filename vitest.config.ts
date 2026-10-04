import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      "monaco-editor": fileURLToPath(
        new URL("./tests/monaco-stub.ts", import.meta.url),
      ),
    },
  },
});
