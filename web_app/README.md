# PCB SI 3D 模擬分析工具（Web App）

本公開展示版只有前端、文件與展示資料，沒有 `backend/` 或 `start.bat`。下載 Source ZIP 無法執行完整模擬。[使用者操作說明](https://github.com/ovo0615/pcb-si-3d-simulation-toolkit/blob/main/操作說明.md)。

## 一般使用者

取得完整安裝包，核對 SHA-256 後執行 Setup，完成授權匯入再開啟工具。v1.0.4 包含 CPython 3.12.10、離線套件及 `Example_SYZ.aedb`，不需另裝 Python、Node.js 或 pip 套件。

| 另備元件 | 用途 |
|---|---|
| Windows 10／11 x64 | 執行工具 |
| Ansys Electronics Desktop 2026 R1 與相應授權 | EDB 與所選求解功能 |
| Microsoft Edge WebView2 Evergreen Runtime | 工具視窗；缺少時依安裝提示安裝 |
| 有權使用的外部 IBIS／AMI 模型（選用） | 眼圖分析 |

範例先複製到自己的 ASCII 工作路徑，不直接修改安裝原件。詳細流程見[第一次跑](https://github.com/ovo0615/pcb-si-3d-simulation-toolkit/blob/main/docs/manual/00-第一次跑.md)。

## 公開前端開發

| 相依 | 用途／安裝方式 |
|---|---|
| Node.js 20 與 npm | 與公開 CI 一致的前端建置環境，先自行安裝 |
| `frontend/package-lock.json` 鎖定套件 | React 介面、Vite／TypeScript 建置；用 `npm ci` 安裝 |

在 `web_app/frontend` 執行：

```bash
npm ci
npm run build
```

`src/` 是介面原始碼，`dist/` 是已建置資產。建置成功只證明前端可編譯，不表示公開版具備模擬後端。完整工具預設使用工具視窗，後端服務 `dist/`。

## 完整開發版測試

以下只適用於另行取得的完整開發版；本公開版無此後端。預先安裝 Python 3.12 與 uv，uv 會依 `backend/requirements.lock.txt` 安裝後端鎖定相依，另加 pytest 測試工具。在完整開發版 `web_app/backend` 執行：

```bash
PYTHONPATH="$(pwd)" uv run --python 3.12 --with-requirements requirements.lock.txt --with pytest python -m pytest -q
```

前端需先依上述鎖檔安裝相依。完整開發版實機求解驗證另需 Ansys 與相應授權，不能用單元測試取代。

歷史數值、模型、失敗案例與適用條件見[驗證與研究](https://github.com/ovo0615/pcb-si-3d-simulation-toolkit/blob/main/validation/README.md)，不對其他板子承諾相同誤差。
