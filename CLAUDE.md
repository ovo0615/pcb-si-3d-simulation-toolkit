# ⚠️ 這裡是【公開展示版】工作目錄

此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

```
目錄：D:\AI Development\PCB SI 3D Simulation Toolkit
分支：public-showcase
遠端：origin  →  https://github.com/ovo0615/pcb-si-3d-simulation-toolkit（公開）
內容：只有前端展示版 + 操作說明 + graph 圖片（約 28 個檔案）
```

## 本目錄沒有後端原始碼

`web_app/backend/` 在這個分支**不存在**（只會有 `__pycache__` 之類的殘骸）。
在這裡找不到 `main.py`、`segment.py`、`cutout.py` 是正常的，不是檔案遺失。

## 要改程式請到私有目錄

```
D:\AI Development\PCB SI 3D Simulation Toolkit-siwave   （分支 private-source）
```

完整前後端、測試、啟動腳本都在那裡。**本目錄不要加入任何後端、PyEDB、
AEDT 整合程式碼或啟動腳本**——那會把私有內容洩漏到公開 Repository。

## 兩邊都有、但內容不同的檔案

`操作說明.md` 與 `graph/` 兩邊都有，但**私有版的操作說明比公開版詳盡**
（多了求解器選擇、Monitor Data、重新匯出、核心數與記憶體預算、材料自動
補建等私有功能章節）。

> **絕對不要整份互相覆蓋。**
> 需要同步時，只能把「同一項變更」分別套用到兩邊；用 `cp` 整份複製會把
> 另一邊的專屬內容刪掉（此規則源自實際發生過的事故）。

`graph/` 的圖片則是共用的，可以直接複製同步。

## 發佈流程

```bash
git push origin public-showcase:main
```

推送前務必確認沒有後端檔案被加入：

```bash
git ls-files | grep -iE "backend|\.py$|pyedb|aedt|start\.(bat|ps1)"
```

上面這行應該沒有任何輸出。
