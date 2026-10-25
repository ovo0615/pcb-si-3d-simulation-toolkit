# PCB SI 3D 模擬分析工具

將 PCB 訊號通道裁切、分段求解，再串回完整通道；依需求做眼圖、TDR 與截面阻抗分析。

**公開 Repo 只提供前端、文件與展示資料，沒有後端、啟動器或 Ansys 授權。** Source ZIP 無法執行完整流程。完整工具與商用支援請洽 [TADC](https://www.cadmen.com/)／[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)。

## 功能與入口

| 你要做什麼 | 操作章節 |
|---|---|
| 選網路、裁切、疊構（Beta）、背鑽（Beta）、Layout 清理（Beta） | [02 載入與裁切](docs/manual/02-載入與裁切.md) |
| 建端點 Port、套用規格與掃頻 | [03 Port 與求解設定](docs/manual/03-Port與求解設定.md) |
| 選整片或分段、逐段指定 HFSS／SIwave | [04 分段與混合求解](docs/manual/04-分段與混合求解.md) |
| 排程、停止、重試匯出、Touchstone 串接 | [05 排程與串接](docs/manual/05-排程與串接.md) |
| 外部 IBIS／AMI 模型匯入、眼圖精靈；眼圖分析（單通道、多埠、AMI，Beta） | [06 IBIS 與眼圖](docs/manual/06-IBIS與眼圖.md) |
| 模擬／量測（Beta）TDR 回標 Layout | [07 TDR 定位](docs/manual/07-TDR定位.md) |
| 二維截面阻抗與側向收斂（Beta） | [08 截面阻抗](docs/manual/08-截面阻抗.md) |
| 更新快照、浮水印、單檔 HTML | [09 報告與輸出](docs/manual/09-報告與輸出.md) |
| 外部通道、遠端求解包（Beta）、S 參數工具箱（Beta） | [10 其他工作模式](docs/manual/10-其他工作模式.md) |

Beta 每次啟動預設關閉，需開啟「啟用 Beta 功能」，僅本次啟動有效。標「Beta」的功能啟用後可以使用，但驗證案例較少；同嚴重度的問題先處理主要功能（影響資料、隱私或結果有效性的除外），Beta 不代表結果無效。分級以 [`featureTiers.json`](web_app/frontend/src/featureTiers.json) 為準，介面上的標示與確認方式見 [01 Beta 選項](docs/manual/01-開始使用.md#beta-選項)。

## 完整工具前置需求

| 元件 | 用途／安裝方式 |
|---|---|
| Windows 10／11 x64 | 執行完整工具 |
| Ansys Electronics Desktop 2026 R1（2026.1）與相應授權 | EDB 與所選求解功能；須自行安裝與取得授權 |
| 內附 CPython 3.12.10 與離線套件 | v1.0.4 完整安裝包自行建立環境，不需另裝 Python 或 pip 套件 |
| Microsoft Edge WebView2 Evergreen Runtime | 顯示工具視窗；缺少時依安裝提示安裝 |
| IBIS／AMI 模型或量測資料（選用） | 眼圖與量測分析；需確認使用與再散布權限 |

一般使用者不需 Node.js。修改前端原始碼才需要 Node.js／npm，依工具包的 `package.json` 與鎖檔安裝。

## 第一份結果

取得完整安裝包 → 核對 SHA-256 → 執行 Setup 並完成授權匯入 → 開啟工具 → 選任務 → 載入示範板 → 選訊號與參考 → 裁切與前處理 → 建 Port → 整片或分段 → 求解與檢查 Touchstone → 串接 → 更新報告快照。

v1.0.4 安裝包已附 `Example_SYZ.aedb`，使用前先複製到自己的 ASCII 工作路徑。試用授權為 14 天，起訖依授權檔。

逐步操作見 [00 第一次跑](docs/manual/00-第一次跑.md)。眼圖另走 [06 章](docs/manual/06-IBIS與眼圖.md)，不承諾固定完成時間。

## 使用邊界

| 項目 | 必須確認 |
|---|---|
| Port／結果 | 求解完成不等於 Touchstone 有效；檢查埠數、埠序、頻率與來源 |
| 停止 SIwave | 等目前段解完，該段結果不採用；停止中不能重開排程 |
| 模型 DLL | 會在本機執行；掃描、SHA-256 與信任紀錄不是安全保證。模型由使用者提供，受管副本仍受供應商授權約束 |
| 修復與推測 | 材料補建、Model Selector 補建等推測須讀警告，不能當作量測事實 |
| 報告／支援包 | 送出前檢查路徑、模型、日誌與識別資料；浮水印不是 DRM |
| 二維 Q2D | 不涵蓋 Via、轉角與參考層破口的完整三維效應 |

本次文件草稿依 v1.0.4 行為更新，尚未代表公開發版或實機驗收完成。舊版截圖與待補項目見圖片帳冊。[版本說明](CHANGELOG.md)｜[圖片帳冊](docs/visual-assets.md)｜[驗證資料](validation/README.md)｜[疑難排解](docs/manual/11-疑難排解.md)。歷史驗證只支持其記錄的版本、資料與條件。

商用授權與技術支援由虎門科技股份有限公司（Taiwan Auto-Design Co., Ltd.，TADC）提供。此為獨立公開展示，與 Ansys, Inc. 無隸屬或背書關係；相關商標屬原權利人，工具不含、不提供亦不繞過 Ansys 授權。
