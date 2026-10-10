# PCB SI 3D Simulation Toolkit

![Current task picker in the tool window, with no board loaded](graph/gui-01-task-picker.png)

Extract and solve a PCB signal channel, cascade its segments, and inspect eye diagrams, TDR locations and cross-section impedance as needed.

**This public repository contains front-end assets, documentation and demonstration data. It has no back end, launcher or Ansys licence.** Its Source ZIP cannot run the complete workflow. For the complete tool and commercial support, contact [TADC](https://www.cadmen.com/) or [jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com).

## Features and manual

| Task | Chapter |
|---|---|
| Net selection, cutout, stackup, backdrill and Layout cleanup | [02](docs/manual/02-載入與裁切.md) |
| Endpoint ports, profiles and frequency sweeps | [03](docs/manual/03-Port與求解設定.md) |
| Whole-board or segmented analysis, HFSS/SIwave assignment | [04](docs/manual/04-分段與混合求解.md) |
| Scheduling, stopping, export retries and Touchstone cascading | [05](docs/manual/05-排程與串接.md) |
| Model import, multi-port IBIS, AMI and eye diagrams | [06](docs/manual/06-IBIS與眼圖.md) |
| Simulated or measured TDR mapped to Layout | [07](docs/manual/07-TDR定位.md) |
| 2D cross-section impedance and lateral convergence | [08](docs/manual/08-截面阻抗.md) |
| Snapshots, watermarks and a single-file HTML report | [09](docs/manual/09-報告與輸出.md) |
| External channels, remote solve packages, S-parameter tools and COM | [10](docs/manual/10-其他工作模式.md) |

## Complete-tool prerequisites

| Component | Purpose and installation |
|---|---|
| Windows 10/11 x64 | Runs the complete tool |
| Ansys Electronics Desktop 2026 R1 (2026.1) and applicable licences | EDB operations and selected solvers; install and license separately |
| Python 3.12 x64 | Required by the native distribution; source packages also accept 3.10. Follow launcher installation prompts; install first for offline use |
| Microsoft Edge WebView2 Runtime | Default desktop window; the launcher falls back to a browser if unavailable |
| Locked backend dependencies and pywebview supplied with the tool | Installed by `start.bat` into separate environments; do not upgrade independently |
| IBIS/AMI models or measurement data (optional) | Eye and measurement analysis; verify usage and redistribution rights |

Ordinary use does not require Node.js. Front-end source changes require Node.js/npm and installation according to the supplied `package.json` and lockfile.

## First result

Obtain the complete tool → run `web_app/start.bat` → select tasks → load a demo board → select signal/reference nets → cut out and preprocess → create ports → choose whole-board or segmented analysis → solve and validate Touchstone → cascade → update report snapshots.

Follow [00 First run](docs/manual/00-第一次跑.md). Eye analysis has a separate [chapter 06](docs/manual/06-IBIS與眼圖.md). There is no fixed completion-time guarantee. The detailed manual is in Traditional Chinese.

## Usage boundaries

| Item | Required check |
|---|---|
| Ports/results | Solver completion does not prove a valid export; verify port count/order, frequencies and provenance |
| Stopping SIwave | Wait for the current segment to finish; discard its result. A new schedule cannot start while stopping |
| Model DLLs | Execute locally. Scanning, SHA-256 and trust records do not guarantee safety. User-supplied managed copies remain subject to vendor licensing |
| Repairs and assumptions | Read warnings about inferred materials or Model Selectors; assumptions are not measurements |
| Reports/support bundles | Check paths, models, logs and identifiers before sending. Watermarks are not DRM |
| 2D Q2D | Does not cover the complete 3D effects of vias, corners or reference-plane gaps |

Draft documentation targets `1.0.0-rc.1`, feature baseline `a19eda7`. The status of all 35 main screenshots has been recorded, with 3 missing items. 5 conditional screenshots and distribution-package acceptance remain pending. [Release notes](CHANGELOG.md) · [Image register](docs/visual-assets.md) · [Validation](validation/README.md) · [Troubleshooting](docs/manual/11-疑難排解.md). Historical validation supports only its recorded versions, data and conditions.

Commercial licensing and support are provided by Taiwan Auto-Design Co., Ltd. (TADC). This independent showcase is not affiliated with or endorsed by Ansys, Inc. Trademarks belong to their respective owners. The tool does not include, provide or bypass Ansys licensing.
