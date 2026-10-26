// 介面語言的選擇規則。不碰 React、不 import 別的檔，才能用 Node 直接測。

export type Lang = 'zh-TW' | 'en'

export const LANGS: readonly Lang[] = ['zh-TW', 'en']

/** 使用者選過的語言存在這裡。鍵名帶版號：以後格式要改就換鍵，不讀舊值。 */
export const LANG_STORAGE_KEY = 'pcbsi.lang.v1'

/** 語言名稱一律用該語言自己寫（切到 English 也要看得懂「繁體中文」是哪個）。 */
export const LANG_NAMES: Record<Lang, string> = {
  'zh-TW': '繁體中文',
  en: 'English',
}

export function isLang(value: unknown): value is Lang {
  return value === 'zh-TW' || value === 'en'
}

/** 首次開啟：依 Windows 顯示語言（WebView2／瀏覽器的 navigator.language）。
 *  zh 開頭一律繁中，其餘 English。 */
export function detectLang(navigatorLanguage?: string | null): Lang {
  return /^zh/i.test(String(navigatorLanguage || '')) ? 'zh-TW' : 'en'
}

/** 存過合法的值就照存的；沒存過或存了看不懂的值才看顯示語言。 */
export function initialLang(stored: string | null | undefined,
  navigatorLanguage?: string | null): Lang {
  return isLang(stored) ? stored : detectLang(navigatorLanguage)
}
