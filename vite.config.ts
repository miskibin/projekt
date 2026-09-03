import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: "client",
  publicDir: "public",
  resolve: { alias: { "@shared": path.resolve(__dirname, "shared") } },
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/ws": { target: "ws://localhost:3000", ws: true } },
  },
  test: { include: ["shared/**/*.test.ts", "server/**/*.test.ts"] },
});
