# PCB SI 3D 模擬分析工具（Web App）

此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

**這是開發者用的說明。要照著操作介面走的話，看 [操作說明](../操作說明.md)。**

求解環境：**HFSS 3D Layout ／ SIwave**，透過 PyEDB 操作 Ansys Electronics Database。

---

## 怎麼跑起來

雙擊 `start.bat`（或在 PowerShell 執行 `start.ps1`）。它會：

1. 建立 Python 虛擬環境（優先用 uv）並安裝後端套件。
2. 啟動後端 uvicorn 並開啟瀏覽器到 `http://127.0.0.1:8020`。

**8020 被占用時會自動往上找**，最多試 21 個，畫面上會寫明改用了哪一個。
要固定某個埠就用 `start.bat -ListenPort 8030`。

**一般使用者不需要 Node.js。** 後端直接服務已經建置好的 `frontend/dist`。
只有要改前端原始碼時才需要裝 Node 並跑 Vite dev server。

---

## 需要先裝什麼

| 名稱 | 用途 | 版本需求 |
|---|---|---|
| Ansys AEDT | EDB 讀寫與求解 | **只支援 2026.1**（見下） |
| Python | 後端執行環境 | 64 位元 3.10 或 3.12 |
| Node.js | 前端開發伺服器 | 18 以上，**只有開發者需要** |
| uv | Python 套件管理 | 可選，沒有的話啟動腳本會退回 `venv`／`pip` |

**為什麼只支援 2026.1：** 版本低於 2026.1 時，pyedb 會從 gRPC 後端換成 .NET 後端。
兩套是獨立實作，API 表面相容但行為不同 —— 例如 gRPC 的 `cutout` 簽章接受
`ConvexHull`、實跑卻只有 `Bounding` 能用。**這種「不報錯但結果不同」最難查**，
所以界線直接寫進程式，指定舊版會當場被拒絕。

### 套件

後端套件釘死在 `backend/requirements.lock.txt`，啟動腳本會裝到專案專用的 `.venv`。

| 套件 | 用途 |
|---|---|
| fastapi | 後端 Web API |
| uvicorn[standard] | ASGI 伺服器 |
| websockets | 系統日誌即時推送 |
| pyedb | EDB 讀寫、裁切、Port、Setup、清理、分段 |
| pyaedt | 啟動 AEDT、求解、匯出 Touchstone、建立 Circuit／QuickEye |
| pydantic | 前後端資料契約驗證 |
| scikit-rf | Touchstone 讀取、串接與 S 參數計算 |

前端套件在 `frontend/package.json`：`react`／`react-dom`（介面）、
`allotment`（可拖曳分割面板）、`vite`／`typescript`（開發與建置）。

---

## 流程順序是固定的，而且順序有原因

```
準備      載入電路板 → 局部裁切 → 疊構更換
前處理    背鑽 → Layout 清理
分析      設定 Port 與求解器 → N 段分割 → 排程求解
結果      電路串接 → S 參數 → 眼圖／TDR／截面阻抗 → 報告
```

**裁切這一步不建 Port。**

因為元件端的 Port 必須建立在**最終的幾何**上，而疊構更換、背鑽、Layout 清理
這三件事都會改動幾何。先建了 Port 再改幾何，Port 就白建了。

**疊構更換排在裁切之後**，因為它的耗時跟板上 Via 數量成正比 ——
實測某片 42 層板在還沒裁切的狀態下換疊構花了超過三十分鐘。

---

## 專案結構

```text
web_app/
  start.bat / start.ps1          一鍵啟動腳本
  backend/
    requirements.lock.txt        釘死版本的相依清單
    tests/                       69 個測試檔
    app/
      main.py                    FastAPI 路由 + WebSocket 日誌
      session.py                 EDB 工作階段狀態
      preview.py                 2D Layout 預覽資料擷取
      cutout.py                  通道裁切
      stackup_change.py          疊構更換
      backdrill.py               背鑽與殘樁分析
      cleanup.py                 Layout 清理
      segment.py                 N 段分割與切面品質判定
      schedule.py                排程求解
      mixed_solver.py            逐段求解器指派
      remote_pack.py             遠端求解包
      cascade.py                 S 參數電路串接
      model_library.py           IBIS／AMI 受管模型與 SHA-256 信任
      ibis_channel.py            標準 IBIS 通道分析
      ami_channel.py             IBIS-AMI 通道分析
      multi_lane*.py             多埠通道與多道串擾
      tdr.py / tdr_solve.py      TDR 阻抗定位
      cross_section*.py          截面阻抗（Q2D）
      reporting.py               一鍵 HTML 報告
  frontend/
    dist/                        已建置的前端，後端直接服務這裡
    src/
      App.tsx                    主畫面
      components/                Preview2D、各分析精靈、圖表、報告中心
```

---

## 測試

在 `web_app/backend` 底下執行：

```bash
PYTHONPATH="$(pwd)" uv run --with pytest --with fastapi --with pydantic --with pyedb pytest -q
```

**測試不需要 AEDT 授權，也不會開 AEDT。** 需要求解器的那些流程在測試裡是打樁的。

---

## 方法為什麼可信

工具的加速手法都會改動求解對象本身，所以每一項都有對照實驗：

| 手法 | 跟整片解的差距 |
|---|---|
| 通道裁切 | 0.03 dB 以內 |
| Layout 清理 | 0.021 dB 以內 |
| 分段串接 | 0.1 dB 以內（0～10 GHz） |

**三項共同指向同一個根因：切面與裁切邊界處參考平面的接地縫合狀況。**
缺少縫合時，裁切偏差變 1.6 dB、分段偏差變 14.4 dB。這個條件已經寫成自動檢查。

原始數據與失敗案例見 [驗證與研究](../validation/README.md)。
