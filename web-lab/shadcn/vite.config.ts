import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const api = "http://127.0.0.1:3100"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../../apps/shared"),
    },
    // apps/shared 在本目录之外，它 import 的 typebox 从这里的 node_modules 解析。
    dedupe: ["typebox"],
  },
  server: {
    host: "127.0.0.1",
    port: 5201,
    strictPort: true,
    fs: { allow: [path.resolve(__dirname, "../..")] },
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/s/": { target: api, changeOrigin: false },
    },
  },
})
