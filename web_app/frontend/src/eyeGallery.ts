// 共用眼圖畫廊的純函式（#0104）。不碰 React，Node 直接測
// （tests/test_eye_gallery_0104.py）。

export interface GalleryItem {
  key: string
  title: string
  sub?: string
  url: string
  /** 報告快照的 data-report-kind／data-report-title，各處沿用原本的值。 */
  reportKind: string
  reportTitle: string
  alt?: string
}

export type LightboxAction = 'close' | 'prev' | 'next'

/** 燈箱開著時的鍵盤：Esc 關閉、左右鍵換張，其他鍵不攔。 */
export function lightboxKeyAction(key: string): LightboxAction | null {
  if (key === 'Escape' || key === 'Esc') return 'close'
  if (key === 'ArrowLeft') return 'prev'
  if (key === 'ArrowRight') return 'next'
  return null
}

/** 換張繞圈：第一張往前是最後一張。 */
export function stepIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0
  return ((index + delta) % length + length) % length
}
