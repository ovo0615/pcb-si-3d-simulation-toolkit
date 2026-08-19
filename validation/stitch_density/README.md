# Cut-Plane Stitching Density Validation

縫合 Via 間距要多密，切面才可信？固定幾何、只改間距，量分段串接與整片求解的偏差。

**結果：工具原本的規則會放行誤差 21.9 dB 的切面。已改成「縫合間距 ≤ 十分之一波長」。**

- [驗證報告（繁體中文）](切面縫合密度驗證報告.md)
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
