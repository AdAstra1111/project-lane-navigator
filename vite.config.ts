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
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Only split node_modules — never split app src files (avoids circular deps)
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/react-router-dom/")) return "vendor-react";
          if (id.includes("node_modules/@supabase/")) return "vendor-supabase";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-") || id.includes("node_modules/victory-")) return "vendor-charts";
          if (id.includes("node_modules/framer-motion")) return "vendor-motion";
          if (id.includes("node_modules/@tanstack/")) return "vendor-query";
          if (id.includes("node_modules/jspdf") || id.includes("node_modules/html2canvas")) return "vendor-export";
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";
          if (id.includes("node_modules/@radix-ui/")) return "vendor-radix";
          if (id.includes("node_modules/zod") || id.includes("node_modules/react-hook-form")) return "vendor-forms";
          if (id.includes("node_modules/date-fns") || id.includes("node_modules/dayjs")) return "vendor-dates";
          // All app src code splits naturally via dynamic import() in App.tsx
        },
      },
    },
  },
}));
