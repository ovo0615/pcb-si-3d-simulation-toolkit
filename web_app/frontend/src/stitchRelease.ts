// 手動放行 D 級（縫合不足）切面。
//
// 縫合判準 λ/12 不動；讓使用者在看過警告之後，手動放行
// 「只因縫合不足」而判 D 的切面。這裡只放純判斷：要不要提供放行按鈕、確認框
// 要顯示的可信頻率、分段表與評估表上的標記。畫面怎麼排留在 App.tsx。

import { pickText } from './backendFields'
import type { DisplayLengthUnit } from './lengthUnits'

/** 後端寫在每把刀、analysis.manual_d_release、segments.json 的同一筆紀錄。 */
export interface ManualDRelease {
  axis?: number | null
  position_mm?: number
  cut_index?: number
  frequency_limit_ghz: number | null
  target_fmax_ghz?: number | null
  via_count?: number | null
  released_grade?: string
  warning?: string
  warning_en?: string
  warning_display?: unknown
}

export interface StitchCeiling {
  best_limit_ghz: number
  target_fmax_ghz: number
  text: string
  text_en: string
}

/** 兩種分析共用的欄位（等分：threshold_feasible／requested_safe；複雜度：feasible）。 */
export interface ReleaseAnalysis {
  mode?: string
  feasible?: boolean
  threshold_feasible?: boolean
  requested_safe?: boolean
  allow_stitch_release?: boolean
  stitch_failed_count?: number
  stitch_ceiling?: StitchCeiling | null
  manual_d_release?: ManualDRelease[]
}

function analysisFeasible(analysis: ReleaseAnalysis): boolean {
  if (analysis.mode === 'complexity') return Boolean(analysis.feasible)
  return Boolean(analysis.threshold_feasible) && Boolean(analysis.requested_safe)
}

/** 分析排不出可執行的分段、而且有位置只因縫合不足被擋，才提供放行。 */
export function canOfferStitchRelease(analysis: ReleaseAnalysis | null | undefined): boolean {
  if (!analysis || analysis.allow_stitch_release) return false
  if (analysisFeasible(analysis)) return false
  return Number(analysis.stitch_failed_count || 0) > 0
}

function formatGhz(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—'
}

/** 放行紀錄裡最低的可信頻率；全部都沒有頻率（舊顆數規則）回 null。 */
export function lowestReleaseLimit(entries: ManualDRelease[] | null | undefined): number | null {
  const limits = (entries || [])
    .map(entry => entry.frequency_limit_ghz)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return limits.length ? Math.min(...limits) : null
}

/** 放行前確認框的兩個數字：通道沿線最好的縫合可信頻率、切面驗收頻率。 */
export function releaseConfirmNumbers(
  analysis: ReleaseAnalysis, targetFmaxGhz: number | null | undefined,
): { limit: string; target: string } {
  const ceiling = analysis.stitch_ceiling
  return {
    limit: formatGhz(ceiling ? ceiling.best_limit_ghz : null),
    target: formatGhz(ceiling ? ceiling.target_fmax_ghz : targetFmaxGhz),
  }
}

/** 執行前再確認一次用的數字：這次真正用到的放行刀裡最低的可信頻率。 */
export function releaseRunLimit(entries: ManualDRelease[] | null | undefined): string {
  return formatGhz(lowestReleaseLimit(entries))
}

/** 評估表評級旁的小標：有可信頻率就附上，沒有就講「無法估算」。 */
export function releaseBadge(
  release: ManualDRelease | null | undefined,
  labels: { known: (ghz: string) => string; unknown: string; none?: string },
): string {
  if (!release) return ''
  const limit = release.frequency_limit_ghz
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return labels.unknown
  return limit <= 0 && labels.none ? labels.none : labels.known(limit.toFixed(1))
}

/** 分段表一段的標記：這一段兩側切面若有手動放行，取最低的可信頻率。 */
export function segmentReleaseNote(
  plan: { manual_d_release?: ManualDRelease[] | null },
  labels: { known: (ghz: string) => string; unknown: string; none?: string },
): string {
  const entries = plan.manual_d_release || []
  if (!entries.length) return ''
  const limit = lowestReleaseLimit(entries)
  if (limit === null) return labels.unknown
  return limit <= 0 && labels.none ? labels.none : labels.known(limit.toFixed(1))
}

/** 放行刀裡有可信頻率 0 GHz（切面附近沒有跨參考層的縫合）：任何頻率都沒有保證。 */
export function releaseHasNoGuarantee(entries: ManualDRelease[] | null | undefined): boolean {
  const limit = lowestReleaseLimit(entries)
  return limit !== null && limit <= 0
}

/** 依介面語言取放行警告。 */
export function releaseWarning(release: ManualDRelease, lang: string, unit?: DisplayLengthUnit): string {
  if (unit) return pickText(release, 'warning', lang === 'en' ? 'en' : 'zh-TW', unit)
  if (lang === 'en' && release.warning_en) return release.warning_en
  return release.warning || ''
}

/** 一段兩側切面的放行紀錄（與後端 mixed_solver._segment_releases 同一規則）：
 *  cut_index 為 i 的切面介於第 i 與 i+1 段。分段剛執行完用執行回應的 cut_pairs，
 *  不必等重載 segments.json。 */
export function segmentReleases(
  cutPairs: Array<{ cut_index?: number; manual_d_release?: ManualDRelease | null }> | null | undefined,
  index: number,
): ManualDRelease[] {
  return (cutPairs || [])
    .filter(pair => pair && pair.manual_d_release
      && [index - 1, index].includes(Number(pair.cut_index ?? -1)))
    .map(pair => pair.manual_d_release as ManualDRelease)
}
