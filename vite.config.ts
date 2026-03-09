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
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor splits — deterministic, library-level
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

          // Core app modules — must stay in main bundle, never lazy-chunked
          if (id.includes("src/integrations/supabase/client")) return undefined;
          if (id.includes("src/hooks/useAuth")) return undefined;
          if (id.includes("src/hooks/useTheme")) return undefined;
          if (id.includes("src/hooks/useUIMode")) return undefined;

          // App-level route splits — break up the two oversized chunks
          if (id.includes("src/pages/ProjectDevelopmentEngine") || id.includes("src/components/devengine/")) return "app-devengine";
          if (id.includes("src/pages/ProjectDetail") || id.includes("src/components/project/")) return "app-project";
          if (id.includes("src/pages/Dashboard") || id.includes("src/components/dashboard/")) return "app-dashboard";
          if (id.includes("src/components/landing/")) return "app-landing";
          if (id.includes("src/components/trailer/") || id.includes("src/pages/Trailer")) return "app-trailer";
          if (id.includes("src/components/narrative/") || id.includes("src/lib/narrative")) return "app-narrative";
          if (id.includes("src/hooks/useAutoRunMissionControl")) return "app-autorun-hook";

          // Everything else stays in the default chunk
        },
      },
    },
  },
}));
