// 模型健檢紀錄 → 畫面上那一行字。
//
// 後端從  起多一種狀態 `invalid_result`：模型跑完了，但 AMI 結果判無效
// （通道時域響應發散）。原本這裡只認 passed／not_applicable／license_unavailable，
// 其餘一律紅字「失敗」，配上「健檢不過＝模型問題」的提示，等於把參考通道的問題
// 算到模型頭上。抽成純函式，才能不靠 DOM 直接測。
//
// ：畫面文字來自語言檔；英文介面優先用後端的 reason_en／detail_en。

import { messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'

export type HealthRecord = {
  status: string
  seconds?: number
  at?: string
  reason?: string
  reason_en?: string
  /** ：invalid_result 的原因代碼（決定歸因）與原因本體（不含「結果無效（…）：」前綴）。 */
  code?: string
  detail?: string
  detail_en?: string
  /** 位元數依模型 Ignore_Bits 自動加過時的實際位元數與說明。 */
  bit_count?: number
  bit_count_note?: string
  bit_count_note_en?: string
}

export type HealthTone = 'pass' | 'info' | 'warn' | 'fail'

export type HealthView = {
  tone: HealthTone
  text: string
  /** 滑鼠提示：完整原因。畫面上只放前 80 字。 */
  title?: string
}

const DETAIL_CHARS = 80
/** 後端 `run_healthcheck` 寫在原因開頭的歸因；畫面上自己講，不重複印。
 *  只給沒有 `detail` 欄位的舊紀錄用：切到英文後原因不保證是中文，不能靠它。 */
const LEGACY_INVALID_PREFIX = /^結果無效（[^）]*）：?/
/**  起歸因有兩種：參考通道時域響應不可用，以及沒有眼圖資料。
 *  照後端給的代碼顯示，不寫死——寫死的話「沒有眼圖資料」也會被說成參考通道的問題。 */
const NO_EYE_CODE = 'healthcheck.invalid_result_no_eye'

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 沒有代碼的舊紀錄：比對繁中語言檔的同一句前綴，認出「沒有眼圖資料」。 */
function isNoEyeData(record: HealthRecord): boolean {
  if (record.code) return record.code === NO_EYE_CODE
  return text(record.reason).startsWith(messagesFor('zh-TW').health.invalidNoEye(''))
}

/** `lang` 不傳就是繁中（模型庫在批 3 之前都這樣呼叫）。 */
export function healthStatusView(record: HealthRecord, lang: Lang = 'zh-TW'): HealthView {
  const t = messagesFor(lang).health
  const english = lang === 'en'
  const reason = (english && text(record.reason_en)) || text(record.reason)
  switch (record.status) {
    case 'passed':
      if (record.bit_count) {
        return {
          tone: 'pass',
          text: t.passedBits(record.seconds ?? '', text(record.at), record.bit_count),
          title: (english && record.bit_count_note_en) || record.bit_count_note,
        }
      }
      return { tone: 'pass', text: t.passed(record.seconds ?? '', text(record.at)) }
    case 'not_applicable':
      return { tone: 'info', text: reason }
    case 'license_unavailable':
      // 授權不足：健檢沒跑完，不代表模型有問題。
      return { tone: 'warn', text: t.notFinished(reason.slice(0, DETAIL_CHARS)), title: reason }
    case 'invalid_result': {
      const detail = (english && text(record.detail_en)) || text(record.detail)
        || text(record.reason).replace(LEGACY_INVALID_PREFIX, '')
      const more = detail.length > DETAIL_CHARS ? '…' : ''
      const shown = `${detail.slice(0, DETAIL_CHARS)}${more}`
      return {
        tone: 'warn',
        text: isNoEyeData(record) ? t.invalidNoEye(shown) : t.invalidResult(shown),
        title: reason,
      }
    }
    default:
      return { tone: 'fail', text: t.failed(reason.slice(0, DETAIL_CHARS)), title: reason }
  }
}
