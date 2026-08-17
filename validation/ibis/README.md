# IBIS／IBIS-AMI 通道分析驗證

此目錄記錄一般 IBIS 第二階段與 IBIS-AMI 第三階段的自動化煙霧驗證。這不是數值簽核用的 Golden Baseline；正式 Golden Baseline 會在第五階段以固定版本的輸入、原生 Circuit 結果與數值容差另行建立。

## 已驗證範圍

- 2-Port 單端通道：QuickEye 可建立、求解並匯出 Statistical Eye 圖與執行紀錄。
- 2-Port 單端通道：Transient 可建立、求解並匯出波形 CSV、波形圖與 Eye Diagram。
- 4-Port 差動通道：QuickEye 可建立互補 P／N 激勵、求解並匯出結果。
- 4-Port 雙單端通道：保留同一個耦合 S4P，建立兩組獨立 EyeSource／Tx／Rx 並明確配對 EyeProbe。AEDT 2026 R1 對單一 QuickEye Setup 只保存第一顆 Probe，工具改以每條 Lane 一個目標 Probe 工作求解；每個工作仍保留另一條 Lane 作為串擾源。2026-08-13 煙霧驗證兩條 Lane 均成功輸出眼圖，Eye Height 分別為 0.8491 V、0.8468 V，Eye Width 分別為 0.9271 UI、0.9291 UI。
- EyeSource 的 `Tr／Tf` 各固定為 `0.2 × UI`，並在求解前保證 `Tr＋Tf < UI`。以 4 Gbps（UI 250 ps）回歸案例實測，AEDT 專案正確寫入 Tr／Tf 各 50 ps，QuickEye 約 12 秒完成；不再沿用元件預設的 500 ps 而在載入階段失敗。
- 一般 IBIS 的 I／O 模型：Tx 明確設定為 `Output Buffer`，Rx 明確設定為 `Input Buffer`。
- `Typ／Min／Max` Corner：非 Typ 選項會透過 AEDT 屬性介面設定並回讀確認。
- Auto 路由：只在明確的 QuickEye 授權 checkout 失敗時改跑 Transient；模型、接線或求解錯誤不會被掩蓋。
- 每次執行會固定 Touchstone 與受管 IBIS 模型副本，保存 SHA-256、Port 綁定、Corner、激勵、環境版本與原生輸出路徑。

## IBIS-AMI 第三階段驗證

- 解析 `.ami` 的 Reserved／Model Specific 參數，前端依 `Usage In／InOut` 動態建立參數編輯器；唯讀參數不能由 API 偽裝覆寫。
- Auto 路由會在模型明確顯示 DFE／CDR 等逐位元行為且支援 GetWave 時選 GetWave，否則優先 Statistical；GetWave 失敗不會靜默改跑 Statistical。
- Statistical 使用 `NexximVerifEye` 執行 Init／VerifEye，並保留 `NexximAMI` 的 `AMIAnalysis` 作為 AMI impulse／Statistical Eye 報表資料源。
- GetWave 使用 `NexximAMI`；模型的 `GetWave_Exists` 是唯讀能力宣告，不會被當成模式開關改寫。
- AEDT 將 Model Specific 參數公開為 `MS::<name>`，工具會在 Circuit 邊界明確映射，並從 `PassedParameterTab` 回讀確認。
- PAM4 只在 Tx／Rx 的 `.ami` 都明確宣告相容時出現；目前官方測試模型只宣告 NRZ，因此 PAM4 正確維持關閉。
- 以 Ansys 2026 R1 內建 `AMI_Example` 的 `diff_line.s4p`、`example_model_tx` 與 `example_model_rx` 實測：4-Port 差動 Statistical 約 22 秒完成，成功輸出 impulse 與 Statistical Eye 的 JPG／CSV 資料。
- 同一範例的 GetWave 已完成原生求解並產生 impulse CSV 與兩張高解析報表；測試也發現二維 Statistical Eye histogram 直接匯出 CSV 會讓 AEDT 長時間停在後處理，因此正式流程只匯出 Eye JPG，數值量測走獨立介面。

## 判準位（Vref）掃描

- 交越振幅是眼圖報表的後處理屬性，改它**不必重解**：實測每點 0.14 秒，13 點 1.8 秒，整份求解結果重用。
- 原本只在求解器自動算出的那一個交越振幅上量眼圖。以本目錄的 QuickEye 專案實測，掃規格 ±6% 的最差眼寬是 **0.8006 UI**，而自動判準位報 **0.9087 UI**——**原本的數字樂觀了 12%**。
- 眼寬與最小眼寬隨判準位大幅變動（0.65 ～ 0.97 UI），眼高幾乎不動（變化 0.5%）。與 Ansys 說明文件一致：交越振幅決定「在哪一個電壓算眼寬」，眼睛量測點才影響最小眼高。
- **峰值不在準位中點**（0.8292 V 對 0.7577 V），眼是不對稱的，所以以中點為中心的掃描窗最差都落在低壓端。
- VDDQ 填錯會讓掃描窗整條平移，掃出來的「最差」量到的是「離眼中心很遠」而不是「Vref 容差內最差」，**而數字看起來完全正常**。工具會比對量到的準位並算出反推的 VDDQ。

介面名稱、四個卡住的地方與完整數據見 [Vref 掃描介面調查](Vref掃描介面調查_20260817.md)；眼圖量測介面本身的能力偵測見 [量測介面調查](量測介面調查_20260814.md)。

## 驗證環境

- AEDT：2026 R1（2026.1）。
- PyAEDT：1.2.0。
- PyEDB：0.80.1。
- 模型與通道：使用 Ansys 安裝目錄內的唯讀 Signal Integrity 範例；驗證工作於獨立暫存目錄執行，未覆寫原始範例。
- 執行期間使用全新非圖形化 AEDT 工作階段，完成後釋放；未附加或停止使用者既有 AEDT 工作階段。

## 目前限制

- 一般 IBIS 支援 2-Port 單端、4-Port 差動，以及同一個 S4P 內的兩條單端 Lane；雙單端 Port 方向仍必須由使用者確認。
- 一般 IBIS 固定使用 NRZ；IBIS-AMI 的 PAM4 仍取決於模型明示能力，不會由檔名或使用者強制開啟。
- 本階段結果只證明自動建模、求解路由與輸出鏈可運作。眼高、眼寬或 BER 是否正確，仍須在第五階段與原生 Circuit Golden Baseline 做數值比較。
- 若範例通道與模型本身造成閉眼，工具會保留原生結果並標示無可用量測，不會捏造 Eye Height 或 Eye Width。

## 自動測試

後端完整測試涵蓋模型角色、Port 對應、人工確認、授權降級、I／O 模式切換、Corner、AMI 能力、動態參數、禁止 GetWave 靜默降級、訊息嚴重度與不可變執行紀錄。前端則以 TypeScript 與 Vite 正式建置驗證兩種七步向導。

此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
