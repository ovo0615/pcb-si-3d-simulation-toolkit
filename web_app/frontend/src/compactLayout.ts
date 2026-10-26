// 小螢幕版面的尺寸規則。
//
// 最小驗收尺寸是 1920×1080＠150%，也就是約 1280×720 CSS px——13 吋商務筆電的
// 預設值。這個高度下，固定像素的面板很容易把主要內容擠掉，所以這裡的值都跟著
// 實際可用的高度走，而不是寫死一個在大螢幕上剛好的數字。

/** 系統日誌最多佔視窗高度的 35%。拖得再大，主要內容至少還留一大半。 */
export function logPaneMaxPx(viewportHeight: number): number {
  return Math.max(120, Math.round(viewportHeight * 0.35))
}

/** TDR 曲線圖的高度：量到的圖框高度夾在 120～230 px。
 *  還沒量到（0）時用原本的 230，大螢幕的樣子不變。 */
export function tdrChartHeight(measured: number): number {
  if (!measured) return 230
  return Math.min(230, Math.max(120, Math.floor(measured)))
}
