# PCB SI 3D Simulation Toolkit

## High-Frequency PCB Simulation Workflow Automation

## 高頻 PCB 模擬流程自動化

PCB SI 3D Simulation Toolkit is a visual engineering showcase for PCB layout inspection, 3D visualization, signal-net selection, port preparation, and S-parameter analysis workflows.

PCB SI 3D Simulation Toolkit 是一套高頻 PCB 工程展示工具，聚焦於 PCB Layout 檢視、2D/3D 視覺化、訊號網路選取、Port 準備，以及 S 參數分析流程。

> This public repository is a demonstration edition. Private solver integration and company-specific implementation details are intentionally excluded.

## Why this project exists

## 為什麼建立這個專案

PCB signal-integrity analysis often involves repetitive layout inspection, net selection, geometry preparation, port definition, simulation setup, and result interpretation. This project explores how those steps can be organized into a more visible and repeatable engineering workflow.

PCB 訊號完整性分析通常包含大量重複工作，例如 Layout 檢查、網路選取、幾何準備、Port 定義、模擬設定與結果判讀。本專案嘗試將這些步驟整理成更直觀、可重複的工程流程。

## Highlights

## 主要功能

- 2D PCB layout and layer visualization
- 3D board preview
- Signal and reference-net selection
- Port marker visualization
- S-parameter analysis interface
- Engineering-oriented dark UI
- 工程導向的深色操作介面

## Technology

## 使用技術

- React / TypeScript / Vite
- FastAPI showcase integration
- Ansys HFSS 3D Layout concepts
- PyAEDT / EDB workflow concepts

## Public demonstration scope

## 公開展示版範圍

The public edition focuses on the front-end experience, workflow visualization, and documentation. Company-specific back-end implementations, private solver orchestration, customer data, internal file paths, and licensed Ansys execution environments are not included.

公開版本以前端體驗、流程視覺化與操作文件為主，不包含公司專屬後端實作、私人求解器排程、客戶資料、內部檔案路徑，以及需要授權才能執行的 Ansys 模擬環境。

## Getting started

## 開始使用

See [操作說明.md](操作說明.md) for the current demonstration workflow and supported capabilities.

目前的展示流程與支援功能，請參考[操作說明](操作說明.md)。

## Collaboration and services

## 技術合作與服務

For custom PCB signal-integrity or HFSS/SIwave automation projects, contact Jeff Hong through [Taiwan Auto-Design Co. (TADC)](https://www.cadmen.com/) at [jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com).

如需客製化 PCB 訊號完整性、HFSS 或 SIwave 自動化工具，請透過[虎門科技](https://www.cadmen.com/)聯絡 Jeff Hong： [jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)。

## Ownership and trademarks

## 著作權與商標聲明

Source code and visual assets are provided for demonstration purposes only. Commercial use, redistribution, and derivative works require permission.

本專案原始碼與視覺素材僅供展示用途。商業使用、再散布與衍生作品均須事先取得許可。

Ansys is a trademark of Ansys, Inc. This project is an independent technical portfolio and is not officially affiliated with Ansys, Inc.

Ansys 為 Ansys, Inc. 的商標。本專案為獨立技術作品集，與 Ansys, Inc. 沒有官方隸屬關係。
