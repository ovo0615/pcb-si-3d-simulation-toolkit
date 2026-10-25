// 從後端回傳的結構欄位判斷行為，不再比對中文字串。
//
// 原本這幾處是用「訊息裡有沒有某個中文字」決定行為：含「放行」就展開警告、
// 含「差動對」就退回單端、名稱開頭是「內建｜」就去掉前綴、註記開頭是
// 「結果無效：」就不重複印。切到英文後後端訊息不保證是中文，這些判斷會
// 靜默失效——不會報錯，只是該展開的沒展開、該退回的沒退回。
//
// 欄位約定見  分工計畫。每個函式都是「有結構欄位就只看欄位；欄位缺席
// （舊後端）才退回舊規則」，所以前後端哪一邊先合併都不會壞。

import { safeUserMessage } from './userMessages'
import type { Lang } from './i18n/lang'
import { messagesFor } from './i18n/catalog'
import { formatLength, type DisplayLengthUnit, type LengthSourceUnit } from './lengthUnits'

/** AMI 相容性錯誤帶錯誤放行（後端 `ami_channel` 的警告代碼）。 */
export const RELEASED_WITH_ERRORS = 'ami.released_with_errors'
/** 差動模式找不到可配對的差動對（`/api/cascade/auto_curves`）。 */
export const NO_DIFF_PAIRS = 'cascade.no_diff_pairs'

type WarningResult = { warnings?: unknown; warning_codes?: unknown } | null | undefined

/** 這次分析是不是帶著相容性錯誤放行的——是的話警告清單要預設展開。
 *  代碼以 `ami.released_with_errors` 開頭都算（舊紀錄還有 `.line`、`.not_x64` 變體）。 */
export function releasedWithErrors(result: WarningResult): boolean {
  if (!result) return false
  if (Array.isArray(result.warning_codes)) {
    return result.warning_codes.some(
      code => typeof code === 'string' && code.startsWith(RELEASED_WITH_ERRORS))
  }
  const warnings = Array.isArray(result.warnings) ? result.warnings : []
  return warnings.some(w => String(w).includes('放行'))
}

/** 後端錯誤是不是「找不到差動對」。`api` 會把 JSON 的 code 掛在 Error 上。 */
export function isNoDiffPairsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && code) return code === NO_DIFF_PAIRS
  return error instanceof Error && /差動對/.test(error.message)
}

export type ProfileListItem = {
  name: string
  builtin?: boolean
  label?: string
  label_en?: string
}

/** 設定檔在選單裡顯示的名稱。內建規格的 name 帶「內建｜」前綴（當鍵用），
 *  顯示時要去掉；後端給了 label 就用 label，沒給才從第一個分隔符號之後取。 */
export function profileLabel(profile: ProfileListItem, lang: Lang): string {
  if (lang === 'en' && typeof profile.label_en === 'string' && profile.label_en) {
    return profile.label_en
  }
  if (typeof profile.label === 'string' && profile.label) return profile.label
  const name = typeof profile.name === 'string' ? profile.name : String(profile.name ?? '')
  if (!profile.builtin) return name
  const cut = name.indexOf('｜')
  return cut >= 0 ? name.slice(cut + 1) : name
}

type Fields = Record<string, unknown>

function asFields(obj: unknown): Fields | null {
  return obj && typeof obj === 'object' ? obj as Fields : null
}

/** 後端給人看的一個欄位：英文介面優先用 `<key>_en`（message_en、reason_en、
 *  why_en、note_en、label_en、detail_en…），沒有就顯示原文，不在前端硬翻。 */
export function pickText(obj: unknown, key: string, lang: Lang, unit?: DisplayLengthUnit): string {
  const fields = asFields(obj)
  if (!fields) return ''
  if (unit && fields[`${key}_display`]) return displayLengthMessage(fields[`${key}_display`], lang, unit)
  const english = fields[`${key}_en`]
  if (lang === 'en' && typeof english === 'string' && english) return english
  const text = fields[key]
  return typeof text === 'string' ? text : text == null ? '' : String(text)
}

/** 丟出來的錯誤要顯示的字：英文介面優先用掛在 Error 上的 `detail_en`
 *  （reportApi、App 的 api 會掛），沒有就是 message。 */
export function errorText(error: unknown, lang: Lang): string {
  if (error instanceof Error && error.message === 'length.invalid') return messagesFor(lang).lengthUi.invalid
  if (error instanceof Error && error.message === 'length.range') return messagesFor(lang).lengthUi.range
  if (error instanceof Error && (error as { user_safe?: boolean }).user_safe === true) {
    const safe = error as Error & { detail?: string; detail_en?: string }
    return (lang === 'en' && safe.detail_en) || safe.detail || safe.message || safeUserMessage(error, lang)
  }
  return safeUserMessage(error, lang)
}

/** 後端的字串清單（warnings 等）：英文介面逐條換成同順序 `<key>_en` 的那條；
 *  長度對不上就整份用原文（約定是同順序同長度），某條是空字串就那條用原文。 */
export function pickList(obj: unknown, key: string, lang: Lang, unit?: DisplayLengthUnit): string[] {
  const fields = asFields(obj)
  const list = fields && Array.isArray(fields[key]) ? (fields[key] as unknown[]).map(String) : []
  const display = fields?.[`${key}_display`]
  if (unit && Array.isArray(display) && display.length === list.length) {
    return list.map((value, index) => display[index] ? displayLengthMessage(display[index], lang, unit) : value)
  }
  const english = fields?.[`${key}_en`]
  if (lang !== 'en' || !Array.isArray(english) || english.length !== list.length) return list
  return list.map((text, index) => {
    const item = english[index]
    return typeof item === 'string' && item ? item : text
  })
}

/** 只格式化 producer 明確標記的具名原值；舊欄位與自由文字不經這條路徑。 */
export function displayLengthMessage(message: unknown, lang: Lang, unit: DisplayLengthUnit): string {
  if (typeof message === 'string') return message
  const data = asFields(message)
  if (!data) return ''
  if (Array.isArray(data.parts)) return data.parts.map(part => displayLengthMessage(part, lang, unit)).join(String(data.separator ?? ''))
  const templates = asFields(data.templates)
  let text = String(templates?.[lang] ?? templates?.['zh-TW'] ?? '')
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(asFields(data.params) ?? {})) {
    params[key] = typeof value === 'object' ? displayLengthMessage(value, lang, unit) : String(value)
  }
  for (const [key, raw] of Object.entries(asFields(data.lengths) ?? {})) {
    const pair = raw as { value: number | number[]; unit: LengthSourceUnit }
    const measure = (value: number) => `${formatLength(value, pair.unit, unit)} ${unit}`
    params[key] = Array.isArray(pair.value) ? pair.value.map(measure).join(' / ') : measure(pair.value)
  }
  // 以具名 token 代入，沒有對既有 message／reason 執行正則重寫。
  for (const [key, value] of Object.entries(params)) text = text.split(`{${key}}`).join(value)
  return text
}

type Validity = { valid?: boolean; reason?: string } | null | undefined

/** 量測註記扣掉「結果無效」那一則——它另以紅框顯示，註記裡不重複。
 *  靠 validity.reason 認，不靠中文前綴；沒有 validity 就全留（多印一次無害）。 */
export function notesBesideValidity(notes: unknown, validity: Validity): string[] {
  const list = Array.isArray(notes) ? notes.map(String) : []
  const reason = validity?.valid === false && typeof validity.reason === 'string'
    ? validity.reason : ''
  return reason ? list.filter(note => !note.includes(reason)) : list
}
