/**
 * Layout 2D 畫布的視圖轉換（純函式，方便測試）。
 *
 * 畫布繪製用 `translate(x, y + H)` 再 `scale(s, -s)`（板子 Y 向上、螢幕 Y 向下）：
 *   screenX = x + s * boardX
 *   screenY = y + H - s * boardY
 * H 是畫布的 CSS 高度。座標一律是相對畫布左上角的 CSS 像素（不含 devicePixelRatio）。
 */
export interface LayoutTransform { x: number; y: number; scale: number }

export function screenToBoard(t: LayoutTransform, sx: number, sy: number, height: number) {
  return { x: (sx - t.x) / t.scale, y: (height + t.y - sy) / t.scale }
}

export function boardToScreen(t: LayoutTransform, bx: number, by: number, height: number) {
  return { x: t.x + t.scale * bx, y: t.y + height - t.scale * by }
}

/**
 * 以畫布上 (sx, sy) 為錨點縮放 factor 倍；錨點下的板子座標縮放前後不變。
 *
 * Y 的原點是 `y + H`（翻轉後的板子原點），不是 `y`。舊寫法
 * `sy - (sy - y) * f` 漏了 H，每次縮放 Y 多偏 H·(f−1)：放大時整張圖往上飄。
 */
export function zoomAt(
  t: LayoutTransform, sx: number, sy: number, height: number, factor: number,
): LayoutTransform {
  const originY = t.y + height
  return {
    x: sx - (sx - t.x) * factor,
    y: sy - (sy - originY) * factor - height,
    scale: t.scale * factor,
  }
}
