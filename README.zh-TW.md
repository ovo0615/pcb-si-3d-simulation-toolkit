# PCB SI 3D Simulation Toolkit

[English](README.en.md) ｜ 繁體中文

> 個人技術作品集之公開展示版本，非 Ansys 或虎門科技（TADC）官方帳號。Ansys 為 Ansys, Inc. 之商標。

**Jeff Hong 洪敬傑**｜CAE 技術部資深技術工程師｜Taiwan Auto-Design Co. (TADC)
[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)　[cadmen.com](https://www.cadmen.com/)

把一片 PCB 上的一條訊號路徑，從板子檔案一路算到眼圖。求解環境為 Ansys HFSS 3D Layout
與 SIwave，以 PyEDB／PyAEDT 驅動。

> **想直接用？** [第一次跑：從下載到第一張眼圖](docs/manual/00-第一次跑.md)——一條路、30 分鐘。

![N 段分割與逐段求解器指定：綠色為 SIwave、紫色為 HFSS，標籤附複雜度分數](./graph/N段分割後推薦求解器示意_20260815.png)

## 別人沒有的

**全板自動分段、逐段自動選求解器——一個框都不用畫。**
現有的混合求解流程（如 HFSS Regions in SIwave）要工程師自己框出 3D 區域，
軟體才接手。本工具自動搜尋安全切面、逐段評估 3D 複雜度、自動決定哪一段給 HFSS。

**模型有錯不擋路：自動修復、留下審計鏈、照樣開跑。**
業界的 IBIS 檢查器只驗不修，驗出錯就把人擋在門外。本工具把有問題的模型修成一份
受管副本，記下修了什麼、蓋上 SHA-256 指紋，然後照樣開跑。

**TDR 看到劇變，Layout 上直接標給你——然後在那個位置虛擬剖一刀。**
業界的做法是拿距離數字回去對圖、再剖板確認。本工具把劇變換算成走線座標直接標在
Layout 上，劇變表逐列可一鍵取 Q2D 截面；[定位驗證](./validation/tdr/TDR_群延遲定位驗證報告.md)
平均誤差 0.66 mm。

**等化掃描單組 3 秒，完整模擬同一組合要 48～212 秒。**
Top-3 排名與完整模擬完全一致（抖動輕的組合 Spearman ρ＝0.86～0.90），
量化在 [26 組矩陣實測報告](./validation/ibis/秒級眼圖預測與完整模擬對照_20260829.md)。

**按一顆按鈕，證明這顆模型解得動——不是只過語法檢查。**
拿真實參考通道把模型實際解一次，配不起來的 Tx／Rx 組合在選單上當場停用。

前三項的「查無同類」依 2026 年 8 月對公開市售產品文件與文獻的查證。
查證不能證明全世界沒有，只能證明我們認真找過。

## 主要功能

| 功能 | 做什麼 |
|---|---|
| **通道裁切** | 依訊號 Net 裁出通道（貼合走線／凸包／矩形），另存新 EDB |
| **疊構更換／背鑽／清理** | 換板材對照、殘樁移除、移除電磁影響範圍外的銅箔 |
| **N 段分割＋混合求解** | 自動搜尋安全切面、逐段建議 HFSS 或 SIwave、刀線可拖曳微調 |
| **排程求解與串接** | 依序求解、匯出並驗證 Touchstone、自動串回完整通道 |
| **遠端求解包** | 打包丟到工作站跑，求解機只要裝 AEDT、不需要 Python |
| **IBIS 與眼圖** | 受管模型與 SHA-256、DDR 多埠時序裕度、IBIS-AMI 與等化掃描、從量測建 IBIS |
| **TDR 阻抗定位** | 劇變標回 Layout 走線；也吃示波器量測波形 |
| **截面阻抗（Q2D）** | 從 EDB 還原該處實際截面求阻抗，與 TDR 交叉對照 |
| **S 參數工具箱／IEEE COM** | 重正規化、換埠序、去嵌入；26 份標準組態的 COM 簽核 |
| **一鍵 HTML 報告** | 快照加品牌與結論，輸出單一自包含 HTML |

## 可以產出什麼

| 產出 | 內容 |
|---|---|
| **完整通道 S 參數** | `cascade_result.sNp` ＋ 串接摘要 JSON；IL／RL／NEXT／FEXT 曲線，可匯 Excel |
| **眼圖與時序裕度** | 眼圖、11 項眼圖量測、DDR Setup／Hold 裕度、Corner 掃描排序 |
| **等化建議** | Tx×Rx 全組合依統計眼高排名，可一鍵套進正式分析 |
| **阻抗定位** | Layout 走線上的劇變標記（寬度＝空間解析度）與劇變表 |
| **截面阻抗** | 逐導體單端與差分阻抗、沿線 Z₀(x) 剖面、側向收斂判定 |
| **HTML 報告** | 圖片內嵌的單一檔案，每張圖附 SHA-256 與來源資料表 |

![串接後 S 參數：單端／差動可切換](./graph/S參數展現_20260815.png)

![TDR 阻抗定位：劇變位置標回 Layout 走線](./graph/TDR_20260815.png)

![截面阻抗：剖視圖、可解性判定與截到的段](./graph/截面阻抗_剖視圖_20260816.png)

![一鍵產出的 HTML 報告](./graph/一鍵產出HTML報告_1_20260815.png)

## 加速手法都經過量化驗證

加速手法會**改動求解對象本身**，所以每一項都要回答：這樣做出來的結果，
跟整片解一次差多少？

| 手法 | 跟整片解的差距 | 前提 |
|---|---|---|
| 通道裁切 | **0.03 dB 內** | 縫合 Via 沒被切掉（切掉變 1.644 dB） |
| Layout 清理 | **0.021 dB 內** | 訊號與參考網路都保留 |
| 分段串接 | **0.1 dB 內** | **切面處有接地縫合**（缺少則 14.4 dB） |

**那個前提不是小字，是主詞。** 真實板上的微帶線通道切兩刀時，可用頻率上限只剩
1.35 GHz；而微帶線的根因不是縫合而是刀數——**補接地 Via 沒有用，該做的是少切幾刀**。

[全部驗證一覽（12 項，含 TDR、截面阻抗與秒級眼圖預測）](./validation/README.md)

## 環境需求與公開版限制

完整版需 64 位元 Windows 10／11、Ansys Electronics Desktop 2026.1、可用 License
與 Python 3.10／3.12。

本 Repository 僅含前端原始碼與已建置的 `dist`，**不包含後端原始碼與求解環境**。
圖片為 Demo／匿名化資料。

技術架構：React／TypeScript／Vite、FastAPI＋WebSocket、PyEDB、PyAEDT、scikit-rf。

## 技術合作與聲明

正式技術合作透過 Taiwan Auto-Design Co.（TADC）進行：
[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)｜[cadmen.com](https://www.cadmen.com/)

本 Repository 為 Jeff Hong 個人技術作品集之展示內容，非 TADC 官方帳號，
亦非 Ansys, Inc. 官方合作展示。Ansys、HFSS、SIwave 為 Ansys, Inc. 之商標。
