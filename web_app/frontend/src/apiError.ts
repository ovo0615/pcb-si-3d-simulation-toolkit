import { messagesFor } from './i18n/catalog'
// 後端錯誤回應 → 一句人看得懂的話（原本寫在 App.tsx 的 api 旁邊；
// 抽出來，才能不靠 DOM 直接測英文介面）。
//
// FastAPI 的驗證錯誤（422）`detail` 是一個**陣列**，每項長得像
// `{loc: ["body","metadata_path"], msg: "Field required"}`。
// 直接丟進 `new Error` 會得到 **`[object Object]`**——2026-08-19 實測
// 就是這樣：真正的原因是「少送了 metadata_path」，而畫面上完全看不出來。
//
// 英文介面優先用後端的 `detail_en`（分工計畫約定）；沒有就顯示原文，不在前端硬翻。

import type { Lang } from './i18n/lang'
import { safeUserMessage } from './userMessages'
type ResponseLike = { status: number; statusText?: string }
export function describeApiError(data: any, res: ResponseLike, lang: Lang = 'zh-TW'): string {
  const t = messagesFor(lang).publicUi
  if (res.status === 422 && Array.isArray(data?.detail)) {
    const fields = data.detail.map((item: any) => {
      const field = Array.isArray(item?.loc) ? item.loc.filter((part: unknown) =>
        part !== 'body' && part !== 'query' && part !== 'path'
        && (typeof part === 'number' || (typeof part === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(part)))
      ).join('.') : ''
      const action = item?.type === 'missing'
        ? t.required
        : t.format
      return `${field ? `${field}${t.fieldSeparator}` : ''}${action}`
    })
    if (fields.length) return `[HTTP 422] ${fields.join(t.listSeparator)}`
  }
  return safeUserMessage(data, lang, res.status)
}
