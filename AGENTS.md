# 公開展示版維護規則

本 Repo 僅放公開前端、已建置的 `dist`、使用者文件、去識別截圖與展示／驗證資料。完整後端、啟動器、求解協調、私有測試與開發決策不放在這裡。Source ZIP 無法執行完整工具。

## 文件只在公開版維護

`操作說明.md`、`docs/manual/`、截圖與公開驗證報告以本 Repo 為唯一維護位置。不在私有版重建手冊，也不從私有版整份覆蓋 README、AGENTS 或使用者文件。跨 Repo 引用使用公開檔案的完整網址，避免相對路徑分岔。

前端從私有版已提交的固定 commit 同步，核對整個目錄與 `web_app/VERSION`，再建置 `dist`；公開版不帶私有測試驅動、內部 fixture 或後端實作。`web_app/frontend/src/featureTiers.json` 隨前端同步，不在公開版單獨修改分級。README 與手冊只標 Beta 並連到登錄檔，不複製整份分級表。

## 截圖與版本

- 新圖片先逐張看過；只用有權公開的中性示範資料。不得含使用者／客戶名稱、本機路徑、授權位址或憑證。
- 不符現行流程的圖先移除，不用舊圖冒充新介面；在 `docs/visual-assets.md` 留待補項。未遮罩原圖不進公開版。
- `CHANGELOG.md` 的未發布項目與已發布歷史分開。未建立公開 tag／Release 的版本不得寫成已發布。
- 混合來源串接目前維持 Beta；須完成整合與實機驗證才改分級。截面阻抗（Q2D）亦為 Beta，每次啟動需重新啟用。

## 提交前檢查

從公開主線建立短命分支，只暫存本次變更。掃描使用 Git 追蹤清單，新增檔需先暫存才能掃到。

```bash
bash .github/scripts/ci_scan_local.sh
python .github/scripts/check_dist_assets.py
python .github/scripts/check_touchstone_headers.py
```

前端在 `web_app/frontend` 使用 Node.js／npm，依 `package-lock.json` 執行 `npm ci`、`npm run build`。另檢查文件連結、GitHub 錨點與新增 diff 行的客戶識別資訊；檢查全部通過才進入發布流程。CI 規則不能用忽略失敗代替驗證。圖片是二進位，文字掃描不會證明截圖乾淨。

完整產品測試只在受限的開發版依鎖檔執行，不能把後端或模型資料補進公開版來讓測試通過。此工具與 Ansys 無隸屬或背書關係，亦不包含 Ansys 授權。
