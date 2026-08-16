# TDR Layout 定位驗證套件

此套件會建立一組幾何位置已知的匿名 PCB 測試板，以 SIwave SYZ 求解 Touchstone，接著呼叫 PCB SI 3D 模擬分析工具目前的 TDR 核心，量化「電氣不連續位置」映射回 Layout 的誤差。

操作步驟見[操作說明 第 7 章〈TDR 阻抗定位〉](../../docs/manual/07-TDR定位.md)。

**結論：平均誤差 0.66 mm、最差 1.71 mm。**
比對基準是「建模時就知道位置在哪」的幾何邊界，所以誤差是量出來的，不是估的。

**但這個數字只涵蓋一半的流程**，下一節說明涵蓋到哪裡、為什麼要講清楚。

## 這份驗證涵蓋到哪一段

TDR 分成兩段：由 S 參數得到 Z(時間)，再把時間換算成沿走線距離並找出劇變。
**這份驗證量的是第二段。**

| | 產生 Z(時間) | 換算距離與找劇變 |
|---|---|---|
| 工具實際執行（`app.tdr_solve.run_tdr`） | AEDT Circuit ＋ 暫態求解 | `assemble_tdr_analyses` |
| 本腳本 | scikit-rf 的 `s11.step_response()`（Hamming 窗） | **同一個** `assemble_tdr_analyses` |

距離軸的算法逐字相同——腳本直接呼叫產品函式，沒有另外重寫。差別只在 Z(時間)
的來源：暫態求解與頻域階躍響應是兩條不同的數值路徑，邊緣整形與振鈴的細節不會
完全一致，可能讓某個峰的位置微幅移動。

因此這裡的誤差數字**不涵蓋 AEDT 求解那一段**。引用時要講清楚它是「距離換算與
劇變定位」的準確度。

## 代表性案例

| 案例 | 驗證目的 |
|---|---|
| `uniform_control` | 均勻傳輸線不應誤報內部不連續。 |
| `wide_low_z` | 加寬線段造成低阻抗區，驗證兩個邊界的位置。 |
| `narrow_high_z` | 縮窄線段造成高阻抗區，驗證反向阻抗變化。 |
| `multiple_sections` | 同一路徑有多個不連續，驗證多峰排序與配對。 |
| `bend_arc_length` | 45° 彎折路徑，驗證使用走線弧長而非直線距離定位。 |
| `sub_resolution` | 結構短於 TDR 空間解析度時，應標示為解析度限制，不宣稱能精準分辨。 |

## 必要環境與套件

- Ansys Electronics Desktop／SIwave 2026 R1：建立 EDB 並執行 SIwave SYZ 求解。
- Python 3.10～3.12：執行驗證程式。
- `pyedb`：建立匿名 EDB 測試板。
- `scikit-rf`：讀取 Touchstone 並計算時域響應。
- `numpy`、`scipy`：數值運算；通常會隨 `scikit-rf` 安裝。
- 本專案後端環境：重用 `app.tdr_solve.assemble_tdr_analyses`，確保驗證的是實際產品核心，而不是另一份重寫演算法。

私人版已建立虛擬環境時，可直接執行：

```powershell
web_app\backend\.venv\Scripts\python.exe validation\tdr\run_validation.py
```

一般使用者也可以直接雙擊 `validation\tdr\run_validation.bat`，完成後依畫面提示開啟報告。

只重跑指定案例：

```powershell
web_app\backend\.venv\Scripts\python.exe validation\tdr\run_validation.py --cases wide_low_z bend_arc_length
```

保留暫存 EDB 與 SIwave 中間檔供人工檢查：

```powershell
web_app\backend\.venv\Scripts\python.exe validation\tdr\run_validation.py --keep-work
```

## 產出

結果預設寫入 `validation/tdr/results/`：

- `TDR_定位驗證報告.html`：可直接以瀏覽器開啟的完整報告。
- `TDR_定位驗證報告.md`：適合 GitHub 顯示的摘要報告。
- `tdr_validation_results.json`：供 CI 或後續工具讀取的機器可讀結果。
- `tdr_validation_overview.svg`：總覽圖。
- `touchstone/*.s2p`：每個案例的匿名 S 參數基準資料。

![驗證報告入口預覽](results/TDR_定位驗證報告_預覽.png)

工作用 EDB、SIwave 專案與求解器暫存檔放在作業系統暫存目錄；除非使用 `--keep-work`，執行結束後會自動移除。

> 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
