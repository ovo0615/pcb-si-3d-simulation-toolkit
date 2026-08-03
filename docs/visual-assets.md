# Visual asset plan

This document tracks the public visual assets used by the project README.

## Currently approved for public display

- `graph/N段分割示意_20260730.png` — channel segmentation overview
- `graph/自動串接電路_20260730.png` — automated cascade schematic
- `graph/可信度驗證_20260730.png` — SIwave fidelity verification controls
- `graph/裁切後比對_20260730.png` — cutout before/after comparison
- `graph/指定裁切區_20260730-public.png` — local filesystem path redacted from the cutout-region screenshot
- `graph/眼圖結果_20260730-public.png` — local filesystem path redacted from the Eye Diagram result
- `graph/可信度驗證結果_20260730-public.png` — local filesystem path redacted from the fidelity report
- `graph/SIwave排程模擬過程_20260730-public.png` — local filesystem path redacted from the scheduled-solve progress screenshot
- `graph/10段SIwave排程模擬過程_20260803.png` — anonymized ten-segment SIwave queue progress
- `graph/10段分割正在裁切中_20260803.png` — blurred ten-segment cutout progress overlay
- `graph/10段分割示意_20260803.png` — Demo-board ten-segment solver-region overview
- `graph/混合求解設定_20260803.png` — per-segment HFSS／SIwave selection controls
- `graph/分段對照結果_20260803-public.png` — current objective S-parameter comparison with local paths removed

None of the images referenced by the README show local filesystem paths or customer identifiers.
Review Ansys/CADMEN branding separately before using any image that contains a vendor or company logo.

## History note

The original (unredacted) versions of the four `-public` images above briefly contained this
machine's local filesystem path (`D:\...`) and were removed from the entire git history of this
repository via `git filter-repo` + a force-push. Do not re-add the non-suffixed original files
for those four screenshots.

The obsolete `10段可信度驗證結果_20260803.png` and the unredacted
`分段對照結果_20260803.png` are retained only in the private repository. Do not add them
to this public repository: the former shows the retired score-based UI, and both contain
local workspace paths.

## Recommended future captures

1. Clean hero screenshot of the main PCB SI interface.
2. Clean 3D PCB layout screenshot.
3. End-to-end workflow diagram: Import → Select Nets → Cutout → Port → Segment → Solve → Analyze.

Use Demo or anonymized data only. Store future README images under `graph/` or `docs/images/` and reference them with repository-relative paths.
