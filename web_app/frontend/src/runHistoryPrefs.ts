// 執行歷史的展開偏好：預設收合，展開後記住；串接、TDR、多道各記各的。
//
// 存在 localStorage（per-viewer 偏好）。讀不到、壞掉都當收合——偏好遺失只是多按一下，
// 不該讓整個面板出錯。

export const HISTORY_EXPANDED_KEY = 'pcbsi.runHistory.expanded.v1'

type PrefStorage = Pick<Storage, 'getItem' | 'setItem'> | null | undefined

function readAll(storage: PrefStorage): Record<string, boolean> {
  try {
    const parsed = JSON.parse(storage?.getItem(HISTORY_EXPANDED_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** `kind` 沒給＝IBIS 通道那條舊路徑（與 RunHistory 的 `kind` 預設一致）。 */
function placeKey(kind: string | undefined): string {
  return kind || 'ibis_channel'
}

export function readHistoryExpanded(storage: PrefStorage, kind: string | undefined): boolean {
  return readAll(storage)[placeKey(kind)] === true
}

export function writeHistoryExpanded(storage: PrefStorage, kind: string | undefined, expanded: boolean): void {
  try {
    storage?.setItem(HISTORY_EXPANDED_KEY, JSON.stringify({ ...readAll(storage), [placeKey(kind)]: expanded }))
  } catch {
    // 存不了（隱私模式、配額滿）就只在這次畫面有效。
  }
}
