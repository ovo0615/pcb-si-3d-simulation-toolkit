// 介面語言（卡 0087）。用法：
//
//   const { t, lang, setLang } = useT()
//   <button>{t.menu.file}</button>
//
// 首次開啟依 Windows 顯示語言，選過就記在 localStorage（規則在 lang.ts）。
// 切換時同步 <html lang> 與 document.title。

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { notifyShellLanguage } from '../desktopBridge'
import { currentLang, messagesFor } from './catalog'
import { LANG_STORAGE_KEY } from './lang'
import type { Lang } from './lang'
import { zhTW } from './zh-TW'
import type { Messages } from './zh-TW'

export type { Lang } from './lang'
export type { Messages } from './zh-TW'
export { LANG_NAMES, LANGS } from './lang'
export { currentLang, messagesFor } from './catalog'

type LangState = {
  lang: Lang
  t: Messages
  setLang: (lang: Lang) => void
}

const LangContext = createContext<LangState>({
  lang: 'zh-TW',
  t: zhTW,
  setLang: () => undefined,
})

export function LangProvider({ children }: { children: ReactNode }) {
  // 起始語言（localStorage 選過的，否則依顯示語言）的規則在 catalog.ts 的 currentLang。
  const [lang, setLangState] = useState<Lang>(currentLang)

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next)
    } catch { /* 存不了就只在這次生效 */ }
  }, [])

  const t = messagesFor(lang)
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t.app.title
  }, [lang, t])
  // 工具視窗的標題列、關窗確認框跟著換（setLang 與每次載入都送；純瀏覽器略過）。
  useEffect(() => notifyShellLanguage(lang), [lang])

  const value = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useT(): LangState {
  return useContext(LangContext)
}
