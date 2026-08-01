# PCB SI 3D Simulation Toolkit

## 高頻 PCB 模擬流程自動化

PCB SI 3D Simulation Toolkit 是一套高頻 PCB 工程展示工具，聚焦於 PCB Layout 檢視、2D/3D 視覺化、訊號網路選取、Port 準備，以及 S 參數分析流程。

> 本公開 repository 為展示版本，私人求解器整合與公司專屬實作刻意不包含在內。

## 為什麼建立這個專案

PCB 訊號完整性分析通常包含大量重複工作，例如 Layout 檢查、網路選取、幾何準備、Port 定義、模擬設定與結果判讀。本專案嘗試將這些步驟整理成更直觀、可重複的工程流程。

## 主要功能

- 2D PCB Layout 與層管理視覺化
- 3D 電路板預覽
- 訊號網路與參考網路選取
- Port 標記視覺化
- S 參數分析介面
- 工程導向的深色操作介面

## 流程預覽

### 高速通道 N 段分割

![N 段通道分割示意](graph/N段分割示意_20260730.png)

### 自動串接電路

![自動串接電路示意](graph/自動串接電路_20260730.png)

### SIwave 可信度驗證

![SIwave 可信度驗證設定](graph/可信度驗證_20260730.png)

## 使用技術

- React / TypeScript / Vite
- FastAPI 展示整合
- Ansys HFSS 3D Layout 相關流程
- PyAEDT / EDB 相關流程

## 公開展示版範圍

公開版本以前端體驗、流程視覺化與操作文件為主，不包含公司專屬後端實作、私人求解器排程、客戶資料、內部檔案路徑，以及需要授權才能執行的 Ansys 模擬環境。

## 開始使用

目前的展示流程與支援功能，請參考[操作說明](操作說明.md)。

## 技術合作與服務

如需客製化 PCB 訊號完整性、HFSS 或 SIwave 自動化工具，請透過[虎門科技](https://www.cadmen.com/)聯絡 Jeff Hong：[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)。

## 著作權與商標聲明

本專案原始碼與視覺素材僅供展示用途。商業使用、再散布與衍生作品均須事先取得許可。

Ansys 為 Ansys, Inc. 的商標。本專案為獨立技術作品集，與 Ansys, Inc. 沒有官方隸屬關係。
