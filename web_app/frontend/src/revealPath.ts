// 在檔案總管開啟結果所在的資料夾。
//
// 為什麼值得一個共用模組：結果落在 `%LOCALAPPDATA%\PCB SI 3D Simulation
// Toolkit\...\<時間戳>\` 這種又長又難記的路徑底下，而三個地方（COM 產物、
// S 參數工具箱輸出、TDR 量測波形）都需要同一顆按鈕。各自寫一份的話，
// 錯誤處理與訊息會慢慢分岔。

import { messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'

/** 開啟資料夾；`path` 是檔案時開它所在的資料夾並選取它。
 *
 *  回傳錯誤訊息字串，成功時回 null——呼叫端通常已經有一個訊息區可以顯示，
 *  再包一層 throw 只會逼每個呼叫點都寫 try/catch。
 *  `lang` 不傳就是繁中（App.tsx 在批 3 之前都這樣呼叫）；英文介面優先用 detail_en。 */
export async function revealPath(path: string, lang: Lang = 'zh-TW',
  endpoint = '/api/open_folder'): Promise<string | null> {
  const t = messagesFor(lang).reveal
  const target = (path || '').trim()
  if (!target) return t.noPath
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target }),
    })
    if (res.ok) return null
    const text = await res.text()
    try {
      const data = JSON.parse(text)
      return (lang === 'en' && typeof data?.detail_en === 'string' && data.detail_en)
        || data?.detail || t.httpFailed(res.status)
    } catch {
      // 舊後端還在跑時，這個端點會撞上根路徑的 StaticFiles，回的是
      // 405 而不是 JSON。訊息要指向真正的原因，不然看起來像功能壞了。
      return res.status === 405 ? t.staleBackend : t.httpFailed(res.status)
    }
  } catch (err) {
    return t.failed(err instanceof Error ? err.message : String(err))
  }
}

/** 從一串輸出檔路徑取出共同的資料夾。全部在同一層時才有意義，
 *  否則回第一個檔案本身（讓後端去開它的父資料夾）。 */
export function commonFolderOf(paths: string[]): string {
  const valid = paths.filter(p => p && p.trim())
  if (!valid.length) return ''
  const dirs = new Set(valid.map(p => p.replace(/[\\/][^\\/]*$/, '')))
  return dirs.size === 1 ? [...dirs][0] : valid[0]
}

/** 結果頁「開啟模擬資料夾」（#0115）：走受限端點，後端只開工具自己產出的資料夾。 */
export function revealResultFolder(path: string, lang: Lang = 'zh-TW'): Promise<string | null> {
  return revealPath(path, lang, '/api/open_result_folder')
}
