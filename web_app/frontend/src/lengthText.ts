// 僅以已知來源數值格式化展示；歷史日誌與自由文字維持原樣。
import type { Messages } from './i18n/zh-TW'
import { zhLengthText } from './i18n/zh-TW'
import { enLengthText } from './i18n/en'
import { formatLength, type DisplayLengthUnit } from './lengthUnits'

export function lengthText(t: Messages, unit: DisplayLengthUnit, locale: string): Messages {
  return (locale === 'en' ? enLengthText : zhLengthText)(t, unit, formatLength)
}
