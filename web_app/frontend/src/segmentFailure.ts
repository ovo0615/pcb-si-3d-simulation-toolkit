import { safeUserMessage } from './userMessages'
import { messagesFor } from './i18n/catalog'
/**
 * 分段失敗原因：後端寫在 segments.json 每段的 `failure`，
 * 分段表與排程進度用同一套規則顯示。
 *
 * 舊檔沒有原因時後端回 null，畫面寫「未記錄」，不留白也不猜。
 */

export interface SegmentFailure {
  kind: string
  code: string
  params?: Record<string, unknown>
  text: string
  text_en?: string
  user_safe?: boolean
  event_id?: string
  /** 失敗時間（epoch 秒）；舊紀錄可能沒有。 */
  at?: number | null
}

interface SegmentStatusLike {
  status?: string
  solve_status?: string
  export_status?: string
}

// 與後端 segment_failure.py 的 FAILED_SOLVE_STATUSES／FAILED_EXPORT_STATUSES 同一份。
const FAILED_SOLVE = new Set(['failed', 'crashed', 'stopped', 'cleanup_pending'])
const FAILED_EXPORT = new Set(['failed', 'stopped'])

/** 這一段目前是不是失敗（要顯示原因）。 */
export function hasFailure(row: SegmentStatusLike): boolean {
  return row.status === 'failed'
    || FAILED_SOLVE.has(row.solve_status || '')
    || FAILED_EXPORT.has(row.export_status || '')
}

/** 依介面語言取原因；沒有就回 `notRecorded`。英文缺翻譯時退回中文原文。 */
export function failureText(failure: SegmentFailure | null | undefined,
                            lang: string, notRecorded: string): string {
  if (!failure || !failure.text) return notRecorded
  const language = lang === 'en' ? 'en' : 'zh-TW'
  if (failure.user_safe === true) return safeUserMessage(failure, language)
  const catalog = messagesFor(language).publicUi.segmentFailure
  const kind = failure.kind as keyof typeof catalog
  // 舊紀錄只採固定類別的本機提示，不讀可能含例外的 text／params。
  if (Object.prototype.hasOwnProperty.call(catalog, kind)) {
    return safeUserMessage({ code: failure.code, event_id: failure.event_id,
      user_safe: true, text: catalog[kind] }, language)
  }
  return safeUserMessage(failure, language)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 失敗時間（本機時間 `YYYY-MM-DD HH:mm:ss`）；沒有就回 `notRecorded`。 */
export function failureTime(failure: SegmentFailure | null | undefined,
                            notRecorded: string): string {
  const at = failure?.at
  if (typeof at !== 'number' || !Number.isFinite(at)) return notRecorded
  const d = new Date(at * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
