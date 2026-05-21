import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/backend/index.ts",
    target: "node22",
    outDir: "dist/server",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
        format: "es"
      }
    }
  }
});
