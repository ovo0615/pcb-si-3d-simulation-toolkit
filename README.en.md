# PCB SI 3D Simulation Toolkit

English ｜ [繁體中文](README.zh-TW.md)

> Personal technical portfolio showcase. Not an official Ansys or Taiwan Auto-Design Co. (TADC) account. Ansys is a trademark of Ansys, Inc.

**Jeff Hong**｜Senior Technical Engineer, CAE｜Taiwan Auto-Design Co. (TADC)
[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)　[cadmen.com](https://www.cadmen.com/)

Consolidates PCB and package channel import, cutout, port creation, segmented solving and S-parameter cascading into a single workflow. Solving runs on Ansys HFSS 3D Layout and SIwave, driven through PyEDB and PyAEDT.

![N-way segmentation with per-segment solver assignment: green = SIwave, purple = HFSS, labels show complexity score](./graph/N段分割後推薦求解器示意_20260815.png)

## Features and the experiments that validate them

Every speed-up **changes what is actually being solved**, so each one has to answer the same question first: how far does this land from solving the whole board once?

| Feature | Why it needs validation | Experiment and result |
|---|---|---|
| **Channel cutout** | Does extracting only the channel change the result? | Within **0.03 dB**; but cutting away stitching vias makes it 1.644 dB, a **42× difference**. [Report](./validation/cutout/cutout_validation_report.md) |
| **Layout cleanup** | Does removing foreign-net copper affect the channel? | All four protection distances within **0.021 dB, no trend**. [Report](./validation/cleanup/cleanup_validation_report.md) |
| **N-way segmentation** + cascade | Does cutting and reassembling distort the result? | Within **0.1 dB** when stitching is adequate; **14.4 dB** spurious resonance without it. [Report](./validation/segmentation/segmentation_validation_report.md) |
| **Cut-quality gating** | The threshold was originally engineering judgement | The old rule passed a cut with **21.9 dB cascade error** → replaced by "spacing → usable frequency". [Report](./validation/stitch_density/切面縫合密度驗證報告.md) |
| **Mixed-solver assignment** | Which structures does SIwave handle accurately? | Straight runs and bends are **trustworthy full-band and 120× faster**; **open stubs only to 7.1 GHz**. [Report](./validation/solver_map/SIwave適用性地圖.md) |
| **Solver default settings** | Is the default adaptive range trustworthy at the sweep top? | The old default **under-reported loss by 3.2 dB**; now spans the whole sweep. [Report](./validation/solver_mix/自適應範圍驗證報告.md) |
| **TDR impedance location** | How accurately does time convert to trace distance? | Mean error **0.66 mm**, worst **1.71 mm**. [Report](./validation/tdr/TDR_群延遲定位驗證報告.md) |
| **Cross-section impedance (Q2D)** | How far is the idealised cross-section from the real geometry? | The section is rebuilt from what is **actually there** in the EDB. Six positions along one trace, against SIwave to TDR on the same trace: median 48.617 Ω versus 48.625 Ω, a **median difference of −0.015%**. [Report](./validation/cross_section/Q2D截面與TDR對照驗證報告.md) |
| **IBIS / IBIS-AMI eye analysis** | — | Managed models with SHA-256 trust; QuickEye/Transient and AMI Statistical/GetWave; an S4P can be declared as differential or as two single-ended lanes that retain crosstalk |
| **Multi-port crosstalk** | How long must a random pattern run before it hits the worst alignment? | A deterministic worst-case pattern needs **128 UI / 3.1 s**, against 20,000 UI / 116.6 s for random. The deterministic one makes every lane hit its worst case **once for certain**; the random one only expects 1.22 occurrences |
| **Bus direction** | An eye measured in the wrong direction looks completely normal | Derived lane by lane from the IBIS `Model_type`. When both sides can drive, the user must choose; the tool supplies no default |
| **Stackup replacement** | Can replacing a stackup silently delete layers? | Differences are shown first with the to-be-deleted layers marked, and nothing is written until confirmed. The EtchFactor that `load()` drops is restored separately |
| **Backdrill** | Is the stub length right? | Connectivity decides which layers the signal actually enters and leaves. Two independent signals each back out the stackup average Dk from their measured notch, agreeing within **1.0%** |
| Other | — | Cut-safety visualisation, scheduled solving, external Touchstone cascading, whole-board reference solve, remote solve package, channel-model preflight, one-click HTML report |

Several independent validations point at the **same root cause**: accuracy is governed by **reference-plane ground stitching** at the cut or cutout boundary, not by expansion distance or cut angle. That condition is now an automatic check inside the tool.

Validation is also used to **find our own problems**: the last three rows above came from exactly that. Negative controls, failed coupon revisions, and the process of overturning our own earlier conclusions are all published; what remains unvalidated or uncalibrated is stated in the reports.

[Study overview](./validation/solver_and_segmentation_studies.md)｜[繁體中文總覽](./validation/分段與求解器研究總覽.md)

## Workflow

Import → Select Nets → Cutout → Port → Segment → Solve → Analyze

![Entry screen](./graph/入口畫面_20260815.png)

![Full board layout with the layer panel](./graph/完整板Layout_20260815.png)

![After cutout: only the target channel and its component-end ports remain](./graph/裁切後Layout_20260815.png)

![N-way segmentation preview with the safety overlay](./graph/N段分割示意_20260815.png)

![Per-segment HFSS/SIwave recommendation and its reasoning](./graph/混合求解設定_20260815.png)

![Solve schedule running: the solver-region table with each segment stage and elapsed time](./graph/SIwave模擬過程_20260815.png)

![Cascaded S-parameters, switchable between single-ended and differential](./graph/S參數展現_20260815.png)

![QuickEye eye diagram with eye height and width](./graph/QuickEye眼圖_20260809-public.png)

![TDR impedance location mapped back onto the layout trace](./graph/TDR_20260815.png)

![Cross-section view, solvability verdict and the segments the cut line hit](./graph/截面阻抗_剖視圖_20260816.png)

![One-click HTML report](./graph/一鍵產出HTML報告_1_20260815.png)

The segmentation view overlays the safety judgement directly on the layout: orange marks risky traces, red marks hard no-cut obstacles, cyan is the adopted cut, and green and purple are SIwave and HFSS segments.

Step-by-step instructions are in the [user manual](./操作說明.md) (eleven chapters, in Traditional Chinese, covering cutout, ports, segmentation, scheduling, IBIS eye analysis, TDR, cross-section impedance and troubleshooting).

## Technical stack

React/TypeScript/Vite front end, FastAPI + WebSocket back end, PyEDB geometry layer, PyAEDT driving HFSS 3D Layout and SIwave, scikit-rf post-processing.

## Requirements and showcase limitations

The full version requires 64-bit Windows 10/11, Ansys Electronics Desktop 2026.1, an available license, and Python 3.10 or 3.12.

This repository contains only the front-end source and its built `dist`, with **no back-end source and no solving environment**. Images use demo/anonymized data; net names and reference designators are illustrative.

## Collaboration and notices

Formal technical collaboration goes through Taiwan Auto-Design Co. (TADC): [jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)｜[cadmen.com](https://www.cadmen.com/)

This repository is Jeff Hong's personal technical portfolio. It is not an official TADC account, nor an official Ansys, Inc. collaboration. Ansys, HFSS and SIwave are trademarks of Ansys, Inc.
