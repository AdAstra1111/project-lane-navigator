import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Vite plugin that strips explicit .ts extensions from imports so that
 * Deno-style imports (used in supabase/functions/_shared/) resolve under
 * Node/Vitest without changing source files.
 */
function stripTsExtensions(): Plugin {
  return {
    name: "strip-ts-extensions",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.endsWith(".ts") && importer && !source.includes("node_modules")) {
        // Let Vite re-resolve without the .ts suffix
        return this.resolve(source.replace(/\.ts$/, ""), importer, { skipSelf: true });
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [stripTsExtensions(), react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
