# PCB SI 3D Simulation Toolkit

Choose your language / 選擇語言：

- [繁體中文](README.zh-TW.md)
- [English](README.en.md)

![N 段分割與逐段求解器指定（綠色 SIwave、紫色 HFSS）](./graph/N段分割後推薦求解器示意_20260805.png)

PCB 通道裁切、風險感知分段、HFSS／SIwave 混合求解、Touchstone 串接與完整板 S 參數對照的工程流程展示。

## 加速手法必須先證明不犧牲精度

本工具的加速做法（只取通道、分段求解、逐段挑求解器）都會改動求解對象本身，因此每一項都必須回答同一個問題：**這樣做出來的結果，跟老老實實整片解一次差多少？** 目前已完成量化驗證的兩項，原始數據與失敗案例全部公開：

| 驗證項目 | 對照基準 | 結果 |
|---|---|---|
| [分段切割 + 電路串接](validation/segmentation/README.md) | 同一片試片不切割、單體全波求解 | 插入損耗偏差 **0.1 dB 以內（0～10 GHz）** |
| [TDR 群延遲定位](validation/tdr/README.md) | 建模時已知的幾何邊界位置 | 平均定位誤差 **0.66 mm**、最大 **1.71 mm** |

兩份驗證都刻意包含**負控制組**——會失敗的情形長什麼樣子。分段驗證中發現「切面處參考平面未縫合」會產生 14 dB 的假諧振，這個條件已直接變成工具的自動檢查並擋在使用者前面。驗證的價值不在背書，在於找出方法的邊界，然後把邊界寫進工具裡。

尚未單獨驗證的加速手法（通道裁切、Layout 清理的等效性）列為後續工作，不在此宣稱。

---

此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供。This is Jeff Hong's personal technical portfolio; it is not an official account of Taiwan Auto-Design Co. (TADC). Ansys is a trademark of Ansys, Inc.
