# PCB SI 3D Simulation Toolkit

Choose your language / 選擇語言：

- [繁體中文](README.zh-TW.md)
- [English](README.en.md)

![N 段分割與逐段求解器指定（綠色 SIwave、紫色 HFSS）](./graph/N段分割後推薦求解器示意_20260815.png)

把一片 PCB 上的一條訊號路徑，從板子檔案一路算到眼圖：通道裁切、風險感知分段、
HFSS／SIwave 混合求解、Touchstone 串接、IBIS 眼圖與 DDR 時序裕度、
TDR 阻抗定位與截面阻抗（Q2D）。

**別人沒有的**：全板自動分段並逐段自動選求解器，一個框都不用畫；模型有錯不擋路
（自動修復＋SHA-256 審計鏈）；TDR 劇變直接標回 Layout 走線並原地取截面
（定位平均誤差 0.66 mm）；等化掃描單組 3 秒對完整模擬 48～212 秒，Top-3 排名一致。

**第一次用**：[第一次跑——從下載到第一張眼圖](docs/manual/00-第一次跑.md)（30 分鐘）。
加速手法都經過量化驗證：[全部驗證一覽](validation/README.md)。

---

This is Jeff Hong's personal technical portfolio; it is not an official account of Taiwan Auto-Design Co. (TADC). Ansys is a trademark of Ansys, Inc.
