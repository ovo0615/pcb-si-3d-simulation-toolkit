// Layout 預覽的視角與圖層／網路／元件顯示：關窗保存、重開還原。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// Preview2D 每次載入資料都把顯示狀態重設成全開；還原值要在那之後合併上去。
// 本檔不 import React，Node 測試直接跑。
import { compatible } from './uiSession'

export interface PreviewTransform { x: number; y: number; scale: number }
export interface SavedPreviewView extends PreviewTransform { fitKey: string }

/** 以這片板子的層／網路／元件為準（fresh），套回快照裡同名、同型別的值。 */
export function mergeRestoredVisibility<T>(fresh: Record<string, T>,
                                           saved: Record<string, unknown> | undefined): Record<string, T> {
  if (!saved || typeof saved !== 'object') return fresh
  const out: Record<string, T> = { ...fresh }
  for (const key of Object.keys(fresh)) {
    if (key in saved && compatible(fresh[key], saved[key])) out[key] = saved[key] as T
  }
  return out
}

/** 同一個畫面（fitKey 相同）才套回視角；數值不合理就回 null，照常全覽。 */
export function restoredTransform(saved: Partial<SavedPreviewView> | undefined,
                                  fitKey: string): PreviewTransform | null {
  if (!saved || saved.fitKey !== fitKey) return null
  const { x, y, scale } = saved
  if (![x, y, scale].every(v => typeof v === 'number' && Number.isFinite(v))) return null
  if ((scale as number) <= 0) return null
  return { x: x as number, y: y as number, scale: scale as number }
}
