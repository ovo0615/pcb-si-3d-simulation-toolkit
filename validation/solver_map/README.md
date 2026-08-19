# SIwave Applicability Map

哪些結構 SIwave 算得準？四種標準結構各自與收斂 HFSS 比對。

**結果：決定準不準的是回流路徑有沒有被破壞，不是幾何有多複雜。**
平面內的走線 SIwave 到 20 GHz 都行、還快 120 倍；開路殘段只撐到 7.1 GHz。

- [驗證報告（繁體中文）](SIwave適用性地圖.md)
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
