/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  root: "client",
  base: "./",
  envDir: path.resolve(__dirname),
  publicDir: "public",
  resolve: { alias: { "@shared": path.resolve(__dirname, "shared") } },
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/ws": { target: "ws://localhost:3000", ws: true } },
  },
  test: { root: __dirname, include: ["shared/**/*.test.ts", "server/**/*.test.ts"], environment: "node" },
});
