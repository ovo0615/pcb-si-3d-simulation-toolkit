// 圖表共用的尺度計算。
//
// 這裡的每一支都是「原本各畫各的、然後各自走鐘」才抽出來的：
//  - `minMax`：`Math.min(...arr)` 把整個陣列攤成參數列，掃頻或眼圖疊圖
//    幾萬點就會撞上引擎的參數上限丟 RangeError，整個面板被錯誤邊界換掉。
//  - `impedanceRange`：TDR 圖早就知道「開路端 Z 會發散到 kΩ 級」要做中位數
//    夾持，旁邊的 Q2D 對照圖卻用原始 min/max，同一條曲線在上下兩張圖裡
//    長得完全不一樣——而那張圖存在的理由正是讀幾歐姆的差。
//  - `niceStep`：span 為 0 時 `log10(0)` 是 -Infinity，步長變成 0，
//    畫刻度的 for 迴圈永遠不前進，分頁直接凍住。

/** 逐一走訪求最小／最大值（不展開成參數列）。NaN 會被跳過。 */
export function minMax(values: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max }
}

/** 同上，但值要從每個元素上取出來，省掉一次 map 產生的中間陣列。 */
export function minMaxBy<T>(
  items: ArrayLike<T>, pick: (item: T) => number,
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < items.length; i++) {
    const v = pick(items[i])
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max }
}

/**
 * 阻抗曲線的 Y 範圍：上限取「中位數的 4 倍」與實際最大值的較小者。
 *
 * 開路端附近 Z 發散到 kΩ 級，直接用 min/max 縮放會把整段有用曲線壓成一條
 * 貼著地平線的直線。超出上限的曲線裁在頂端格線上，是 TDR 圖的標準做法。
 */
export function impedanceRange(values: ArrayLike<number>): { yMin: number; yMax: number } {
  const finite: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) finite.push(values[i])
  }
  if (!finite.length) return { yMin: 0, yMax: 1 }
  const { min: zLo, max: zTop } = minMax(finite)
  const sorted = [...finite].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const zHi = Math.min(zTop, Math.max(4 * median, median + 50))
  const pad = Math.max((zHi - zLo) * 0.12, 2)
  return { yMin: zLo - pad, yMax: zHi + pad }
}

/** 「好看」的刻度間距。span ≤ 0 時回 1，避免步長 0 造成的無窮迴圈。 */
export function niceStep(span: number, target: number): number {
  if (!(span > 0) || !(target > 0)) return 1
  const raw = span / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return m * mag
  return 10 * mag
}

/** 這個步長要印幾位小數。步長 0.5 卻印整數會出現「0 1 1 2 2 3」。 */
export function tickDecimals(step: number): number {
  if (step >= 1) return 0
  if (step >= 0.1) return 1
  return 2
}
