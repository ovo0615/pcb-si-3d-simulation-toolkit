// 結果頁的參數抽屜（#0115）：精靈第 5 步與多埠分支共用。
//
// 結果頁只放眼圖；量測表、GetWave 疊眼、註記收進這個從右邊滑出的抽屜。
// 選抽屜不選對話框：對話框會蓋住眼圖，抽屜沒有遮罩、不搶焦點，可以一邊看
// 眼圖一邊對數字。外觀沿用燈箱（.ibis-eye-modal__panel）的配色與標題列。
//
// `inline` 為真時（沒有眼圖：失敗、沒有眼圖資料）內容直接攤在頁面上——
// 頁面上只剩一顆按鈕會看起來像什麼結果都沒有。
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { lightboxKeyAction } from '../eyeGallery'
import { useT } from '../i18n'

/** 抽屜開關；`resetKey`（工作 ID）換了就收起來，不讓上一份的數字跟新眼圖並排。 */
export function useResultDrawer(resetKey: unknown) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen(value => !value), [])
  useEffect(() => { setOpen(false) }, [resetKey])
  return { open, close, toggle }
}

export default function ResultDetailsDrawer({ open, onClose, inline, children }: {
  open: boolean
  onClose: () => void
  inline?: boolean
  children: ReactNode
}) {
  const { t: all } = useT()
  const t = all.resultDetails

  useEffect(() => {
    if (!open || inline) return
    const onKey = (event: KeyboardEvent) => {
      // 燈箱開著時它在 capture 階段 stopImmediatePropagation，這裡根本收不到 Esc；
      // defaultPrevented 是保險：別的元件已經處理過這個按鍵就不跟著關。
      if (event.defaultPrevented) return
      if (lightboxKeyAction(event.key) === 'close') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, inline, onClose])

  // data-report-tables：「更新報告快照」從這裡收量測表的文字（reportTables.ts）。
  // 抽屜掛在 body、又常是關著的，截圖拍不到；所以結果頁裡永遠留一份隱藏副本。
  if (inline) return <div className="result-drawer__inline" data-report-tables="true">{children}</div>
  const reportSource = <div hidden data-report-tables="true">{children}</div>
  if (!open) return reportSource
  // 掛到 body：理由同燈箱，祖先有 transform 會讓 position:fixed 以面板為準。
  return <>{reportSource}{createPortal((
    <aside className="result-drawer" role="dialog" aria-modal="false" aria-label={t.title}>
      <header>
        <strong>{t.title}</strong>
        <button type="button" className="btn" onClick={onClose}>{t.close}</button>
      </header>
      <div className="result-drawer__body">{children}</div>
    </aside>
  ), document.body)}</>
}
