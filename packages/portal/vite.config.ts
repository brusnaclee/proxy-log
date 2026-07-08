import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5174,
    proxy: {
      "/portal/api": {
        target: "http://localhost:3239",
        changeOrigin: true,
      },
    },
  },
  base: "/portal/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
