import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { registerStateOverviewApi } from "./src/server/dev-api.js";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    {
      name: "story-engine-dev-api",
      configureServer(server) {
        registerStateOverviewApi(server.middlewares);
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
