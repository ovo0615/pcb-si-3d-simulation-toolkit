# DDR 使用者設定檔格式

> 本文的數值全部是**虛構示範值**，不是任何 JEDEC 規格的數字。

工具不內建任何 DDR 規格數值。要判定通過／未通過，請依你取得的規格書自建一份 JSON 設定檔，在多道分析載入。
沒有設定檔時只顯示量測值，不判定。

## 範例

```json
{
  "name": "我的 DDR4 資料群門檻",
  "version": "2026-11",
  "source": "JESD79-4 第 x.x 節（請填你實際引用的文件、版本、章節）",
  "applicability": "DDR4-3200 資料群",
  "limits": {
    "mask_vertical_margin_mv": 0,
    "mask_horizontal_margin_ui": 0,
    "overshoot_mv": 123
  },
  "requirements": { "mask_ui": 0.2, "mask_mv": 111 },
  "derating": {}
}
```

## 欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| `name`、`version` | 是 | 顯示在結果與報告 |
| `source` | 建議 | 數值出處；**留空時結果標「未註明出處」**，無法追溯 |
| `applicability` | 否 | 適用範圍說明 |
| `limits` | 是 | 指標 → 門檻（見下表）；方向由工具決定 |
| `requirements` | 依題型 | 規格要求的時間或遮罩尺寸，用來把量測值換成裕度 |
| `derating` | 否 | `requirements` 中某一項的斜率修正表 |

### `limits` 可用指標

| 指標 | 單位 | 方向 |
|---|---|---|
| `setup_margin_ps`、`hold_margin_ps` | ps | 越大越好（≥ 門檻通過） |
| `tvac_ps` | ps | 越大越好 |
| `mask_vertical_margin_mv` | mV | 越大越好 |
| `mask_horizontal_margin_ui` | UI | 越大越好 |
| `eye_height_v`／`eye_height_mv`、`eye_width_ui` | V／mV、UI | 越大越好 |
| `overshoot_mv`、`undershoot_mv` | mV | 越小越好（≤ 門檻通過） |
| `overshoot_area_vns`、`undershoot_area_vns` | V·ns | 越小越好 |
| `jitter_ui`、`jitter_ps`、`noise_mv`、`ber` | — | 越小越好 |

### `requirements`

| 鍵 | 用於 | 說明 |
|---|---|---|
| `tds_ps`、`tdh_ps` | 資料群（DDR3 類） | setup／hold 要求；裕度＝量測時間 − 要求 |
| `tis_ps`、`tih_ps` | 位址命令群 | 同上；**不可和資料群互換** |
| `mask_ui`、`mask_mv` | 資料群 Rx 遮罩（DDR4 以後） | 遮罩寬（UI）與高（mV） |

一次分析只用其中一組；兩組都寫時依題型取用。

### `derating`

```json
"derating": {
  "tds_ps": [ {"slew_v_per_ns": 1.0, "adjust_ps": 10}, {"slew_v_per_ns": 2.0, "adjust_ps": 0} ]
}
```

| 規則 | 說明 |
|---|---|
| 兩點之間 | 線性內插 |
| 超出表的範圍 | 夾在端點，結果註明 |
| 每一列 | 都要有數值的 `slew_v_per_ns` 與 `adjust_ps`，否則整份設定檔拒絕載入 |

## 常見錯誤

| 症狀 | 原因 |
|---|---|
| 載入時「未知的欄位」 | 鍵名打錯（例：`limit` 少了 s）；工具不接受多餘欄位，避免打錯的項目被靜默略過 |
| 載入時「未知的指標」 | `limits` 的鍵不在上表（大小寫也要一致，例：`eye_height_mV` 不行） |
| 裕度欄是「—」 | 設定檔沒寫對應的 `requirements`，工具不換算也不判定 |
