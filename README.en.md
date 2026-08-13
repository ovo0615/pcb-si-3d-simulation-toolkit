# PCB SI 3D Simulation Toolkit

[繁體中文](README.zh-TW.md) ｜ English

> This repository is the public showcase of a personal technical portfolio. It is not an official account of Taiwan Auto-Design Co. (TADC) and is not officially affiliated with Ansys, Inc. Ansys is a trademark of Ansys, Inc.

## 1. Positioning

**Jeff Hong**
CAE, Senior Technical Engineer
Taiwan Auto-Design Co. (TADC)

Contact: [jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)　Company: [https://www.cadmen.com/](https://www.cadmen.com/)

Focus: High-Frequency Electromagnetic Simulation & Engineering Automation

Core technologies: Ansys HFSS 3D Layout, PyEDB, PyAEDT, PCB Signal Integrity, S-parameter Analysis, Eye Diagram Analysis, Engineering GUI Automation.

> Reduce repetitive PCB signal-integrity preparation work and make high-frequency simulation workflows more visible, repeatable, and easier to operate.

## 2. Hero View

![N-way segmentation with per-segment solver assignment: green = SIwave, purple = HFSS, labels show complexity score](./graph/N段分割後推薦求解器示意_20260805.png)

The toolkit uses Ansys HFSS 3D Layout and SIwave, with PyEDB operating on the EDB, to unify PCB/package channel import, net selection, cutout, port creation, risk-aware segmentation, per-segment solving, and S-parameter cascading in one interface.

## 3. Engineering Problem

High-frequency PCB signal-integrity analysis usually requires engineers to repeat the same manual preparation: selecting the signal channel from a full board, building a cutout region around the selected nets, placing ports by hand at component ends, splitting long channels into segments when a single mesh would be too large to solve in reasonable time, and manually cascading the resulting S-parameters back into a full-channel response. These steps are slow and error-prone, especially for long channels. This toolkit automates that preparation and post-processing pipeline, then presents the cascaded result beside a full-board SIwave baseline so the segmentation strategy can be judged directly from the S-parameter differences.

### Every speed-up has to prove it does not cost accuracy

The techniques this toolkit uses to go faster — extracting only the channel, splitting a long channel into independently solved segments, assigning the cheaper solver where it is adequate — **all modify what is actually being solved**. Each therefore has to answer the same question first: how far does the result drift from simply solving the whole thing in one piece?

Four have been quantitatively validated so far, with raw data and failure cases published in full:

| Validation | Reference baseline | Result |
|---|---|---|
| [Channel cutout](./validation/cutout/cutout_validation_report.md) | The same coupon, uncut, solved directly | Insertion-loss deviation within **0.03 dB** (2–5 mm expansion) |
| [Layout cleanup](./validation/cleanup/cleanup_validation_report.md) | The same coupon, uncleaned, all clutter retained | Insertion-loss deviation within **0.021 dB** (four protection distances) |
| [Segmentation + circuit cascading](./validation/segmentation/segmentation_validation_report.md) | The same coupon, uncut, solved monolithically | Insertion-loss deviation within **0.1 dB (0–10 GHz)**; no point exceeds 0.5 dB |
| [TDR group-delay localization](./validation/tdr/TDR_group_delay_validation_report.md) | Geometric boundaries known at modelling time | **0.66 mm** mean localization error, **1.71 mm** maximum |

Segmentation is the toolkit's primary speed-up and also the one **most likely to damage accuracy**, because it cuts a complete channel apart and stitches it back together. The validation uses a purpose-built 38 mm, 50 Ω symmetric stripline coupon compared against its own uncut monolithic full-wave solve, and shows the two are all but indistinguishable under the right conditions.

All three validations deliberately include a **negative control** showing what failure looks like. More tellingly, the cutout and segmentation studies **independently converge on the same root cause**: accuracy is governed by whether the reference planes are ground-stitched at the cut or cutout boundary — not by expansion distance or cut angle. Without stitching, segmentation produces a **14 dB** artificial resonance and cutout a **1.6 dB** deviation; that condition is now an automatic check inside the toolkit, surfaced before the user solves.

The cutout study also includes a control that separates "narrow retained plane" from "stitching vias removed": same expansion, same retained width, **1.644 dB with the vias removed versus 0.039 dB with them kept — a 42× difference.**

The point of validation is not endorsement — it is finding where the method breaks and writing that boundary back into the tool.

All three speed-ups that modify what is being solved — cutout, cleanup and segmentation — now have quantified data, and they agree: **the only one needing care is ground stitching at the cut or cutout boundary**; everything else stays within 0.03 dB. Per-segment solver assignment remains unvalidated; that is a solver-equivalence question of a different nature and stays on the roadmap.

## 4. Feature Showcase

| Feature | Description | Status |
|---|---|---|
| Cutout & port creation | Auto region selection (ConvexHull / Bounding) by signal net, with Coax/Circuit port creation at component ends | ✅ Done |
| Layout cleanup | Removes copper, traces, and vias outside the channel's EM-relevant region, with preview before commit | ✅ Done |
| N-segment splitting | Searches cut planes along the channel's main axis and outputs N independent segment EDBs with stitching info | ✅ Done |
| Cut-safety visualization | Color-codes hard obstacles, risky traces, candidate cuts, and per-segment solver regions | ✅ Done |
| Mixed HFSS / SIwave solving | Recommends a solver from each segment's 3D EM complexity while allowing manual override | ✅ Done |
| Scheduled solving | Starts an isolated solver process for each segment and exports Touchstone | ✅ Done |
| Automatic S-parameter cascading | Cascades segments using the stitching info to reconstruct the full-channel S-parameters | ✅ Done |
| QuickEye diagram | Solves eye height/width directly from the cascaded Touchstone | ✅ Done |
| TDR impedance localization | Solves the TDR impedance profile and maps discontinuities back onto the layout traces | ✅ Done |
| External Touchstone cascading | Loads existing `.sNp` files with auto-suggested or manual port stitching | ✅ Done |
| Whole-channel solve | Solves the channel as a single piece with no splitting, as a baseline for the segmented result | ✅ Done |
| Remote solve pack | Packs the job into a folder the solver machine runs directly; no Python needed there | ✅ Done |
| One-click HTML report | Captures each result view, adds branding, captions, and acceptance criteria, and emits one self-contained HTML | ✅ Done |

### Segmentation Color Language

The segmentation view overlays the engineering decision directly on the complete layout. Safety and solver-region overlays can be disabled independently whenever the underlying routing needs to remain unobstructed.

| Color / line style | Meaning |
|---|---|
| Glowing orange trace | Angled routing or corner-risk corridor that a cut should avoid. |
| Translucent red area / faint red dashed line | Hard keep-out obstacle or rejected cut candidate. |
| Solid cyan line | Selected cut plane that passed the checks. |
| Gray dashed line | Ideal equal-division location before obstacle checks. |
| Green region / label | Segment assigned to SIwave. |
| Purple region / label | Segment assigned to HFSS 3D Layout. |

## 5. Workflow

Import → Select Nets → Cutout → Port → Segment → Solve → Analyze

![Task picker with enlarged title and task icons; the UI shows only selected panels](./graph/入口畫面_20260810.png)

![Full board layout with the layer panel](./graph/完整板Layout_20260809.png)

![Cutout layout: only the target channel and its component-side ports remain](./graph/裁切後Layout_20260809.png)

![N-way split preview with safety overlay](./graph/N段分割示意_20260805.png)

![Per-segment HFSS/SIwave recommendation, assignment, and rationale](./graph/混合求解設定_20260805.png)

![Overview: cut lines with the per-segment solver assignment](./graph/分段整體視圖_20260809.png)

![Mixed-solver schedule running: segment 1 on HFSS, segment 2 finished on SIwave, segment 3 queued](./graph/混合排程模擬過程_20260805-public.png)

![Automatic S-parameter cascade circuit](./graph/串接電路示意圖_20260809.png)

![Cascaded S-parameters: single-ended/differential, insertion/return loss, and near/far-end crosstalk](./graph/S參數展現_20260810.png)

![QuickEye diagram with eye height/width](./graph/QuickEye眼圖_20260809-public.png)

![TDR impedance localization: discontinuities mapped back onto the layout traces, with peak table and Z(distance) curve](./graph/TDR_20260810.png)

### Quantitative validation of TDR group-delay localization

The toolkit infers effective propagation velocity from S21 group delay and converts TDR round-trip time into routed distance. Six anonymized SIwave cases cover a uniform control, widened and narrowed sections, multiple discontinuities, 45-degree bends, and the spatial-resolution limit. All five resolvable cases passed, with a **0.66 mm** mean error and a **1.71 mm** maximum error.

[Open the full English validation report, HTML plots, JSON, and anonymized Touchstone data](./validation/tdr/TDR_group_delay_validation_report.md)

![TDR group-delay localization validation report preview](./validation/tdr/results/TDR_定位驗證報告_預覽.png)

### Quantified validation of the channel segmentation method

The toolkit's core method splits a long channel into segments, solves each independently, and cascades them back together. A purpose-built 38 mm, 50 Ω symmetric stripline coupon was compared against its own monolithic full-wave solve: with the reference planes **stitched** at the cut, cascading reproduces the monolithic result to within **0.1 dB (0–10 GHz)**; **without stitching**, the same cut deviates by **14.4 dB**. The validation includes a negative control that shows what failure looks like.

[Open the full English validation report, variant schematics, JSON, and anonymized Touchstone data](./validation/segmentation/segmentation_validation_report.md)

![Validation coupon and variants](./validation/segmentation/results/segmentation_variants.svg)

![Segmentation validation overview](./validation/segmentation/results/segmentation_validation_overview.svg)

### Quantified validation of channel cutout equivalence

Extracting only the signal channel from a full board is the toolkit's first speed-up. A 40 × 20 mm stripline coupon was compared against its own uncut baseline: **the expansion distance itself barely matters** (5 mm, 3 mm and 2 mm give 0.017, 0.017 and 0.027 dB). What actually breaks the result is a cutout that **removes the ground stitching vias** — same expansion, same retained plane width, **1.644 dB with the vias removed versus 0.039 dB with them kept, a 42× difference**.

[Open the full English validation report, variant schematics, JSON, and anonymized Touchstone data](./validation/cutout/cutout_validation_report.md)

![Cutout validation coupon and variants](./validation/cutout/results/cutout_variants.svg)

![Cutout validation overview](./validation/cutout/results/cutout_validation_overview.svg)

### The tool's numerics are still being improved

Validation is not only about showing the current behaviour is good enough — it
is also how the weak points get found. Four studies in August 2026 examined two
decisions inside the tool that had never been quantitatively validated (how cut
quality is judged, and how solvers are assigned). They surfaced three real
problems, all since fixed:

| Finding | Change made |
|---|---|
| The HFSS adaptive default **under-reported loss by 3.2 dB** at the top of the sweep | Adaptive range now spans the whole sweep |
| Cut-quality checking passed a cut with **21.9 dB cascade error** | Replaced with a spacing-to-usable-frequency rule, verified with two solvers across five stackups |
| Trace bends were treated as complexity, sending segments to HFSS that SIwave handles fine (120× slower) | Bend count no longer raises the complexity score |

[English overview](./validation/solver_and_segmentation_studies.md) ｜ [繁體中文總覽](./validation/分段與求解器研究總覽.md)

Raw data, the failed coupon revisions, and the process of overturning our own
earlier conclusions are all published.

### Quantified validation of layout-cleanup equivalence

Cleanup deletes foreign-net copper outside the channel's EM-relevant region. A 40 × 20 mm stripline coupon with four pairs of floating clutter traces (±0.5 to ±8.0 mm from the channel) was compared against its uncleaned baseline: **all four protection distances stay within 0.021 dB with no trend** — even removing clutter only 0.5 mm away. Cleanup protects the signal and reference nets, so the return path is never touched.

[Open the full English validation report, variant schematics, JSON, and anonymized Touchstone data](./validation/cleanup/cleanup_validation_report.md)

![Cleanup validation coupon and variants](./validation/cleanup/results/cleanup_variants.svg)

![Cleanup validation overview](./validation/cleanup/results/cleanup_validation_overview.svg)

![One-click HTML report: company branding, purpose, and result summary](./graph/一鍵產出HTML報告_1_20260810.png)

## 6. Technical Architecture

- Frontend: React, TypeScript, Vite — 2D PCB layout viewer with zoom/pan, layer toggles, and port markers
- Backend: FastAPI + WebSocket for live system logs
- Geometry/data layer: PyEDB (EDB read/write, cutout, ports, cleanup, segmentation)
- Solve layer: PyAEDT driving Ansys HFSS 3D Layout / SIwave for meshing and EM solving
- Post-processing: scikit-rf for Touchstone I/O, cascading, and S-parameter math

## 7. Windows Usage

This public repository contains only the frontend source and the prebuilt `web_app/frontend/dist`, so you can inspect the interface and the workflow screenshots directly. The **full runnable version** (FastAPI backend, PyEDB/PyAEDT integration, and a one-click `start.bat` launcher) is maintained in a private repository, made available through TADC technical engagements. The public repo exists to demonstrate the workflow and results, not to provide a standalone solve environment.

## 8. Ansys License & Environment Requirements

Running the full version requires 64-bit Windows 10/11, Ansys Electronics Desktop (currently pinned to 2026.1), valid AEDT/HFSS 3D Layout/SIwave licenses, and a tested 64-bit Python 3.10 or 3.12 runtime. Scheduled solving cannot start without a valid license.

## 9. Public Showcase Scope

- Only the frontend UI and generated workflow/result screenshots are included; backend source and the solve environment are not.
- Screenshots use demo/anonymized data; local and solver-output absolute paths have been removed.
- Net names (e.g. `ST_CTL` / `ST_ERROR`) and component references are demonstration naming, not identifying information from a specific customer project.
- The scope of the full source and feature set follows the private repository's collaboration terms.

## 10. Collaboration

Formal technical collaboration and services are conducted through Taiwan Auto-Design Co. (TADC) using company-provided Ansys resources and licenses. For the full toolkit, technical collaboration, or a customized deployment, contact jeff.hong@cadmen.com or visit https://www.cadmen.com/.

## 11. Copyright & Trademark Notice

This repository is Jeff Hong's personal technical portfolio and showcase content. It is not an official account of Taiwan Auto-Design Co. (TADC), nor an official Ansys, Inc. collaboration showcase. Ansys, HFSS, and SIwave are trademarks of Ansys, Inc. Unless otherwise noted, content here is for technical demonstration only and does not constitute a direct commercial license.
