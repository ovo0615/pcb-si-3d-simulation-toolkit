# 版本更新說明

## v1.2.0（草稿，尚未發布）：眼圖精靈、中英介面、SPISim 規格模型

| 項目 | 內容 |
|---|---|
| 公開版 | 前端同步到 `fd1ce55`，dist 與完整工具逐檔相同 |
| 前後端介面版號 | 9（舊版前端是 8，前後端要一起換） |
| 狀態 | 草稿；尚未建立 tag、尚未發 Release |

### 新功能

| 功能 | 說明 |
|---|---|
| [眼圖精靈](docs/manual/06-IBIS與眼圖.md#眼圖精靈五步) | 通道 → 速率 → 兩端晶片 → 接線確認 → 執行，五步做完單通道、多埠／DDR 與 IBIS-AMI；`[Model Selector]` 變體依驅動強度／ODT 篩選 |
| 常見規範預設 | DDR4／5、LPDDR4／4X／5／5X、PCIe Gen3～6、USB 3.2 Gen1／Gen2、USB4 Gen2／Gen3、UCIe 1.1；只帶資料率、調變、bit 數下限，改過的欄位標「已覆寫」可還原 |
| [SPISim 規格模型](docs/manual/06-IBIS與眼圖.md#沒有模型從-aedt-內建規格產生spisim) | 沒有原廠模型時，從本機 AEDT 範本產生 IBIS／IBIS-AMI 規格模型；產生前探測授權，自動標「非原廠」並檢查 C_comp τ／UI |
| [中英介面切換](docs/manual/01-開始使用.md#選單與工作狀態) | 「檢視 → Language／語言」；第一次開啟依 Windows 顯示語言；HTML 報告語言可另選 |
| 眼圖結果畫廊 | 量測表與兩欄縮圖並排，點開放大，Esc／左右鍵操作 |
| 多埠預檢提示 | 沒有選通時提示補 DQS 埠與 `[Diff_Pin]`；兩側都像顆粒模型時警告「模型可能選錯了」 |
| 工具視窗 | 視窗開好後黑色主控台自動隱藏，出錯才出現；新的軟體圖示 |

### 改進

- 標準 IBIS 眼圖電壓量測帶單位（V／mV），讀不到寫「單位未知」。
- 快速檢驗依兩端模型宣告的調變執行，PAM4 以符號率計算。
- 打開模型庫不再探測 SPISim、不占授權；按「重新探測」或「產生並匯入」才探測。
- 秒級預覽與等化掃描的結果過期會標示，且不能套用。
- 規範出處改為官方來源（PCI-SIG、JEDEC）。

### 修正

- PAM4（例如 PCIe Gen6）曾以兩倍速率求解；資料率一律改為位元率。
- AMI 眼圖沒有資料時誤判「眼圖閉合」，改判「結果無效」；`Ignore_Bits` 超過模擬位元數時自動加長。
- 兩個分頁同時產生規格模型時，失敗的一方會刪掉另一方成功的模型；改為整段排隊、只回滾自己新建的。
- 模型庫「產生規格模型」區塊無法顯示。
- 多埠預檢把對側腳位湊成選通。
- Windows 上不再要求信任 Linux `.so`。
- USB4 v2 預設資料率改為每 lane 40 Gb/s。

### 移除

- 「多埠通道」「AMI 通道」兩個分頁：功能全部移入眼圖精靈，手冊與截圖已改。
- 練習包附的活動示範設定檔。

### 升級注意

| 變更 | 影響 |
|---|---|
| 資料率一律是位元率；PAM4 的 UI＝2／位元率 | 舊 PAM4 紀錄不會被重用；曾把符號率填進資料率欄的（例如 PCIe Gen6 填 32），改填 64。NRZ 不受影響 |
| 前後端介面版號 8 → 9 | 前端與後端要一起更新；版號不符時依提示用 `start.bat` 重開 |
| 舊分頁移除 | 依 [06 章](docs/manual/06-IBIS與眼圖.md) 改走眼圖精靈 |
| 黑色主控台自動隱藏 | 關工具視窗即停止服務 |

### 已知限制

- SPISim 規格模型需要 Ansys Electronics Enterprise 授權；產生的是規格模型，不是原廠模型，不能代替晶片廠模型簽核。商業使用前請先向 Ansys 確認此用法。
- 沒有授權時，SPISim 回報的錯誤訊息尚未實機驗證。
- 位址命令（CA）群的結果畫廊尚未實拍驗證；多埠預檢的新提示尚未在 AEDT 實跑驗證。
- 產生規格模型時模型庫清單會排隊，最壞約 4 分鐘只顯示轉圈。
- 眼圖精靈第 5 步結果圖待拍（需占用求解授權）；舊分頁的結果截圖已移除。
- 乾淨 Windows 機器的完整工具包驗收尚未完成。
- 工具「關於」顯示的版本字串仍是 `1.0.0-rc.1`：公開展示版的 tag 與工具版本分開編號。

### 需要預先安裝

| 項目 | 需求 |
|---|---|
| Windows | 64 位元 Windows 10／11 |
| Ansys Electronics Desktop | 2026 R1（2026.1） |
| Ansys 授權 | 依功能：HFSS 3D Layout、SIwave、Circuit；SPISim 規格模型另需 Electronics Enterprise |
| Python | 64 位元 3.10 或 3.12（原生出貨包只收 3.12） |
| Windows PowerShell | 5.1（`start.bat` 呼叫） |
| Microsoft Edge WebView2 Runtime | 選用；沒有就改開瀏覽器 |
| 後端與視窗套件 | 第一次啟動自動安裝（pyedb、pyaedt、fastapi、scikit-rf、Pillow、pywebview 等） |
| Node.js | 一般使用者不需要；只有修改前端才需要 |

### English summary

v1.2.0 (draft) replaces the separate Multi-lane and AMI tabs with a five-step **Eye Wizard** (channel → rate → buffer models → wiring check → run) covering single-channel, multi-lane/DDR and IBIS-AMI analysis. It adds protocol presets (DDR4/5, LPDDR4/4X/5/5X, PCIe Gen3–6, USB 3.2, USB4, UCIe 1.1), an English/Traditional Chinese UI switch, a result gallery, and SPISim-generated **spec models** for users without vendor models. Data rate is now always the bit rate (PAM4 UI = 2 / bit rate), so earlier PAM4 records are not reused. SPISim spec models require an Ansys Electronics Enterprise licence, are not vendor models, and their commercial use should be confirmed with Ansys first.

## 2026-10-10：操作說明改版、前端同步到 `a19eda7`

| 項目 | 內容 |
|---|---|
| 工具版本 | `1.0.0-rc.1` |
| 功能基準 | `a19eda7`（截圖多數取自 `63db38b`；清理圖 `30c8ff8`；Q2D 與停止示範 `ada739a`；報告圖 `8acb42e`；AMI 結果與 SerDes 面板 `a19eda7`）；版本字串相同不代表功能相同 |
| 公開版變更 | 前端 PR #51、文件 PR #52 |
| 狀態 | 已合併到 `main`；尚未發 Release，完整工具包驗收未完成 |

### 新增

- [SerDes 合規判定](docs/manual/06-IBIS與眼圖.md#serdes-合規判定)：用自建規格設定檔判頻域限值、TDR、眼罩、ERL，結果附進 HTML 報告；附判定結果截圖。
- 健檢「結果無效，不是模型問題」黃字；AMI 快速檢驗改稱「近無損直連」。
- [12 章索引](操作說明.md)、[圖片帳冊](docs/visual-assets.md)與逐次版本維護規則。
- 支援包、工具視窗／瀏覽器與正常停止的操作說明。
- 工具視窗最大化實拍：任務入口、視窗與選單、載入／裁切、疊構、背鑽、清理分析、Port、求解設定、分段、模型庫、截面預覽、遠端求解包等，逐張狀態見 [圖片帳冊](docs/visual-assets.md)。

### 變更

- [00](docs/manual/00-第一次跑.md) 主線先到 S 參數與報告，模型眼圖移至 [06](docs/manual/06-IBIS與眼圖.md)。
- [03](docs/manual/03-Port與求解設定.md) 按現行介面寫 Port 自動、Phi 與掃頻；[05](docs/manual/05-排程與串接.md) 寫 12 cores 及 SIwave 等段完成的停止流程。
- 三份 README 統一公開展示範圍、完整工具需求與資料邊界。
- 文件不再以公開 Source ZIP 作完整工具入口，也不承諾 30 分鐘完成。
- 文件維護以公開版為唯一來源，不再從私有版整份複製手冊。
- 移除 58 張已由現行畫面取代且無引用的舊截圖；品牌 LOGO 與 7 張 validation 證據圖保留。

### 修復

- AMI 快速檢驗的參考通道改為近無損（Nyquist 處約 −0.5 dB），不再因無損直連造成 impulse 發散；健檢「結果無效」的意思寫進 [06](docs/manual/06-IBIS與眼圖.md)。
- HTML 報告浮水印改成每節一層、跟著內容捲動，不再固定在視窗上（`8acb42e`）。
- 報告圖下的段數一律以串接摘要為準，不會再出現 0（`8acb42e`）。
- 關閉工具時先釋放 EDB，後端與 EDB 伺服器程序數秒內結束，不再留下 EDB_RPC_Server（`8acb42e`）。
- 報告與結果頁底只顯示檔名，快照與 HTML 報告不再帶出本機路徑；快照圖說切換分頁後清空（`ada739a`）。舊快照不會自動改寫，要重拍。
- Q2D 截面端點對齊，原本「求解已結束但沒有解」的切線可解出（`ada739a`）。
- AMI 結果超出物理範圍時判「結果無效」，數值加單位，見 [06](docs/manual/06-IBIS與眼圖.md)。
- 只裁切、尚未建 Port 時，Layout 清理不再被拒（`30c8ff8`），見 [02](docs/manual/02-載入與裁切.md#layout-清理選用)。
- 原生引擎探測逾時留下的「待收尾」紀錄，引擎結束後自動清除；S 參數工具箱新增「確認引擎已結束，清除紀錄」，見 [11](docs/manual/11-疑難排解.md)。
- 排程中 HFSS 段進度改讀求解 profile，不再一直顯示「初始網格生成」。

### 已知問題

- 35 張主圖中 3 項缺圖（12、25、29，原因見圖片帳冊）；5 張條件圖需合法資料及真實狀態才拍。
- SerDes 合規截圖未勾 ERL：ERL 要用 Electronics 授權，授權被占用時會判「缺資料」。
- 完整工具包尚待核對版本、輸出檔名與 ASCII 路徑、停止收尾、DLL／模型公開權限。

後續功能更新只改受影響的章節與截圖，並在本檔最上方新增一節，列新增、變更、修復、已知問題及章節連結。
