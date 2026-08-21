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

export function useCascadedChannel(): CascadedChannel | null {
  const [channel, setChannel] = useState<CascadedChannel | null>(null)
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/cascade/current')
        if (!response.ok) return
        const body = await response.json() as CascadedChannel
        // 沒有串接過就回空字串。那不是錯誤，只是按鈕不該出現。
        setChannel(body.path ? body : null)
      } catch {
        setChannel(null)
      }
    })()
  }, [])
  return channel
}
