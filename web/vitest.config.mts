import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// tsconfig の paths（@/*）を vitest 側でも解決できるようにする。
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "");

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
