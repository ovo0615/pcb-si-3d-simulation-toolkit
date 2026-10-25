// 工具視窗（pywebview）與純瀏覽器模式的差異集中在這裡。
//
// 視窗模式下 pywebview 會注入 `window.pywebview.api`；純瀏覽器模式下
// `window.pywebview` 不存在。各元件不要自己去摸 `window.pywebview`，
// 一律經過這裡，兩種模式的分岔才只有一份。
import { useEffect, useState } from 'react'
import { currentLang, messagesFor } from './i18n/catalog'

declare global {
  interface Window {
    /** 只有在工具視窗裡才存在；而且可能在頁面載入之後才注入，
     *  注入完成時會發 `pywebviewready` 事件。 */
    pywebview?: {
      api?: {
        copy_text?: (text: string) => Promise<boolean>
        set_language?: (lang: string) => Promise<boolean>
        finish_close?: (keepBackend: boolean) => Promise<boolean>
        cancel_close?: () => Promise<boolean>
        startup_painted?: () => Promise<boolean>
      }
    }
    /** 視窗外殼按 X 時呼叫：頁面顯示儲存／放棄對話框就回 true。 */
    __pcbsiRequestClose?: (payload: CloseRequestPayload) => boolean
  }
}

/** 外殼交給關窗對話框的「還在跑什麼」（desktop/shell.py 的 busy_payload）。 */
export interface CloseRequestPayload {
  busy: boolean
  unknown: boolean
  jobs: string[]
}

/** 掛上關窗對話框的入口；回傳取消函式。純瀏覽器模式掛了也不會被呼叫。 */
export function installCloseRequestHandler(handler: (payload: CloseRequestPayload) => boolean): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.__pcbsiRequestClose = handler
  return () => {
    if (window.__pcbsiRequestClose === handler) delete window.__pcbsiRequestClose
  }
}

/** 頁面已保存或放棄、也通知過後端：請外殼關窗。keepBackend＝還有工作在跑。 */
export async function finishShellClose(keepBackend: boolean): Promise<boolean> {
  const api = window.pywebview?.api
  if (!api?.finish_close) return false
  // 頁面自己的「離開確認」不能擋住已經確認過的關窗。
  window.onbeforeunload = null
  return Boolean(await api.finish_close(keepBackend))
}

export function cancelShellClose(): void {
  try {
    Promise.resolve(window.pywebview?.api?.cancel_close?.()).catch(() => undefined)
  } catch { /* 外殼收不到不影響頁面 */ }
}

/** 目前是否跑在工具視窗裡。 */
export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && !!window.pywebview
}

/** 是否跑在工具視窗裡；pywebview 晚注入時會在 `pywebviewready` 後變成 true。 */
export function useDesktopShell(): boolean {
  const [desktop, setDesktop] = useState(isDesktopShell)
  useEffect(() => {
    if (desktop) return
    const onReady = () => setDesktop(isDesktopShell())
    window.addEventListener('pywebviewready', onReady)
    // 掛上監聽之前就注入完成的話，事件已經錯過了，補查一次。
    onReady()
    return () => window.removeEventListener('pywebviewready', onReady)
  }, [desktop])
  return desktop
}

/** 複製文字到剪貼簿。
 *
 *  工具視窗裡 `navigator.clipboard` 不保證能用（WebView2 的權限與焦點規則
 *  跟瀏覽器不同），有 pywebview 的 `copy_text` 就走它；否則用瀏覽器 API。
 *  失敗時丟例外，讓呼叫端決定怎麼顯示；訊息依目前畫面語言。 */
export async function copyText(text: string): Promise<void> {
  const api = window.pywebview?.api
  if (api?.copy_text) {
    const ok = await api.copy_text(text)
    if (!ok) throw new Error(messagesFor(currentLang()).desktop.copyFailed)
    return
  }
  await navigator.clipboard.writeText(text)
}

/** 告訴工具視窗目前的介面語言，標題列、關窗確認框與橫幅跟著換。
 *
 *  純瀏覽器模式沒有 `window.pywebview`，什麼都不做；pywebview 晚注入時等
 *  `pywebviewready` 再送一次。回傳取消函式，語言又變了就不送舊的。 */
export function notifyShellLanguage(lang: string): () => void {
  if (typeof window === 'undefined') return () => undefined
  const send = () => {
    const api = window.pywebview?.api
    if (!api?.set_language) return false
    try {
      Promise.resolve(api.set_language(lang)).catch(() => undefined)
    } catch { /* 外殼收不到不影響頁面 */ }
    return true
  }
  if (send()) return () => undefined
  const onReady = () => {
    window.removeEventListener('pywebviewready', onReady)
    send()
  }
  window.addEventListener('pywebviewready', onReady)
  return () => window.removeEventListener('pywebviewready', onReady)
}
