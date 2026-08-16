# Channel Segmentation Method Validation

Choose your language／選擇語言：

- [繁體中文驗證報告](分段切板方法驗證報告.md)
- [English validation report](segmentation_validation_report.md)

操作步驟／How to run it：[操作說明 第 4 章〈分段與混合求解〉](../../docs/manual/04-分段與混合求解.md)與[第 5 章 → 電路串接](../../docs/manual/05-排程與串接.md#電路串接)

**Headline result／核心結果**

> With the reference planes stitched at the cut, cascading reproduces the
> monolithic full-wave solve to within **0.1 dB (0–10 GHz)**. Without stitching,
> the same cut deviates by **14.4 dB**.
>
> 切面處的參考平面有接地縫合時，分段串接可重現單體全波求解至 **0.1 dB 以內
> （0～10 GHz）**；缺少縫合時，同一切點的偏差達 **14.4 dB**。


This folder contains static evidence for the toolkit's core method — splitting a
long channel into segments, solving each independently, and cascading them back
into a full-channel S-parameter response. A purpose-built 38 mm 50 Ω stripline
coupon is compared against its own monolithic full-wave solve, with a negative
control that shows what failure looks like.

本資料夾收錄工具核心方法（長通道分段切割、逐段求解、電路串接還原）的靜態驗證
證據：以自建的 38 mm 50 Ω Stripline 試片，對照同一片不切割的單體全波求解，
並附上呈現方法失效樣貌的負控制組。

![Validation coupon and variants／驗證試片與變體示意](results/segmentation_variants.svg)

![Segmentation validation overview／分段切板方法驗證總覽](results/segmentation_validation_overview.svg)

## Contents／內容

| Path | Description／說明 |
|---|---|
| `results/segmentation_variants.svg` | Coupon and variant schematic／試片與變體示意 |
| `results/segmentation_validation_overview.svg` | Result overview／結果總覽 |
| `results/segmentation_deviation_charts.png` | Deviation curves／偏差曲線 |
| `results/segmentation_unstitched_artifact.png` | Artefact detail without stitching／無縫合時的假諧振細節 |
| `results/segmentation_validation_results.json` | Machine-readable results／機器可讀結果 |
| `results/touchstone/` | Raw Touchstone files／原始 Touchstone |

> 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

This is Jeff Hong's personal technical portfolio. It is not an official account of
Taiwan Auto-Design Co.（TADC）and is not officially affiliated with Ansys, Inc.
Ansys, HFSS and SIwave are trademarks of Ansys, Inc.
