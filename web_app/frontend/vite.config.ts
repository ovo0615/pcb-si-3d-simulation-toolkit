import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 版本只有 `web_app/VERSION` 一份：後端 `app_version.py` 讀同一個檔，
// 前端在建置時塞進 `__APP_VERSION__`。兩邊對不上就是建置流程出錯，
// 「關於本工具」會把兩個值並列讓人看得出來。
const APP_VERSION = readFileSync(resolve(__dirname, "..", "VERSION"), "utf-8").trim();

// 本專案專屬固定埠（前端 5190 / 後端 8020），strictPort 確保埠被佔用時直接報錯。
// 與 PCB_Simplifer_Toolkit（5180 / 8010）錯開，避免互相衝突。
//
// 後端埠讀 `PCB_SI_PORT`：`start.ps1` 在 8020 被佔用時會往上找到 8040，
// 寫死 8020 的話 `npm run dev` 不是連不上，就是安靜地代理到那時候真的佔著
// 8020 的另一個服務——後者更糟，畫面看起來有反應但答案不是這個工具給的。
// 正式版由 FastAPI 自己送前端，不經過這個代理，只影響開發模式。
const BACKEND_PORT = process.env.PCB_SI_PORT || "8020";

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  server: {
    port: 5190,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${BACKEND_PORT}`,
        changeOrigin: true,
        timeout: 600000, // 10 分鐘 timeout：EDB 載入與 cutout 可能很耗時
        proxyTimeout: 600000,
      },
      "/ws": { target: `ws://127.0.0.1:${BACKEND_PORT}`, ws: true },
    },
  },
});
