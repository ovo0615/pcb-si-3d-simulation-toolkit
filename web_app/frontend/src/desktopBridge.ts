// 工具視窗（pywebview）與純瀏覽器模式的差異集中在這裡（卡片 #0073）。
//
// 視窗模式下 pywebview 會注入 `window.pywebview.api`；純瀏覽器模式下
// `window.pywebview` 不存在。各元件不要自己去摸 `window.pywebview`，
// 一律經過這裡，兩種模式的分岔才只有一份。
import { useEffect, useState } from 'react'

declare global {
  interface Window {
    /** 只有在工具視窗裡才存在；而且可能在頁面載入之後才注入，
     *  注入完成時會發 `pywebviewready` 事件。 */
    pywebview?: {
      api?: {
        copy_text?: (text: string) => Promise<boolean>
      }
    }
  }
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
 *  失敗時丟例外，讓呼叫端決定怎麼顯示。 */
export async function copyText(text: string): Promise<void> {
  const api = window.pywebview?.api
  if (api?.copy_text) {
    const ok = await api.copy_text(text)
    if (!ok) throw new Error('工具視窗無法寫入剪貼簿。')
    return
  }
  await navigator.clipboard.writeText(text)
}
