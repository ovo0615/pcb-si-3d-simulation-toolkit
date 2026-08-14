# IBIS 模型與眼圖分析

> 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

[回操作說明索引](../../操作說明.md)

## IBIS 模型與眼圖分析

這個功能把 Circuit 中常用的「Tx 模型→完整通道 Touchstone→Rx 模型」流程放回工具內，並以受管模型、明確路由與可重現執行紀錄避免模型或設定被悄悄換掉。

入口畫面只需勾選「IBIS 模型與眼圖分析」。進入工具後，模型匯入、通道綁定、分析設定、Preflight、求解與眼圖結果都集中在右側同名頁籤；左側串接工作列不再顯示眼圖設定。

若入口同時勾選「一鍵 HTML 報告」，右側「IBIS 模型與眼圖分析」頁籤上方會顯示「更新報告快照」。快照會保存當下正在看的模型庫、標準 IBIS／IBIS-AMI 設定或眼圖結果，並在報告中歸入「IBIS 模型與眼圖分析」章節。

標準 IBIS 工作若產生一張以上眼圖，保存快照時除了目前工作畫面的總覽，也會將每張眼圖卡各自輸出成獨立高解析度快照。獨立快照包含 Lane 名稱、QuickEye／Transient 類型、眼高／眼寬與完整眼圖，不會受到畫面捲軸裁切。

### 先匯入模型

1. 開啟右側「IBIS 模型與眼圖分析」頁籤中的「模型庫」。
2. 按「瀏覽多個檔案…」可使用 Ctrl／Shift 一次選取多個 `.ibs` 或 `.ami`；也可在路徑欄每行貼上一個檔案路徑。若 `.ami` 同層只有一個 `.ibs` 引用它，工具會自動組成完整套件；同批檔案指向相同套件時只建立一個受管模型版本。
3. 批次匯入會逐檔回報結果；單一檔案解析失敗不會取消其他成功項目，失敗路徑會保留在輸入欄供修正後重試。
4. 工具將文字模型、DLL／SO 與相依檔複製到本機受管資料夾，保存每個檔案與整個套件的 SHA-256；來源檔保持唯讀。
5. AMI 套件須先掃描原生程式庫。Windows Defender 不可用時會顯示原因，使用者仍須對完全相同的 SHA-256 明確建立信任。
6. 第一版正式執行只接受 Windows x64 DLL；Linux SO 會保存於套件中，但不在 Windows Worker 載入。

`.ibs` 是可編輯的文字模型，因此內容變更後 SHA-256 會改變並形成新版本；DLL／SO 的信任不會自動延伸到另一個 Hash。工具不會因檔名相同就沿用舊信任。

### 一般 IBIS 通道

「標準 IBIS 通道」使用七步向導選擇 Touchstone、Tx、Rx、Port、Corner 與分析設定：

- 支援 2-Port 單端、4-Port 差動，以及把同一個 S4P 設為兩條彼此耦合的單端 Lane。
- S4P 的設定位置在七步向導第 4 步「綁定」。選「兩條單端通道」後，Lane 1／Lane 2 可分別指定 Tx Port、Rx Port、Tx／Rx IBIS 模型與 Corner；四個 Port 不可重複。
- 分析完成後，第 7 步會直接顯示每條 Lane 的眼圖、眼高與眼寬。點選圖片或「放大檢視」可全畫面查看；「開啟結果資料夾」則會開啟該次 Run 的 AEDT 專案、圖片與執行紀錄位置。
- 雙單端模式不會把 S4P 拆成兩個 S2P，因此保留兩條 Lane 的近端／遠端串擾。QuickEye 會逐 Lane 建立目標 Probe 工作並輸出兩張眼圖；另一條 Lane 的激勵仍保留為串擾源。
- QuickEye 適合快速評估；Transient 適合只有 Premium／SIwave 授權或需要時域波形的環境。
- Auto 只會在 AEDT 明確回報 QuickEye 授權 checkout 失敗時改跑 Transient；模型、Port 或求解錯誤不會被掩蓋。
- 一般 IBIS 固定使用 NRZ。Tx／Rx Model、Corner、Port 方向及差動 P／N 極性都必須人工確認。

### IBIS-AMI 通道

「IBIS-AMI 通道」也是七步向導，但分析路由改為：

| 路由 | 用途 | 工具行為 |
|---|---|---|
| Auto | 不確定模型該走哪一種方法 | 有 DFE／CDR 等逐位元證據且雙方支援 GetWave 時選 GetWave；其餘優先 Statistical。 |
| Statistical | Init／VerifEye 快速統計眼圖 | 要求 Tx／Rx 都宣告 `Init_Returns_Impulse=True`。 |
| GetWave | 逐位元時域演算法模型 | 要求 Tx／Rx 都宣告 `GetWave_Exists=True`；失敗時不會靜默改跑 Statistical。 |
| Statistical＋GetWave | 比較兩種模型行為 | 依序執行兩次並分別保存結果；兩端必須同時支援兩種方法。 |

AMI 參數不是固定表單。工具從 `.ami` 解析 `Usage In／InOut`，依 Boolean、Integer、Float、List 或 Range 動態產生欄位；Info／Out 等唯讀值只做能力判斷，不能由 API 覆寫。每次執行會把實際參數值寫入 `run_manifest.json`。

PAM4 只有在 **Tx 與 Rx 都以模型參數明確宣告相容**時才會出現在調變選單。檔名含 `PAM4`、使用者手動輸入或只有一端支援都不算證據；不符合條件時只提供 NRZ。

### 輸出與安全邊界

- 每次工作建立不可變 Run 資料夾，保存 Touchstone、Tx／Rx 模型快照、SHA-256、Port 綁定、激勵、路由決策、AEDT／PyAEDT／PyEDB 版本與結果路徑。
- AMI DLL 只在獨立非圖形化 AEDT Worker 載入。首次成功最小分析後，三階段驗證狀態才會由「尚未實際驗證」改成通過。
- Statistical／GetWave 會輸出 impulse 與 Statistical Eye 高解析圖片；一維 impulse 可輸出 CSV。二維 Eye histogram 不直接匯成巨大 CSV，以免 AEDT 長時間卡在後處理。
- 本階段結果證明流程可以建立與求解；正式產品簽核仍應以固定模型、通道與原生 Circuit Golden Baseline 比對眼高、眼寬、BER／Bathtub 或 histogram，而不是只看「求解成功」。

---

← [排程求解、串接與 S 參數檢視](05-排程與串接.md)　[回索引](../../操作說明.md)　[TDR 阻抗定位](07-TDR定位.md) →

> 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
