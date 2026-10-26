// 串接／外部 S 參數結果摘要列的數值格式（F1）。
//
// 結果可能來自串接、外部載入或工作階段還原，欄位不一定齊；直接 `?.toFixed(3)`
// 缺值時會在畫面上印出 `max|S|=undefined`。缺值或非有限數一律顯示「—」。

export function formatMaxS(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—'
}
