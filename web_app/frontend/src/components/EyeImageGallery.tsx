// 結果頁共用的眼圖畫廊（#0104）：精靈第 5 步與多埠分支共用（舊 AMI 面板已隨 ADR-0067 收掉）。
//
// 原圖 1600×900，照原尺寸放進結果頁時一張就佔滿一個畫面，量測表被擠到
// 很遠（Jeff 2026-10-10 截圖）。這裡一律兩欄 16:9 縮圖，窄於 760px 改單欄
// （index.css），點縮圖開燈箱看原圖。報告快照照舊以每張卡片為根截圖。
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { lightboxKeyAction, stepIndex } from '../eyeGallery'
import type { GalleryItem } from '../eyeGallery'
import { useT } from '../i18n'

export type { GalleryItem }

export default function EyeImageGallery({ items }: { items: GalleryItem[] }) {
  const { t: all } = useT()
  const t = all.eyeGallery
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const close = useCallback(() => setOpenIndex(null), [])
  const current = openIndex !== null && openIndex < items.length ? items[openIndex] : null

  useEffect(() => {
    if (openIndex === null) return
    const onKey = (event: KeyboardEvent) => {
      const action = lightboxKeyAction(event.key)
      if (!action) return
      event.preventDefault()
      if (action === 'close') setOpenIndex(null)
      else setOpenIndex(index => stepIndex(index ?? 0, action === 'prev' ? -1 : 1, items.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openIndex, items.length])

  // 結果換了（重跑、換工作）就關掉燈箱，不留著指向舊張數的索引。
  useEffect(() => { setOpenIndex(null) }, [items.length])

  if (!items.length) return null
  return (
    <>
      <div className="eye-gallery">
        {items.map((item, index) => (
          <article key={item.key} data-report-separate-snapshot="true"
            data-report-kind={item.reportKind} data-report-title={item.reportTitle}>
            <header><div><strong>{item.title}</strong>{item.sub && <span>{item.sub}</span>}</div></header>
            <button type="button" className="eye-gallery__thumb" title={t.open}
              aria-label={t.openNamed(item.title)} onClick={() => setOpenIndex(index)}>
              <img src={item.url} alt={item.alt || item.title} loading="lazy" />
            </button>
          </article>
        ))}
      </div>
      {/* 掛到 body：祖先 .panel.view-stage 有 transform／backdrop-filter，會讓 position:fixed
          改以面板為準，燈箱的標題與關閉鈕被切到畫面外（畫面驗收 B2）。 */}
      {current && createPortal((
        <div className="ibis-eye-modal" role="dialog" aria-modal="true" aria-label={current.title}
          onClick={close}>
          <div className="ibis-eye-modal__panel" onClick={event => event.stopPropagation()}>
            <header>
              <div><strong>{current.title}</strong>{current.sub && <span>{current.sub}</span>}</div>
              <div>
                {items.length > 1 && <span>{t.position(openIndex! + 1, items.length)}</span>}
                <button type="button" className="btn" onClick={close}>{t.close}</button>
              </div>
            </header>
            <img src={current.url} alt={current.alt || current.title} />
            <code>{items.length > 1 ? t.hintMany : t.hintOne}</code>
          </div>
        </div>
      ), document.body)}
    </>
  )
}
