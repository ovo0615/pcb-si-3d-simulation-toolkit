# PCB SI 3D Simulation Toolkit

![現行任務入口（工具視窗，未載入板子）](graph/gui-01-task-picker.png)

PCB 通道裁切、分段、HFSS／SIwave 混合求解、Touchstone 串接、IBIS／AMI 眼圖、TDR 定位與 Q2D 截面阻抗。

**本 Repo 是公開展示版，沒有後端與啟動器。下載 Source ZIP 無法執行完整模擬。** 完整工具與商用支援請洽 [TADC](https://www.cadmen.com/)／[jeff.hong@cadmen.com](mailto:jeff.hong@cadmen.com)。

| 入口 | 內容 |
|---|---|
| [繁體中文](README.zh-TW.md)／[English](README.en.md) | 功能、需求與資料邊界 |
| [第一次跑](docs/manual/00-第一次跑.md) | 從完整工具包做到通道 S 參數與報告 |
| [操作說明](操作說明.md) | 12 章功能索引 |
| [版本說明](CHANGELOG.md) | 本次基準與尚待驗收項目 |
| [驗證資料](validation/README.md) | 個別功能的歷史驗證條件與結果 |
| [圖片帳冊](docs/visual-assets.md) | 截圖版本與驗收狀態 |

文件草稿適用工具 `1.0.0-rc.1`，功能基準 `a19eda7`。35 張主圖狀態已盤點，仍有 3 項缺圖；新增 SerDes 面板圖、5 張條件圖與完整工具包驗收尚未完成，詳見版本說明與圖片帳冊。

商用授權與技術支援由虎門科技股份有限公司（Taiwan Auto-Design Co., Ltd.，TADC）提供。本工具與 Ansys, Inc. 無隸屬、無背書關係，Ansys、HFSS、SIwave 等商標屬原權利人。使用完整工具須自備相應的有效 Ansys 授權。
