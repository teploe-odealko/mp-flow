import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: "src/frontend",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/frontend")
    }
  },
  server: {
    port: 5174,
    proxy: {
      "^/api/.*": "http://127.0.0.1:3004",
      "/mcp": "http://127.0.0.1:3004"
    }
  },
  build: {
    outDir: "../../dist/frontend",
    emptyOutDir: true
  }
});
