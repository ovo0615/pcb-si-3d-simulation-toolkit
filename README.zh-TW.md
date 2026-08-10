# PCB SI 3D Simulation Toolkit

[English](README.en.md) ｜ 繁體中文

> 此 Repository 為個人技術作品集之公開展示版本，非 Ansys 或虎門科技（TADC）官方帳號。Ansys 為 Ansys, Inc. 之商標。

## 1. 專案定位

**Jeff Hong 洪敬傑**
CAE, Senior Technical Engineer｜CAE 技術部資深技術工程師
Taiwan Auto-Design Co. (TADC)｜虎門科技股份有限公司

聯絡信箱：[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)　官方網站：[https://www.cadmen.com/](https://www.cadmen.com/)

核心定位：High-Frequency Electromagnetic Simulation & Engineering Automation｜高頻電磁模擬與工程自動化

主要技術：Ansys HFSS 3D Layout、PyEDB、PyAEDT、PCB Signal Integrity、S-parameter Analysis、Eye Diagram Analysis、Engineering GUI Automation。

> 減少 PCB 訊號完整性分析中的重複準備工作，讓高頻模擬流程更直觀、更可重複，也更容易操作。

## 2. 主視覺圖

![N 段分割與逐段求解器指定：綠色為 SIwave、紫色為 HFSS，標籤附複雜度分數](./graph/N段分割後推薦求解器示意_20260805.png)

工具以 Ansys HFSS 3D Layout 與 SIwave 為求解環境，透過 PyEDB 操作 EDB，將 PCB／封裝通道的匯入、訊號選取、裁切、Port 建立、風險感知分段、逐段求解與 S 參數串接整合在單一操作介面中。

## 3. 解決的工程問題

高頻 PCB 訊號完整性分析中，工程師經常需要手動重複執行：從完整板中框選訊號通道、依 Net 建立裁切範圍、於元件端手動放置 Port、視需要拆解成多段分別求解、再手動串接還原完整通道 S 參數。這些步驟耗時且容易出錯，尤其在通道過長導致單次網格規模過大、無法在合理時間內求解時更為明顯。本工具將這一整套準備與後處理流程自動化，並將分段串接結果與完整板 SIwave 基準並列比較，讓使用者直接依 S 參數差異判讀分段策略。

## 4. 功能展示

| 功能 | 說明 | 狀態 |
|---|---|---|
| 通道裁切與 Port 建立 | 依訊號 Net 自動框選（ConvexHull／Bounding）並於元件端建立 Coax／Circuit Port | ✅ 已完成 |
| Layout 清理 | 移除通道電磁影響範圍外的銅箔、走線與 Via，求解前先預覽再確認 | ✅ 已完成 |
| N 段分割 | 沿通道主軸搜尋切面，輸出 N 個獨立分段 EDB 及對接資訊 | ✅ 已完成 |
| 切面安全視覺化 | 以顏色區分禁切障礙、風險走線、候選切面與每段求解器區域 | ✅ 已完成 |
| HFSS／SIwave 混合求解 | 依每段 3D 電磁複雜度提出建議，並允許使用者逐段覆寫 | ✅ 已完成 |
| 排程模擬 | 逐段啟動獨立求解程序並匯出 Touchstone | ✅ 已完成 |
| S 參數自動串接 | 依分段對接資訊自動串接，還原完整通道 S 參數 | ✅ 已完成 |
| QuickEye 眼圖 | 以串接後 Touchstone 直接背景求解眼高、眼寬 | ✅ 已完成 |
| 外部 Touchstone 串接 | 載入既有 `.sNp` 檔案，自動建議或手動指定接線 | ✅ 已完成 |
| 不分割整片求解 | 通道不切割、整片當成一段求解，可作為分段結果的對照基準 | ✅ 已完成 |
| 遠端求解包 | 打包成資料夾送到求解機執行，求解機不需安裝 Python | ✅ 已完成 |
| 一鍵 HTML 報告 | 保存各結果畫面的快照，加入品牌、圖說與驗收規格後產生單一自包含 HTML | ✅ 已完成 |

### 切板顏色設計

分段畫面把「可以切、為何不該切、每段用哪個求解器」直接疊加在完整 Layout 上，並可個別關閉安全疊圖或求解區域色塊，避免遮住原始走線。

| 顏色／線型 | 意義 |
|---|---|
| 橘色發光走線 | 斜向走線或轉角風險帶，切面應盡量避開。 |
| 紅色半透明區／淡紅虛線 | 硬性禁切障礙與被拒絕的候選位置。 |
| 青色實線 | 工具最後採用且通過檢查的切面。 |
| 灰色虛線 | 尚未考慮障礙物時的理想等分位置。 |
| 綠色區域／標籤 | 指定使用 SIwave 的 Segment。 |
| 紫色區域／標籤 | 指定使用 HFSS 3D Layout 的 Segment。 |

## 5. 工作流程

Import → Select Nets → Cutout → Port → Segment → Solve → Analyze

![入口畫面：勾選這次要用的項目，介面只顯示對應面板](./graph/入口畫面_20260810.png)

![完整電路板 Layout 與右側圖層面板](./graph/完整板Layout_20260809.png)

![裁切後 Layout：只留下目標通道與元件端 Port](./graph/裁切後Layout_20260809.png)

![N 段分割預覽與安全疊圖](./graph/N段分割示意_20260805.png)

![逐段 HFSS／SIwave 建議、指定與判斷原因](./graph/混合求解設定_20260805.png)

![整體視圖：切割線與逐段求解器指派](./graph/分段整體視圖_20260809.png)

![混合求解排程執行中：段 1 HFSS、段 2 SIwave 已完成、段 3 等待中](./graph/混合排程模擬過程_20260805-public.png)

![分段 S 參數自動串接電路示意](./graph/串接電路示意圖_20260809.png)

![串接後 S 參數：單端／差動可切換，插入／回波損耗與近遠端串音](./graph/S參數展現_20260810.png)

![QuickEye 眼圖與眼高、眼寬量測](./graph/QuickEye眼圖_20260809-public.png)

![一鍵產出的 HTML 報告：公司品牌、分析目的與結果摘要](./graph/一鍵產出HTML報告_1_20260810.png)

## 6. 技術架構

- 前端：React、TypeScript、Vite，提供 2D PCB Layout 檢視（縮放、平移、圖層與 Port 標記切換）
- 後端：FastAPI＋WebSocket（即時系統日誌）
- 幾何與資料層：PyEDB（EDB 讀寫、裁切、Port、清理、分段）
- 求解層：PyAEDT 驅動 Ansys HFSS 3D Layout／SIwave 進行網格與電磁求解
- 後處理：scikit-rf 進行 Touchstone 讀取、電路串接與 S 參數計算

## 7. Windows 使用方式

本 Repository（公開展示版）僅包含前端原始碼與已建置的 `web_app/frontend/dist`，可直接檢視介面與功能展示畫面。**完整可執行版本**（含 FastAPI 後端、PyEDB／PyAEDT 整合與 `start.bat` 一鍵啟動）目前收錄於私人 Repository，透過 TADC 技術合作提供；公開版之目的在於呈現工作流程與成果，而非提供可獨立運作的求解環境。

## 8. Ansys License 與環境需求

完整版本執行時需要：64 位元 Windows 10／11、Ansys Electronics Desktop（目前固定使用 2026.1）、可用的 AEDT／HFSS 3D Layout／SIwave License，以及已驗證的 64 位元 Python 3.10 或 3.12。沒有可用 License 時無法執行排程求解。

## 9. 公開展示版限制

- 僅提供前端 UI 與已產生的示意圖／結果截圖，不包含後端原始碼與求解環境。
- 圖片使用 Demo／匿名化資料，已移除本機與求解輸出檔案的絕對路徑。
- 淨名（如 `ST_CTL`／`ST_ERROR`）與元件編號為示範用命名，非特定客戶專案資訊。
- 完整功能與原始碼開放範圍以私人 Repository 之合作條款為準。

## 10. 技術合作方式

正式技術合作與服務透過 Taiwan Auto-Design Co.（TADC）進行，並使用公司提供的 Ansys 資源與 License。如需完整功能、技術合作或客製化導入，請透過 jeff.hong@cadmen.com 或 https://www.cadmen.com/ 聯絡。

## 11. 著作權與商標聲明

本 Repository 為 Jeff Hong 個人技術作品集之展示內容，非 Taiwan Auto-Design Co.（TADC）官方帳號，亦非 Ansys, Inc. 官方合作展示。Ansys、HFSS、SIwave 為 Ansys, Inc. 之商標。除另有標示外，本頁面內容僅供技術展示，不代表可直接商用授權。
