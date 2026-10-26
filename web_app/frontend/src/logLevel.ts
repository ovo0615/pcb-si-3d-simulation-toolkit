// 系統日誌的顏色分級。
//
//
// 原本是一條 `/錯誤|失敗|error|fail/i` 直接掃整行，誤判很多：
//
//   * 「Sweep Error Tolerance 已設為 5%」——AEDT 的欄位名裡有 Error，被塗紅。
//   * 「完成：成功 32 段、失敗 0 段」——在報數字，沒有任何東西失敗。
//   * 「[分段] 警告：刪除 Port 失敗」——已經標明是警告，卻蓋成錯誤。
//   * 「板框提取失敗，已成功動態推算範圍」——講的是已經處理掉的回退。
//
// 紅字的意義是「這裡出事了，要看」。如果正常流程也一片紅，紅字就沒有意義了，
// 真正的錯誤反而會被忽略——這比不上色還糟。
//
// 規則刻意只認中文關鍵字：後端所有訊息都是中文，英文字只會出現在 AEDT 的欄位
// 名、檔名與例外訊息裡，拿它們判斷嚴重性只會製造誤判。
//
//  起後端改送結構化的一則日誌 `{text, level, code?, text_en?}`。有 `level`
// 就照它上色——切到英文後畫面上是 text_en，再拿中文關鍵字猜嚴重性就靜默失效了。
// 下面這套中文規則只留給還沒帶 level 的舊格式（純文字一行）。

import { safeUserMessage } from './userMessages'
import { messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'

export type LogLevel = 'error' | 'warn' | 'info'

/** 一則日誌。舊格式（純文字）解析後只有 text。 */
export type LogEntry = {
  text: string
  user_safe?: boolean
  event_id?: string
  level?: LogLevel
  code?: string
  text_en?: string
  receivedSecond?: number
}

/** 已標明是警告的行。警告優先於錯誤——寫的人已經表態了，不要再猜。 */
const WARN = /警告|注意/

/** 「失敗，但已經處理掉了」。這類回退是設計的一部分，不是出事。 */
const RECOVERED = /失敗[^。]{0,40}?(改用|改由|已改|回退|退回|沿用|已成功|仍可|不影響)/

/** 「失敗 0 段」「失敗 0、」這種計數，數字是 0 就沒有東西失敗。
 *  後端的摘要行已改成零就不列，這條是防守——漏掉一處也不會整行變紅。 */
const ZERO_FAILURES = /失敗\s*0(\s*(段|個|筆|條|層|項))?(?!\d)/

const ERROR = /錯誤|失敗|例外/

export function logLevel(line: string): LogLevel {
  if (WARN.test(line)) return 'warn'
  if (RECOVERED.test(line)) return 'warn'
  if (ZERO_FAILURES.test(line)) return 'info'
  if (ERROR.test(line)) return 'error'
  return 'info'
}

function isLevel(value: unknown): value is LogLevel {
  return value === 'error' || value === 'warn' || value === 'info'
}

/** WebSocket 收到的一則：JSON 物件且有字串 text 才當結構化紀錄，其餘一律當純文字。 */
export function parseLogMessage(raw: string): LogEntry {
  if (raw.startsWith('{')) {
    try {
      const data = JSON.parse(raw)
      if (data && typeof data === 'object' && typeof data.text === 'string') {
        return {
          text: data.text,
          user_safe: data.user_safe === true,
          event_id: typeof data.event_id === 'string' ? data.event_id : undefined,
          level: isLevel(data.level) ? data.level : undefined,
          code: typeof data.code === 'string' ? data.code : undefined,
          text_en: typeof data.text_en === 'string' ? data.text_en : undefined,
        }
      }
    } catch { /* 不是 JSON：當成一行純文字 */ }
  }
  return { text: raw }
}

/** 後端給了 level 就照它；沒有才退回上面的中文規則。 */
export function entryLevel(entry: LogEntry | string): LogLevel {
  if (typeof entry === 'string') return logLevel(entry)
  return entry.level ?? logLevel(entry.text)
}

/** 畫面上要印的字：英文介面優先用 text_en，沒有就顯示原文，不在前端硬翻。 */
export function logText(entry: LogEntry | string, lang: Lang): string {
  // 安全日誌只顯示步驟與可供回報的事件號，不揭露內部分類識別字。
  if (typeof entry !== 'string' && entry.user_safe === true) {
    const text = (lang === 'en' && entry.text_en) || entry.text
    const event = entry.event_id && /^E-[A-Za-z0-9-]{1,64}$/.test(entry.event_id)
      ? messagesFor(lang).publicUi.eventReference(entry.event_id) : ''
    return text + event
  }
  return safeUserMessage(entry, lang)
}

/** 僅辨認明確進度比值或百分比，保留其餘文字／段號以免吞掉不同步驟。 */
function progressStep(text: string): string | undefined {
  const progress = /\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*[%％]/g
  return progress.test(text) ? text.replace(progress, '<progress>') : undefined
}

/** WebSocket 日誌累積邊界：去連續重複、原位更新同一步驟進度並保留行數上限。 */
export function appendLogEntry(entries: (LogEntry | string)[], incoming: LogEntry | string,
  maxLines: number, now = Date.now()): (LogEntry | string)[] {
  const second = Math.floor(now / 1000)
  if (typeof incoming !== 'string') {
    incoming = {...incoming, receivedSecond: second}
    if (incoming.user_safe && !incoming.event_id && entryLevel(incoming) === 'info') {
      const candidate = incoming
      if (entries.some(entry => typeof entry !== 'string' && entry.user_safe
          && !entry.event_id && entryLevel(entry) === 'info' && entry.receivedSecond === second
          && entry.code === candidate.code && entry.text === candidate.text
          && entry.text_en === candidate.text_en)) return entries
    }
  }
  const last = entries[entries.length - 1]
  if (last && typeof last !== 'string' && typeof incoming !== 'string'
      && last.user_safe === true && incoming.user_safe === true
      && last.code === incoming.code && entryLevel(last) === entryLevel(incoming)
      && last.event_id === incoming.event_id) {
    if (last.text === incoming.text && last.text_en === incoming.text_en) return entries
    const step = progressStep(last.text)
    if (!incoming.event_id && entryLevel(incoming) === 'info' && step
        && step === progressStep(incoming.text)
        && (last.text_en === incoming.text_en
          || (last.text_en && incoming.text_en && progressStep(last.text_en)
            && progressStep(last.text_en) === progressStep(incoming.text_en)))) {
      return [...entries.slice(0, -1), incoming].slice(-maxLines)
    }
  }
  return [...entries, incoming].slice(-maxLines)
}

/** 對應到 CSS 變數；info 回 undefined，沿用容器本身的顏色。 */
export function logColor(entry: LogEntry | string): string | undefined {
  const level = entryLevel(entry)
  if (level === 'error') return 'var(--danger)'
  if (level === 'warn') return 'var(--warn)'
  return undefined
}
