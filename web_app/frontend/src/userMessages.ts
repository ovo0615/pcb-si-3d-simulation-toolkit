import { messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'

/** 已由本機字典或安全 API 整理的錯誤，供畫面保留可操作提示。 */
export function userError(message: string, english?: string): Error {
  return Object.assign(new Error(message), { user_safe: true, detail: message, detail_en: english })
}

/** 未經使用者層整理的後端內容不進入畫面。 */
export function safeUserMessage(data: unknown, lang: Lang = 'zh-TW', status?: number): string {
  const d = data as { user_safe?: boolean; detail?: string; detail_en?: string; text?: string; text_en?: string; code?: string; event_id?: string } | null
  const code = typeof d?.code === 'string' && /^[a-z][a-z0-9_.-]{0,79}$/.test(d.code) ? d.code : 'system.unexpected'
  const message = d?.user_safe === true
    ? ((lang === 'en' ? d.detail_en || d.text_en : '') || d.detail || d.text) : ''
  const publicUi = messagesFor(lang).publicUi
  const knownMessage = code === 'file.path_not_found' ? publicUi.pathNotFound : ''
  const fallback = publicUi.failed
  const event = typeof d?.event_id === 'string' && /^E-[A-Za-z0-9-]{1,64}$/.test(d.event_id) ? ` / ${d.event_id}` : ''
  return `[${status ? `HTTP ${status} / ` : ''}${code}${event}] ${knownMessage || message || fallback}`
}
