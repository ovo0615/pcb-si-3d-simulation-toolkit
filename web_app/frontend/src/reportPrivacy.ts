// 報告與快照的本機路徑防護（卡 0083 R5）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 報告是交給客戶的。快照是一張圖，畫面上印的「來源：＜磁碟機＞…＜使用者資料夾＞…」會被
// 原樣拍進像素，後端的文字遮蔽碰不到——所以要在拍之前處理：
//   1. 結果頁上的路徑只顯示檔名（完整路徑放在 title 提示）；
//   2. 快照過濾器把任何仍帶絕對路徑的文字節點、輸入框整個略過；
//   3. 進報告中繼資料的字串把路徑換成檔名。

/** 路徑中允許的字元：可含空白（例如資料夾名稱「AI Development」），在引號、標籤符號、
 *  換行與中文句讀停下。每個字元前面都不能是「空白＋另一個路徑的開頭」，
 *  否則一行裡兩條路徑會被吃成一條、前一條的檔名就不見了。 */
const BODY = String.raw`(?:(?!\s+(?:[A-Za-z]:[\\/]|\\\\))[^<>"'\r\n,;!?*|。，；：！？（）「」『』【】、])`
const LOCAL_PATH_SOURCE = String.raw`(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\s\\<>"']+\\|(?<![A-Za-z0-9\\/])Users[\\/]|(?<![A-Za-z0-9:/])/(?:home|Users|tmp|mnt)/)`
  + BODY + '*'

function pathRegex(flags = 'g'): RegExp {
  return new RegExp(LOCAL_PATH_SOURCE, flags)
}

/** 路徑的最後一段（檔名）：「＜磁碟機＞＼a＼b＼c.s4p」→「c.s4p」。 */
export function displayFileName(path: string | null | undefined): string {
  const text = String(path ?? '').trim().replace(/^"+|"+$/g, '')
  const parts = text.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : text
}

export function containsLocalPath(text: string | null | undefined): boolean {
  return pathRegex('').test(String(text ?? ''))
}

/** 文字裡的絕對路徑都換成檔名；其餘照舊。 */
export function sanitizeReportText(text: string): string {
  return String(text).replace(pathRegex(), match => displayFileName(match))
}

/** 報告中繼資料：字串值裡的路徑換成檔名（巢狀物件與陣列也處理）。 */
export function sanitizeReportMetadata<T extends Record<string, unknown>>(meta: T): T {
  const clean = (value: unknown): unknown => {
    if (typeof value === 'string') return sanitizeReportText(value)
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, clean(item)]))
    }
    return value
  }
  return clean(meta) as T
}

interface NodeLike {
  nodeType?: number
  textContent?: string | null
  tagName?: string
  value?: unknown
  dataset?: Record<string, string | undefined>
}

/** html-to-image 的 filter：false＝這個節點不進快照。
 *
 *  html-to-image 對每個子節點（含文字節點）都會呼叫 filter。只丟帶路徑的
 *  那個文字節點——JSX 的 `來源：{path}` 會產生兩個文字節點，標籤留著、
 *  路徑消失；畫面上漏改的地方也不會把路徑拍進報告。 */
export function isSnapshotSafeNode(node: NodeLike): boolean {
  if (node.nodeType === 3) return !containsLocalPath(node.textContent)
  if (node.nodeType !== 1) return true
  if (node.dataset?.reportIgnore === 'true') return false
  const tag = String(node.tagName || '').toUpperCase()
  if ((tag === 'INPUT' || tag === 'TEXTAREA') && containsLocalPath(String(node.value ?? ''))) {
    return false
  }
  return true
}
