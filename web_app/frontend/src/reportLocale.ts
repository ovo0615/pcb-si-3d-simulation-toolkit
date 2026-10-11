// 報告語言（卡 0087 批 2）：預設跟介面語言，使用者在報告中心選過就記住。
//
// Jeff 2026-10-10 定：報告語言獨立選擇、預設跟介面語言。工作區 manifest 也存了
// locale，但它分不出「使用者選的」還是「出廠預設 zh-TW」，所以「選過」另外記在
// localStorage；沒選過就一律跟介面語言（切換介面語言時跟著換）。
// 混合求解報告（/api/cascade/run 的 report_locale）用同一個規則。

import type { Lang } from './i18n/lang'
import type { ReportLocale } from './reportTypes'

export type { ReportLocale } from './reportTypes'

export const REPORT_LOCALE_STORAGE_KEY = 'pcbsi.reportLocale.v1'

export function isReportLocale(value: unknown): value is ReportLocale {
  return value === 'zh-TW' || value === 'en' || value === 'bilingual'
}

/** 使用者選過的報告語言；沒選過（或存了看不懂的值）回 null。 */
export function chosenReportLocale(): ReportLocale | null {
  try {
    const stored = typeof window === 'undefined'
      ? null : window.localStorage.getItem(REPORT_LOCALE_STORAGE_KEY)
    return isReportLocale(stored) ? stored : null
  } catch {
    return null
  }
}

export function rememberReportLocale(locale: ReportLocale): void {
  try {
    window.localStorage.setItem(REPORT_LOCALE_STORAGE_KEY, locale)
  } catch { /* 存不了就只在這次生效 */ }
}

/** 選過就照選的，否則跟介面語言。 */
export function effectiveReportLocale(uiLang: Lang, chosen: ReportLocale | null = chosenReportLocale()): ReportLocale {
  return chosen ?? uiLang
}

/** 報告語言和拍攝時的介面語言不同的快照張數（雙語報告、沒記語言的舊快照不算）。
 *  和後端 reporting._count_locale_mismatch 同一個規則，產生前先在輸出頁提醒。 */
export function localeMismatchCount(
  snapshots: { ui_locale?: string | null }[], locale: ReportLocale,
): number {
  if (locale === 'bilingual') return 0
  return snapshots.filter(item => isReportLocale(item.ui_locale) && item.ui_locale !== locale).length
}
