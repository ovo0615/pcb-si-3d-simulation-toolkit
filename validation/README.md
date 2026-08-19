# 驗證與研究

**每個子目錄是一項獨立驗證：有自己的測試件、可重跑的腳本與一份報告。**

報告只寫量到什麼、改了什麼。**結論不成立的也留著**，並在該目錄的 README 標明 ——
失敗的實驗跟成功的一樣是證據。

三項加速手法的核心結果：

| 手法 | 跟整片解的差距 |
|---|---|
| 通道裁切 | 0.03 dB 以內 |
| Layout 清理 | 0.021 dB 以內 |
| 分段串接 | 0.1 dB 以內（0～10 GHz） |

**三項共同指向同一個根因：切面與裁切邊界處參考平面的接地縫合狀況。**
縫合被切掉時，裁切變 1.6 dB、分段變 14.4 dB。這個條件已經寫成工具的自動檢查。

**上面那些數字的前提是自建試片、有縫合、一刀、0～10 GHz。那個前提不是小字，
是主詞。** 真實板上的**微帶線**通道切兩刀時，分段串接的**可用頻率上限只剩
1.35 GHz**——0～1 GHz 仍然差 0.040 dB，但 3 GHz 以上就長到 1.5 dB 以上。

**微帶線的根因不是縫合。** 縫合密度從半徑內 14 顆掃到 0 顆，偏差散布只有
**0.001 dB**；代價來自切開本身，隨刀數累加。**補 Via 沒有用，要少切幾刀。**
見[微帶線縫合密度驗證](stitch_density_microstrip/微帶線縫合密度驗證報告.md)
與[真實板全頻對照](segmentation/真實板全頻對照_20260817.md)。

## 方法類

| 目錄 | 問的問題 |
|---|---|
| [cutout](cutout/README.md) | 裁切出來的通道與整片板等不等效？ |
| [cleanup](cleanup/README.md) | Layout 清理有沒有動到電磁上重要的東西？ |
| [segmentation](segmentation/README.md) | 分段切板這個方法本身可不可信？ |

## 分段與求解器

這四項有一份共同總覽：[分段與求解器研究總覽](分段與求解器研究總覽.md)（[English](solver_and_segmentation_studies.md)）。

| 目錄 | 問的問題 |
|---|---|
| [solver_mix](solver_mix/README.md) | HFSS 自適應範圍該涵蓋到哪裡？（此目錄裝了兩件事，其中一件的結論不成立，先讀該目錄的 README） |
| [stitch_density](stitch_density/README.md) | 縫合 Via 間距要多密，切面才可信？ |
| [stitch_transfer](stitch_transfer/README.md) | λ/10 縫合規則能不能跨疊構？ |
| [stitch_density_microstrip](stitch_density_microstrip/README.md) | 微帶線的切面也要縫合嗎？（答案是不用，而且這一份推翻了我們自己前一天的歸因） |
| [solver_map](solver_map/README.md) | 哪些結構 SIwave 算得準？四種標準結構與收斂 HFSS 比對。 |

## 通道分析

| 目錄 | 問的問題 |
|---|---|
| [tdr](tdr/README.md) | TDR 標出來的位置對回 Layout 誤差多大？ |
| [cross_section](cross_section/README.md) | 從 EDB 重建的 Q2D 二維截面，算出來的阻抗跟同一條走線的 TDR 剖面對不對得起來？ |
| [ibis](ibis/README.md) | AEDT 的眼圖量測與判準位介面到底能問出什麼？ |

## 共通前提

- 驗證腳本一律重用產品程式碼，不另外重寫一份演算法。重寫的版本會驗證到一個沒有出貨的東西。
- 需要 Ansys Electronics Desktop 2026.1 與對應授權；各目錄的 README 列出該項另外需要的套件。

## 公開版沒有的部分

多埠通道串擾（`multi_lane`）與大批模型相容性掃描（`models_sweep`）這兩項驗證使用客戶提供的模型與 S 參數（實際客戶名稱與檔案路徑會出現在報告內文），因此不在公開版。上面的功能表列出了它們的結論數字，報告本身留在私有版。

`ibis` 目錄則用的是 AEDT 內建範例模型與合成測試件，不涉及客戶資料，因此已公開。
