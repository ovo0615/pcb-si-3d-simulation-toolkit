# HFSS Adaptive Range Study／混合求解嘗試

此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

**這個資料夾裝了兩件事，其中一件的結論不成立，請先讀完本節再看檔案。**

**不成立的那件事也留著沒刪。** 失敗的實驗跟成功的一樣是證據，
刪掉只會讓下一個人再做一次。

## 1. 自適應範圍研究（有效）

量化 HFSS 自適應設定對掃頻上限精度的影響。現行 BKM（1 GHz ~ Fmax/2）
在 20 GHz 少算 3.2 dB 損耗；寬頻涵蓋整個掃頻範圍是 CP 值最佳解。

- [自適應範圍驗證報告](自適應範圍驗證報告.md)
- 結果：`results/adaptive_range_results.json`、`results/adaptive_range.svg`
- 求解編排：`run_adaptive_study.py`、`collect_adaptive.py`、`make_adaptive_figure.py`

## 2. 混合求解（HFSS + SIwave）比較——**結論不成立，僅保留過程**

原本要比較「HFSS 整片／SIwave 整片／混合分段」三種題型的精度與時間。
跑完才發現有兩個獨立的問題讓結論站不住：

**（a）基準未收斂。** 當時用工具 BKM 的自適應（1–10 GHz）解出的 HFSS
當真值，但上述研究 1 證明該設定在 20 GHz 偏離收斂解 3.2 dB。
用一個本身錯的基準去量別人的偏差，數字沒有意義。

**（b）切面保真度不足。** 以同求解器對照量到的串接誤差是 0.83 dB
（已歷經三輪改良：開放板邊 14.76 → 加平面外擴 1.97 → 加切面柵欄 0.83），
與想量的「求解器指派造成的差異」同量級。要再壓下去需要在切面改用
多模態 Wave Port 並重新求解，屬於另一個題目。

因此 `solver_mix_results.json` 已移除，避免被誤當成有效結論。
建模與求解腳本保留（`build_coupon.py`、`build_segments.py`、`run_monolithic.py`、
`run_segments.py`、`gate_check.py`），未來若要重做，需要：

1. 自適應改為涵蓋整個掃頻範圍
2. 切面改用多模態 Wave Port，或把比較頻段限制在切面保真度足夠的範圍內

**這個題目真正該問的問題，已由[SIwave 適用性地圖](../solver_map/SIwave適用性地圖.md)
用更乾淨的方式回答**：與其在一片板上比較混合策略，不如量出各種標準結構上
SIwave 對收斂 HFSS 的偏差，直接得到指派依據。

## 共用工具

`exp_lib.py`（Setup 建立、求解、匯出、Touchstone 驗證）與 `watchdog.py`
（逾時與停滯偵測）被其他研究共用，勿隨意搬移。

- [四項研究總覽](../分段與求解器研究總覽.md)

> 本 Repository 為 Jeff Hong 個人技術作品集之展示內容，非 Taiwan Auto-Design
> Co.（TADC）或 Ansys, Inc. 官方產品。Ansys、HFSS 與 SIwave 為 Ansys, Inc. 之商標。
