// 後端錯誤回應 → 一句人看得懂的話（原本寫在 App.tsx 的 api() 旁邊；卡 0087 批 2
// 抽出來，才能不靠 DOM 直接測英文介面）。
//
// FastAPI 的驗證錯誤（422）`detail` 是一個**陣列**，每項長得像
// `{loc: ["body","metadata_path"], msg: "Field required"}`。
// 直接丟進 `new Error()` 會得到 **`[object Object]`**——2026-08-19 實測
// 就是這樣：真正的原因是「少送了 metadata_path」，而畫面上完全看不出來。
//
// 英文介面優先用後端的 `detail_en`（分工計畫約定）；沒有就顯示原文，不在前端硬翻。

import { messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'

type ResponseLike = { status: number; statusText?: string }

export function describeApiError(data: any, res: ResponseLike, lang: Lang = 'zh-TW'): string {
  const t = messagesFor(lang).apiError
  if (lang === 'en' && typeof data?.detail_en === 'string' && data.detail_en) return data.detail_en
  const detail = data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) {
    const parts = detail.map((item: any) => {
      const where = Array.isArray(item?.loc)
        ? item.loc.filter((x: any) => x !== 'body').join('.')
        : ''
      const message = item?.msg || JSON.stringify(item)
      return where ? `${where}${t.fieldSep}${message}` : String(message)
    })
    return `${t.httpPrefix(res.status)}${parts.join(t.listSep)}`
  }
  if (detail) return JSON.stringify(detail)
  return res.statusText || `HTTP ${res.status}`
}
