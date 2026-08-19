# Stitching Rule Transferability Across Stackups

λ/10 縫合規則能不能跨疊構？改變 εr 與板厚，檢驗預測是否仍然保守。

**結果：換板材、換板厚都仍然保守，五組全過。但餘裕不平均 —— 換板厚只剩 1.5～2.6%，
已接近量測雜訊。**

- [驗證報告（繁體中文）](跨疊構轉移性驗證報告.md)
- [四項研究總覽](../分段與求解器研究總覽.md)
- [English overview](../solver_and_segmentation_studies.md)

## 內容

| 路徑 | 說明 |
|---|---|
| `results/*.svg` / `*.png` | 圖表（SVG 供 GitHub、PNG 供手機檢視） |
| `results/*.json` | 機器可讀結果 |
| `results/touchstone/` | 匿名化原始 Touchstone |
| `build_and_run.py` | 建模、求解編排與分析 |

This repository is Jeff Hong's personal technical portfolio. It is not an official
product of Taiwan Auto-Design Co. (TADC) or Ansys, Inc. Ansys, HFSS and SIwave are
trademarks of Ansys, Inc.
