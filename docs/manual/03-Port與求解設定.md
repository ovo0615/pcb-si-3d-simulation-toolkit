# Port 建立與求解設定

> 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

[回操作說明索引](../../操作說明.md)

## 設定元件端 Port

1. 選擇 Port 類型：
   - **Coax**：建議選項，適合元件 Pin 到參考導體的同軸型 Port。
   - **Circuit**：建立電路埠。
2. 工具會列出與所選訊號 Net 相連的候選元件。
3. 按「建議端點（最多 2 個）」自動選擇通道兩端元件，再人工確認。
4. 不要將所有候選元件全部勾選；大型 BGA 若選錯元件，可能建立大量不必要的 Port。

Port 建立時會檢查 Reference。若元件端為 Solder Ball／BGA，工具會依訊號 Pin 所在層尋找適合的參考層；沒有 Reference 的 Port 不應進入後續分段與求解。

**負端落點修正**：元件端 Port 的負端若落在參考銅箔的任意位置，SIwave 在建立網表時可能把該節點視為無效而整個排除，症狀是輸出的 Touchstone Port 數比預期少。工具會自動把負端吸附到 1 mm 內最近的參考 Via 中心，使負端落在明確的導通結構上。此修正經 A／B 實測驗證：同一片板未修正時輸出 `s8p`，修正後輸出 `s12p`。



## 設定求解條件（HFSS 3D Layout）

![模擬設定：掃頻、自適應方式與收斂條件](../../graph/模擬求解器設定示意_20260815.png)

掃頻設定同時供 SIwave 使用；Solution Frequency、自適應方式、網格方法與收斂條件僅 HFSS 適用。實際每段用哪一種求解器，由「排程求解」 的「混合求解區域」決定。

可設定：

- Sweep Type：`Interpolating`、`Discrete` 或 `Fast`。
- 多段式 Frequency Sweep。
- Interpolating Sweep 的 Error Tolerance。
- **自適應方式**與**平行自適應區（PAR）**。
- **網格方法**：`Phi Plus`、`Phi` 或 `Classic`。
- Max Refinement Per Pass、Min Converged Passes、Max Passes、Max Delta S。

### 自適應方式（依 Ansys BKM）

網格是在「自適應頻率」下產生的。若自適應頻率遠低於掃頻上限，高頻段的網格相對過粗，會產生**數值反射**——曲線看起來像有嚴重反射，實際上是網格不足造成的假象。

這是實測追出來的問題。段 2 以 `Frequency='10GHz'` 單點自適應、掃頻到 50 GHz，與 SIwave 逐點比對（同一份幾何、同樣 16 個 Port、同樣頻率格點）：

| 頻率 | HFSS 反射 | SIwave 反射 | HFSS 耗損 | SIwave 耗損 |
|---|---|---|---|---|
| 1 GHz | 0.0062 | 0.0060 | 0.028 | 0.043 |
| 25 GHz | 0.4214 | 0.0058 | 0.269 | 0.271 |
| 50 GHz | 0.5965 | 0.0172 | 0.305 | 0.357 |

兩者的**耗損幾乎相同**，差異全在反射，且分歧起點正好落在自適應頻率。HFSS 本身收斂正常（14 passes、Delta S 0.0195→0.0151、目標 0.02、262k tets），用的也是 Direct Solver，所以不是求解器或收斂的問題。

因此工具依 Ansys 原廠 BKM（*BKM for PCB/PKG/3DIC in HFSS 3D Layout*）提供三種模式：

| 模式 | 行為 |
|---|---|
| **寬頻（Ansys BKM 建議）** | **預設值**。自適應頻率範圍自動推導為 `1 GHz ～ 掃頻上限／2`，不需手填。 |
| 多頻（3 點） | 在同一範圍內取 3 個頻率同時自適應（BKM 的 Maximum number frequencies = 3）。 |
| 單一頻率 | 只在「工作頻率」自適應；此時才需要填工作頻率。 |

其他依 BKM 套用的設定：

- **平行自適應區（PAR）**：預設啟用。
- **Airbox padding**：裁切件採 XY `0`、上下 `0.5` 倍（BKM 的 Cutout case）。
- **Max Refinement Per Pass 15%** 與 **Phi／Phi Plus 網格**已是既有預設。

不論 Setup 是在裁切時建立，還是在混合求解建立工作副本時建立，套用的都是同一組設定，不會因為入口不同而有差異。任一模式設定失敗都會退回單一頻率並在日誌記錄原因，不會靜默沿用預設。

> BKM 的兩項 Beta 選項（low memory mesh adaptive、frequency sweep acceleration via disk caching）在 EDB 的 setup API 沒有對應欄位，屬 AEDT 端旗標，需要時請自行在 AEDT 介面開啟。

介面預設值如下：

| 設定 | 預設值 |
|---|---|
| Sweep Type | `Interpolating` |
| Sweep 1 | `0 Hz～1 Hz`，Linear Count，2 Points |
| Sweep 2 | `1 Hz～100 MHz`，Log Scale，20 Samples |
| Sweep 3 | `100 MHz～50 GHz`，Linear Step，0.05 GHz |
| 自適應方式 | 寬頻（`1 GHz～25 GHz`，由掃頻上限 50 GHz 推導） |
| 平行自適應區（PAR） | 啟用 |
| 網格方法 | `Phi Plus` |
| Solution Frequency | 25 GHz（僅單一頻率模式使用） |
| Error Tolerance | 0.1% |
| Max Refinement Per Pass | 15% |
| Min Converged Passes | 2 |
| Max Passes | 20 |
| Max Delta S | 0.02 |

這些是工具預設值，不代表適合所有板材、線寬、頻寬與精度需求。正式模擬前請依專案規格確認。



## 設定 Port 與求解器

在目前的通道上建立元件端 Port 並套用求解器設定，**不執行裁切**：

1. 載入通道 `.aedb`——可以是別人裁切好的檔案，也可以是上一步只做了裁切的輸出。
2. 選好訊號 Net 與參考 Net。
3. 在「設定元件端 Port」 選 Port 類型並勾選端點元件，在「設定求解條件」 設好掃頻與自適應方式。
4. 按 **「建立 Port 與求解器設定」**。

後端走 `main._apply_ports_and_solver_setup`，與裁切流程的 Port／Setup 建立共用同一段程式碼，只是不做裁切。適用情境：

- 通道是別人切好的，或由其他流程產生。
- 上一步只勾了「局部裁切」，現在補建 Port。
- 只是想換掃頻範圍、自適應方式或網格方法，重設一次 Setup。
- 前一次裁切結果要沿用，但 Port 想重選。

> 沒有元件端 Port 的通道無法進入排程求解，串接時也會因為找不到外部 Port 而失敗（見〈電路串接失敗，訊息提到索引型別〉）。載入已裁切檔後直接分段時，記得先在此建立 Port。



---

← [載入電路板與裁切通道](02-載入與裁切.md)　[回索引](../../操作說明.md)　[N 段分割與混合求解](04-分段與混合求解.md) →

> 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
