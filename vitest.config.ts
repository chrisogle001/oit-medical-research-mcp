import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": resolve(import.meta.dirname, "tests/cloudflare-workers-stub.ts")
    }
  },
  ssr: {
    noExternal: ["@cloudflare/workers-oauth-provider"]
  },
  test: {
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});
