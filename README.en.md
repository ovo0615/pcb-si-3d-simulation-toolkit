# PCB SI 3D Simulation Toolkit

English ｜ [繁體中文](README.zh-TW.md)

> Personal technical portfolio showcase. Not an official Ansys or Taiwan Auto-Design Co. (TADC) account. Ansys is a trademark of Ansys, Inc.

**Jeff Hong**｜Senior Technical Engineer, CAE｜Taiwan Auto-Design Co. (TADC)
[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)　[cadmen.com](https://www.cadmen.com/)

Takes one signal path on a PCB from board file all the way to an eye diagram.
Solving runs on Ansys HFSS 3D Layout and SIwave, driven through PyEDB and PyAEDT.

![N-way segmentation with per-segment solver assignment: green = SIwave, purple = HFSS](./graph/N段分割後推薦求解器示意_20260815.png)

## What nobody else ships

- **Whole-board automatic segmentation with per-segment solver assignment — you
  never draw a region.** Existing hybrid flows (such as HFSS Regions in SIwave)
  start with an engineer drawing the 3D regions by hand.
- **A broken model does not block you**: auto-repair into a managed copy, SHA-256
  audit trail, and the run goes on. Industry IBIS checkers validate but never fix.
- **TDR finds the discontinuity; the layout gets the marker** — then take a virtual
  cross-section right there. Location validation: mean error 0.66 mm.
- **EQ sweep at 3 seconds per setting** against 48–212 s for a full simulation,
  with the Top-3 ranking matching the full simulation exactly.
- **One button proves the model actually solves**, not merely that it parses.

The first three claims rest on an August 2026 survey of public product documentation
and literature. A survey cannot prove a negative; it proves we looked hard.

## Features and outputs

Channel cutout · stackup swap · backdrill · layout cleanup · N-way segmentation with
hybrid HFSS/SIwave solving · scheduled solve and cascade · remote solve package ·
IBIS and IBIS-AMI eye analysis with DDR timing margin and EQ sweep · build IBIS from
bench measurements · TDR impedance location (also accepts scope waveforms) ·
cross-section impedance (Q2D) · S-parameter toolbox and IEEE COM sign-off ·
one-click self-contained HTML report.

Outputs: full-channel S-parameters with IL/RL/NEXT/FEXT curves, eye diagrams with 11
eye measurements, DDR setup/hold margin, ranked equalization settings, discontinuity
markers on the layout trace, per-conductor impedance with Z₀(x) profile, and a single
HTML report where every figure carries a SHA-256 and its source data.

![Cascaded S-parameters](./graph/S參數展現_20260815.png)

![TDR impedance location mapped onto the layout trace](./graph/TDR_20260815.png)

## Every speed-up is quantitatively validated

Each speed-up **changes what is actually being solved**, so each has to answer: how
far does this land from solving the whole board once?

| Technique | Deviation from a full-board solve | Precondition |
|---|---|---|
| Channel cutout | Within **0.03 dB** | Stitching vias not cut away (1.644 dB if they are) |
| Layout cleanup | Within **0.021 dB** | Signal and reference nets kept |
| Segmented cascade | Within **0.1 dB** | **Ground stitching at the cut** (14.4 dB without it) |

**That precondition is the subject of the sentence, not a footnote.** On a real board
a microstrip channel cut twice has a usable upper limit of only 1.35 GHz — and there
the cause is the number of cuts, not stitching: **adding ground vias does not help.**

[All validations at a glance (12 items)](./validation/README.md) — reports are in
Traditional Chinese; the raw JSON and Touchstone data are language-neutral.

## Requirements

64-bit Windows 10/11, Ansys Electronics Desktop 2026.1 with an available license,
and Python 3.10 or 3.12. This repository contains only the front-end source and its
built `dist`, with **no back-end source and no solving environment**. Images use
demo/anonymized data.

Stack: React/TypeScript/Vite, FastAPI + WebSocket, PyEDB, PyAEDT, scikit-rf.

Step-by-step instructions: [操作說明](./操作說明.md) (Traditional Chinese, 12 chapters).

## Collaboration and notices

Formal technical collaboration goes through Taiwan Auto-Design Co. (TADC):
[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)｜[cadmen.com](https://www.cadmen.com/)

This repository is Jeff Hong's personal technical portfolio. It is not an official
TADC account, nor an official Ansys, Inc. collaboration. Ansys, HFSS and SIwave are
trademarks of Ansys, Inc.
