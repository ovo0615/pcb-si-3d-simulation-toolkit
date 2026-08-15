# 驗證與研究

此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

每個子目錄是一項獨立驗證：有自己的測試件、可重跑的腳本與一份報告。報告只寫量到什麼、改了什麼，結論不成立的也留著並在該目錄的 README 標明。

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
| [solver_map](solver_map/README.md) | 哪些結構 SIwave 算得準？四種標準結構與收斂 HFSS 比對。 |

## 通道分析

| 目錄 | 問的問題 |
|---|---|
| [tdr](tdr/README.md) | TDR 標出來的位置對回 Layout 誤差多大？ |

## 共通前提

- 驗證腳本一律重用產品程式碼，不另外重寫一份演算法。重寫的版本會驗證到一個沒有出貨的東西。
- 需要 Ansys Electronics Desktop 2026.1 與對應授權；各目錄的 README 列出該項另外需要的套件。

## 公開版沒有的部分

IBIS／IBIS-AMI 通道、多埠通道串擾與大批模型相容性掃描這三項驗證使用客戶提供的模型與 S 參數，因此不在公開版。README 的功能表列出了那些驗證的結論數字，報告本身留在私有版。
