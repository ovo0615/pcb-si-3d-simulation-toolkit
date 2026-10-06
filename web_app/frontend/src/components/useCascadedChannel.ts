// 本次工作階段最後一次串接（或載入）的完整通道 Touchstone。
//
// IBIS、IBIS-AMI 與多埠三個精靈的第一步都要選一份完整通道 Touchstone。剛跑完
// 模擬的人手上就有那一份，卻只能去檔案總管找路徑再貼回來——不只多一步，還很
// 容易貼到舊的那一份，而舊檔跑得起來、只是答案是上一次的。
import { useEffect, useState } from 'react'

export interface CascadedChannel {
  path: string
  n_ports: number
  port_names: string[]
}

/** 「本階段的完整通道換人了」的通知事件。
 *
 *  這個 hook 原本只在掛載時問一次。精靈是常駐的，所以使用者在左邊按下
 *  「執行電路串接」之後，右邊的「用剛才串好的通道」永遠不會出現——那正是
 *  這個模組存在要消滅的那一步。改成串接完成時廣播一下，聽到就重讀。 */
const CHANGED_EVENT = 'pcbsi:cascaded-channel-changed'

/** 串接（或載入外部 .sNp）成功之後呼叫，讓已經掛載的精靈重讀。 */
export function notifyCascadedChannelChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

export function useCascadedChannel(): CascadedChannel | null {
  const [channel, setChannel] = useState<CascadedChannel | null>(null)
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const response = await fetch('/api/cascade/current')
        if (!response.ok) return
        const body = await response.json() as CascadedChannel
        if (cancelled) return
        // 沒有串接過就回空字串。那不是錯誤，只是按鈕不該出現。
        setChannel(body.path ? body : null)
      } catch {
        if (!cancelled) setChannel(null)
      }
    }
    void refresh()
    const onChanged = () => { void refresh() }
    window.addEventListener(CHANGED_EVENT, onChanged)
    return () => {
      cancelled = true
      window.removeEventListener(CHANGED_EVENT, onChanged)
    }
  }, [])
  return channel
}
