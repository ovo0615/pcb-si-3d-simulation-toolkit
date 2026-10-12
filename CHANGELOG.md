# 版本更新說明

## 未發布

| 功能 | 說明 | 操作章節 |
|---|---|---|
| 本工具合成規格模型 | 模型庫「產生規格模型」分成「SPISim 產生」與「本工具合成」兩塊。合成依 JEDEC 規範參數算出 IBIS，不用 SPISim、不用 Ansys 授權；涵蓋 DDR2～DDR5、LPDDR2～LPDDR5X，Tx 每個 Ron、Rx 每個 ODT＋關閉各一個模型；每個值附公開出處，查不到的標「待確認」由使用者填 | [06](docs/manual/06-IBIS與眼圖.md#沒有模型本工具合成) |
| 模型來源標示 | 模型庫徽章（藍：本工具合成；橘：SPISim 產生）、詳細資料、眼圖與多埠結果頁、預檢、報告中繼資料都標來源；DDR5 Rx 合成模型標「未含 DFE，結果偏悲觀」 | [06](docs/manual/06-IBIS與眼圖.md#沒有模型本工具合成) |
| SPISim Rx 非 POD 提醒 | SPISim 規格模型的 Rx 是上下分壓或只接地，不是 POD（DDR5-6400 實測眼高 295 mV 對合成 550 mV）；「SPISim 產生」常駐提醒，用到 SPISim Rx 的眼圖與報告會標示 | [06](docs/manual/06-IBIS與眼圖.md#沒有模型從-aedt-內建規格產生spisim) |
| 常見規範預設 | 眼圖精靈補 DDR2-800、DDR3-1600、DDR3L-1600、LPDDR2-1066、LPDDR3-2133 | [06](docs/manual/06-IBIS與眼圖.md#眼圖精靈五步) |
| 修正 | 一鍵 HTML 報告的模型來源中繼資料不再是空白 | [09](docs/manual/09-報告與輸出.md) |
| 合成 SerDes 規格模型 | 本工具合成加入 PCIe Gen3～Gen5、USB 3.2 Gen1／Gen2、USB4 Gen2／Gen3，產生差動 Tx＋Rx；只有 IBIS、沒有 AMI 等化，各處標「不能判合規」。模型庫展開摺疊區後可捲動 | [06](docs/manual/06-IBIS與眼圖.md#沒有模型本工具合成) |
| 判斷頻寬 | 求解器建議用的頻寬移到「模擬設定」，依規範／依資料率自訂二選一，兩邊各自保留；進階覆寫優先。切面一律以掃頻上限驗收。分段後改頻寬會提示重新評估；排程日誌提示頻寬與掃頻對不上 | [03](docs/manual/03-Port與求解設定.md#判斷頻寬)、[04](docs/manual/04-分段與混合求解.md#分段操作)、[05](docs/manual/05-排程與串接.md#排程求解) |
| 不分割預覽 | 「不分割，整片求解」後，預覽整塊板一個求解區域，標籤跟著指定的求解器 | [04](docs/manual/04-分段與混合求解.md#不分割整片求解) |
| 從中途開始 | 已裁切／已設 Port 的板子取消「局部裁切」直接載入；勾著局部裁切載入已有 Port 的板會提示，一鍵改成不裁切重新載入；訊號網路依既有 Port 預選 | [02](docs/manual/02-載入與裁切.md#已裁切或已設-port-的板子) |
| 功能分級：主要與 Beta Option | 13 項主要、19 項 Beta（以 `web_app/frontend/src/featureTiers.json` 為準）。入口的 Beta 任務收進各群組「Beta 選項（N）」預設收合；含 Beta 模式的主要任務標「含 Beta 選項」；新增「只選主要功能」。面板、模式與下拉選項標 `Beta Option`／「（Beta）」，可看限制。第一次送出 Beta 選項前彙總確認，同一項在同一分級版本只問一次，取消不送出。上次存下的勾選含 Beta 時原樣載入並提示；執行紀錄與歷史面板記下當時的分級。限制：只有深色主題配色；報告尚未逐節標 Beta | [01](docs/manual/01-開始使用.md#beta-選項)、[06](docs/manual/06-IBIS與眼圖.md#眼圖精靈五步)、[11](docs/manual/11-疑難排解.md#常見問題) |
| 分段疊圖兩顆開關 | 「板子禁切／風險」（禁切區間、硬擋 Pad、斜走線，與段數無關）與「切點診斷」（理想等分位置、被拒絕候選，隨段數改變） | [04](docs/manual/04-分段與混合求解.md#疊圖開關) |

## v1.0.0（2026-10-11）：第一版

| 項目 | 內容 |
|---|---|
| 工具版本 | `1.0.0`（工具「關於」與視窗標題顯示同一字串） |
| 公開版內容 | 前端原始碼與已建置 `dist`、操作說明、截圖、驗證報告與數據；沒有後端與啟動器 |
| 狀態 | 已發布：tag `v1.0.0`、GitHub Release（2026-10-11） |

### 功能總覽

| 功能 | 說明 | 操作章節 |
|---|---|---|
| 載入與裁切 | 載入 `.aedb`／`.brd`／`.tgz`，依訊號範圍裁出通道；選用疊構更換、背鑽、Layout 清理 | [02](docs/manual/02-載入與裁切.md) |
| Port 與求解設定 | 元件端 Port 自動判定、內建規格設定檔、掃頻由資料率帶入 | [03](docs/manual/03-Port與求解設定.md) |
| 分段與混合求解 | 等分或依 3D 複雜度切成 N 段，逐段指定 HFSS／SIwave；切面品質評分 | [04](docs/manual/04-分段與混合求解.md) |
| 排程與串接 | 逐段求解、可停止與重試匯出，再串回完整通道 Touchstone | [05](docs/manual/05-排程與串接.md) |
| 眼圖精靈 | 通道 → 速率 → 兩端晶片 → 接線確認 → 執行，五步做完單通道、多埠／DDR 與 IBIS-AMI；`[Model Selector]` 變體依驅動強度／ODT 篩選；結果頁只放眼圖，眼圖上預設不疊 AEDT 量測表，量測值在「眼圖參數」抽屜與 HTML 報告 | [06](docs/manual/06-IBIS與眼圖.md#眼圖精靈五步) |
| 常見規範預設 | DDR4／5、LPDDR4／4X／5／5X、PCIe Gen3～6、USB 3.2 Gen1／Gen2、USB4 Gen2／Gen3、UCIe 1.1；只帶資料率、調變、bit 數下限，附官方出處 | [06](docs/manual/06-IBIS與眼圖.md#眼圖精靈五步) |
| 模型庫 | IBIS／IBIS-AMI 受管副本、相容性預檢與自動修正、DLL 掃描與信任、參考通道健檢 | [06](docs/manual/06-IBIS與眼圖.md#模型庫與-dll-信任) |
| SPISim 規格模型 | 沒有原廠模型時，從本機 AEDT 範本產生 IBIS／IBIS-AMI 規格模型；產生前探測授權，自動標「非原廠」 | [06](docs/manual/06-IBIS與眼圖.md#沒有模型從-aedt-內建規格產生spisim) |
| SerDes 合規判定 | 以自建規格設定檔判頻域限值、TDR、眼罩、ERL | [06](docs/manual/06-IBIS與眼圖.md#serdes-合規判定) |
| TDR 定位 | 模擬或量測 TDR，把阻抗劇變標回 Layout 走線 | [07](docs/manual/07-TDR定位.md) |
| 截面阻抗（Q2D） | 從 EDB 還原實際截面求阻抗，可與 TDR 對照 | [08](docs/manual/08-截面阻抗.md) |
| 一鍵 HTML 報告 | 結果快照、浮水印、單檔 HTML；報告語言可另選；眼圖量測表隨快照印進報告 | [09](docs/manual/09-報告與輸出.md) |
| 開啟模擬資料夾 | 分段排程、串接、QuickEye、眼圖精靈、TDR、截面阻抗、ERL 完成後一鍵開輸出資料夾；只開工具自己產出的資料夾 | [09](docs/manual/09-報告與輸出.md#結果檔保存) |
| 其他工作模式 | 外部通道、遠端求解包、S 參數工具箱、COM | [10](docs/manual/10-其他工作模式.md) |
| 介面 | 工具視窗（沒有 WebView2 時改開瀏覽器）；黑色主控台在視窗開好後自動隱藏；「檢視 → Language／語言」切換中英 | [01](docs/manual/01-開始使用.md) |

### 使用前要知道

| 項目 | 說明 |
|---|---|
| 資料率 | 一律填**位元率**（Gb/s）；PAM4 的 UI＝2／位元率 |
| 求解結果 | 求解完成不等於 Touchstone 有效；檢查埠數、埠序、頻率與來源 |
| 眼圖結果 | 紅框「結果無效」時不採用任何數值；眼圖使用理想電源，不含 PDN 與同時切換雜訊 |
| 模型 DLL | 會在本機執行；掃描與信任紀錄不是安全保證 |

### SPISim 規格模型聲明

- 需要 **Ansys Electronics Enterprise** 授權；產生前探測一次授權（約 3 秒），打開模型庫本身不探測。
- 產生的是**規格模型，不是原廠模型**，只代表協定規格的典型行為，不能代替晶片廠模型做簽核。
- 範本的 C_comp 是佔位值，不是實際晶片值。
- 產生的模型只在本機使用、不外流；**商業使用前請先向 Ansys 確認此用法**。

### 已知限制

- 沒有授權時，SPISim 回報的錯誤訊息尚未實機驗證。
- 產生規格模型時模型庫清單會排隊，最壞約 4 分鐘只顯示轉圈。
- 位址命令（CA）群的結果畫廊、多埠預檢的選通與顆粒模型提示尚未在 AEDT 實跑驗證。
- SIwave 段無法中途停止，停止要等該段解完（該段結果不採用）。
- 二維截面阻抗不涵蓋 Via、轉角與參考層破口的完整三維效應。
- 手冊有 3 項缺圖、5 張條件圖待拍，見[圖片帳冊](docs/visual-assets.md)。
- 乾淨 Windows 機器的完整工具包驗收尚未完成。

### 需要預先安裝（完整工具）

| 項目 | 需求 |
|---|---|
| Windows | 64 位元 Windows 10／11 |
| Ansys Electronics Desktop | 2026 R1（2026.1） |
| Ansys 授權 | 依功能：HFSS 3D Layout、SIwave、Circuit、Q2D；SPISim 規格模型另需 Electronics Enterprise |
| Python | 64 位元 3.10 或 3.12（原生出貨包只收 3.12） |
| Windows PowerShell | 5.1（`start.bat` 呼叫） |
| Microsoft Edge WebView2 Runtime | 選用；沒有就改開瀏覽器 |
| 後端與視窗套件 | 第一次啟動自動安裝（pyedb、pyaedt、fastapi、scikit-rf、Pillow、pywebview 等） |
| Node.js | 一般使用者不需要；只有修改前端才需要 |

### English summary

v1.0.0 is the first release of the PCB SI 3D Simulation Toolkit public showcase (front end, documentation, screenshots and validation data; no back end or launcher). The toolkit cuts a PCB channel out of the board, solves it whole or in segments with HFSS/SIwave, cascades the Touchstone results, and analyses eye diagrams through a five-step **Eye Wizard** (single channel, multi-lane/DDR, IBIS-AMI) with protocol presets, plus TDR location, Q2D cross-section impedance, SerDes compliance checks and one-click HTML reports, in English or Traditional Chinese. Data rate is always the bit rate (PAM4 UI = 2 / bit rate). **SPISim spec models** require an Ansys Electronics Enterprise licence, are not vendor models, must not replace vendor models for sign-off, and their commercial use should be confirmed with Ansys first.

後續功能更新只改受影響的章節與截圖，並在本檔最上方新增一節，列新增、變更、修復、已知問題及章節連結。
