import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  // Enables JSX for component tests (they opt into jsdom per-file via
  // `// @vitest-environment jsdom`). Domain/service tests stay on node.
  plugins: [react()],
  resolve: {
    alias: {
      "@": src,
      // `server-only` throws when imported outside an RSC bundle. In tests we
      // exercise the server modules directly, so alias it to a harmless stub.
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: true,
  },
});
