import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// Force dependency re-optimization v2

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // UI primitives
          "vendor-ui": ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-tabs", "@radix-ui/react-tooltip", "@radix-ui/react-select", "@radix-ui/react-popover", "class-variance-authority", "clsx", "tailwind-merge"],
          // Supabase
          "vendor-supabase": ["@supabase/supabase-js"],
          // Charts
          "vendor-charts": ["recharts"],
          // Animation
          "vendor-motion": ["framer-motion"],
          // Heavy PDF/export libs
          "vendor-export": ["jspdf", "html2canvas"],
          // Query
          "vendor-query": ["@tanstack/react-query"],
        },
      },
    },
  },
}));
