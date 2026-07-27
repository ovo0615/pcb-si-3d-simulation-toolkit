# PCB SI 3D 模擬分析工具（Web App）

此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

求解環境：**HFSS 3D Layout**（透過 PyEDB 操作 Ansys Electronics Database）

---

## 功能總覽

| 功能 | 說明 | 狀態 |
|---|---|---|
| 功能1 | 匯入電路板 → 依指定線路向外框選指定距離裁切 → 自動於元件端建立 Port | ✅ 已完成 |
| 功能2 | 將裁切後的板子分成 N 段、切面自動建立 Port、排程模擬 N 個 AEDT 檔 | 🚧 開發中 |
| 功能3 | N 個模擬完成後，自動以電路方式串接 S 參數還原完整通道 | 🚧 開發中 |

檢視功能：完整電路板 Layout、裁切後 Layout、N 段分割 Layout（2D Canvas，支援縮放、平移、圖層開關、Port 標記顯示）。

---

## 套件需求（需預先安裝）

### 系統環境
| 名稱 | 用途 | 版本需求 |
|---|---|---|
| Ansys AEDT（HFSS 3D Layout） | EDB 讀寫與模擬求解 | 建議 2024 R1 以上（本工具預設 2026.1） |
| Python | 後端執行環境 | 3.10 ~ 3.12 |
| Node.js | 前端開發伺服器 | 18 以上 |
| uv | Python 套件管理（可選，無則自動安裝） | 任意 |

### Python 套件（`backend/requirements.txt`，啟動腳本會自動安裝）
| 套件 | 用途 |
|---|---|
| fastapi | 後端 Web API 框架 |
| uvicorn[standard] | ASGI 伺服器 |
| websockets | 系統日誌即時推送 |
| pyedb | Ansys EDB 讀寫、裁切（cutout）、Port 建立 |
| pydantic | JSON 請求／回應資料驗證 |

### npm 套件（`frontend/package.json`，啟動腳本會自動安裝）
| 套件 | 用途 |
|---|---|
| react / react-dom | 前端 UI 框架 |
| allotment | 可拖曳分割面板 |
| vite / typescript | 開發伺服器與建置工具 |

---

## 啟動方式

雙擊 `start.bat`（或於 PowerShell 執行 `start.ps1`）即可：

1. 自動建立 Python 虛擬環境（優先使用 uv）並安裝後端套件；
2. 自動安裝前端 npm 套件；
3. 啟動後端 uvicorn（`http://127.0.0.1:8020`）與前端 Vite（`http://localhost:5190`）並開啟瀏覽器。

---

## 功能1 操作流程

1. **輸入檔案**：輸入或瀏覽選擇 `.aedb`（選取其中的 `edb.def`）／`.brd`／`.tgz`，按「載入電路板」。
2. **選擇網路**：於左列將要保留的訊號線路加入「訊號網路」，將 GND 等加入「參考網路」（載入時會自動建議含 GND／VSS 字樣的網路）。
3. **裁切設定**：輸入向外擴張距離（mm）與框選形狀（凸包／矩形）。
4. **Port 設定**：選擇 Port 類型（Coax／Circuit），勾選要建立 Port 的元件（自動列出接觸訊號網路的元件）。
5. **輸出與執行**：確認輸出路徑後按「執行裁切並建立 Port」；完成後自動切換到「裁切後 Layout」分頁，Port 位置以紅色十字圓圈標示。

> 注意：Port 會在裁切**之前**建立，確保 Port 端點保留在裁切結果中；原始檔案不會被修改，裁切結果另存為新的 `.aedb`。

---

## 專案結構

```text
web_app/
  start.bat / start.ps1     一鍵啟動腳本
  backend/
    requirements.txt
    app/
      main.py               FastAPI 路由 + WebSocket 日誌
      session.py            EDB 工作階段狀態
      preview.py            2D Layout 預覽資料擷取
      cutout.py             功能1：裁切 + Port 建立
  frontend/
    src/
      App.tsx               主畫面（選單列、步驟面板、檢視分頁、日誌）
      components/Preview2D.tsx   2D Canvas 渲染引擎（含 Port 標記）
```
