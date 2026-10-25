// 語言 → 字典。不碰 React：非 React 模組（healthcheckStatus、
// revealPath…）收一個 `lang` 參數，從這裡取字典；Node 測試照樣能跑。
// 它們要的不只是字典，還要依語言挑後端的 `*_en` 欄位，所以傳語言而不是傳字典。

import { en } from './en'
import { initialLang, LANG_STORAGE_KEY } from './lang'
import type { Lang } from './lang'
import { zhTW } from './zh-TW'
import type { Messages } from './zh-TW'

const CATALOGS: Record<Lang, Messages> = { 'zh-TW': zhTW, en }

/** 看不懂的值一律回繁中（舊呼叫端不傳語言時就是原本的中文畫面）。 */
export function messagesFor(lang: Lang = 'zh-TW'): Messages {
  return CATALOGS[lang] ?? zhTW
}

function readStoredLang(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(LANG_STORAGE_KEY)
  } catch {
    return null      // 隱私模式或 WebView2 關掉儲存：當成沒選過
  }
}

/** 目前畫面上的語言，給 React 樹外、沒有人傳語言進來的地方用（main.tsx 的
 *  onbeforeunload、reportApi 自己產生的錯誤）。和 LangProvider 同一套規則：
 *  切換時 setLang 會寫進 localStorage，所以讀到的就是畫面上的語言。 */
export function currentLang(): Lang {
  return initialLang(readStoredLang(),
    typeof navigator === 'undefined' ? '' : navigator.language)
}
