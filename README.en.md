# PCB SI 3D Simulation Toolkit

English ｜ [繁體中文](README.zh-TW.md)

> Commercial licensing and technical support are provided by Taiwan Auto-Design Co. (TADC).
> This tool is not affiliated with, nor endorsed by, Ansys, Inc. Ansys is a trademark of Ansys, Inc.
> A valid Ansys AEDT licence of your own is required.

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

## Commercial licensing and notices

**Commercial licensing, quotations and technical support are provided by
Taiwan Auto-Design Co. (TADC):**
[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)｜[cadmen.com](https://www.cadmen.com/)

This repository is the public showcase edition, maintained by the author. It is not an
official Ansys, Inc. account, nor an official Ansys collaboration. This tool is not
affiliated with, nor endorsed by, Ansys, Inc. Ansys, HFSS, SIwave, Q3D and Q2D are
trademarks of Ansys, Inc.

**A valid Ansys AEDT (HFSS / SIwave / Q2D) licence of your own is required.** This tool
neither includes nor provides a licence, and never bypasses Ansys licensing; every solve
calls the AEDT installation on your own machine.

### Terms for running third-party model libraries

IBIS-AMI models carry native libraries (`.dll` / `.ami`) that AEDT executes on your
machine. Before the first trust is established in the model library, the tool asks you
to acknowledge four points:

1. The tool hands **the files you supply** to Ansys AEDT for execution on this machine.
   Their provenance, correctness and licensing are your responsibility.
2. The tool scans with Windows Defender, records the SHA-256, and refuses libraries whose
   format it cannot identify. **This is provenance tracking, not a safety guarantee** —
   the tool makes no warranty about third-party model behaviour.
3. Models stay on the local machine and are never uploaded (see ADR-0021).
4. Managed copies in the model library must not be redistributed beyond the terms you
   hold with the model vendor.

### Auto-repair is inference, not measurement

Two of the repairs applied on import are inferences. They are listed one by one in the
report's "Warnings and Limitations" section; confirm them before delivery.

| Inference | Rule | If you disagree |
|---|---|---|
| A missing conductor material is treated as copper | Refused when the name looks like aluminium, gold, silver, nickel, tin or a resistive layer | Define the material yourself in the AEDT material library |
| A missing `[Model Selector]` is generated | Only when every model in the same-prefix family shares one `Model_type`; otherwise nothing is changed and the case is reported as needing your decision | Add the `[Model Selector]` yourself, or reference the correct model name |
