import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3001" } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/recharts/")) return "charts";
          if (id.includes("/node_modules/victory-vendor/")) return "chart-vendor";
          if (id.includes("/node_modules/lucide-react/")) return "icons";
        },
      },
    },
  },
});
