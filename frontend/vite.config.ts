import { defineConfig } from "vite";
import { execSync } from "child_process";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const commitHash = execSync("git rev-parse --short HEAD").toString().trim();
const buildTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(`${commitHash} · ${buildTime} IST`),
  },
  server: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
  },
});
