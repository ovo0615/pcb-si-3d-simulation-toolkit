# Channel Cutout Equivalence Validation

Choose your language／選擇語言：

- [繁體中文驗證報告](通道裁切等效性驗證報告.md)
- [English validation report](cutout_validation_report.md)

This folder contains static evidence for the toolkit's first speed-up: extracting
only the signal channel from a full board instead of solving the whole board. A
40 × 20 mm stripline coupon is compared against its own uncut baseline across four
expansion distances, plus a control experiment that separates "narrow retained
plane" from "stitching vias removed".

本資料夾收錄工具第一項加速手法（從完整板只取出訊號通道求解）的靜態驗證證據：
以 40 × 20 mm Stripline 試片對照同一片不裁切的基準，掃描四種擴張距離，
並附一組把「保留平面變窄」與「縫合 Via 被切掉」兩個變因拆開的控制實驗。

**Headline result／核心結果**

> Expansion distance barely matters — 2 mm and 5 mm differ by 0.01 dB. What breaks
> the result is a cutout that removes the ground stitching vias: same expansion,
> same retained plane width, **1.644 dB with vias removed vs 0.039 dB with vias
> kept — a 42× difference.**
>
> 擴張距離本身幾乎不影響結果——2 mm 與 5 mm 只差 0.01 dB。真正會出事的是裁切
> 範圍把接地縫合 Via 切掉：同樣擴張、同樣保留寬度，**Via 被切掉 1.644 dB、
> Via 保留 0.039 dB，相差 42 倍。**

![Cutout validation coupon and variants／裁切驗證試片與變體示意](results/cutout_variants.svg)

![Cutout validation overview／裁切等效性驗證總覽](results/cutout_validation_overview.svg)

## Contents／內容

| Path | Description／說明 |
|---|---|
| `results/cutout_variants.svg` | Coupon and variant schematic／試片與變體示意 |
| `results/cutout_validation_overview.svg` | Result overview／結果總覽 |
| `results/cutout_validation_results.json` | Machine-readable results／機器可讀結果 |
| `results/touchstone/` | Raw Touchstone files／原始 Touchstone |

## Related／相關驗證

- [Channel segmentation method validation／分段切板方法驗證](../segmentation/README.md)
  — same root cause: reference-plane stitching dominates accuracy.

> 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

This is Jeff Hong's personal technical portfolio. It is not an official account of
Taiwan Auto-Design Co.（TADC）and is not officially affiliated with Ansys, Inc.
Ansys, HFSS and SIwave are trademarks of Ansys, Inc.
