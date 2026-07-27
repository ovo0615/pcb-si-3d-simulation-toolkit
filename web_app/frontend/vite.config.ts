import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 本專案專屬固定埠（前端 5190 / 後端 8020），strictPort 確保埠被佔用時直接報錯。
// 與 PCB_Simplifer_Toolkit（5180 / 8010）錯開，避免互相衝突。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8020",
        changeOrigin: true,
        timeout: 600000, // 10 分鐘 timeout：EDB 載入與 cutout 可能很耗時
        proxyTimeout: 600000,
      },
      "/ws": { target: "ws://127.0.0.1:8020", ws: true },
    },
  },
});
