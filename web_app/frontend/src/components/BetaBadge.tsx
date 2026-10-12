// 「Beta Option」標籤（#0131）。
//
// 文字標籤，不只靠顏色；說明可由滑鼠停留、鍵盤焦點或點擊開啟，Esc 關閉。
// 說明內容＝通用說明＋該項限制（語言檔 featureTier.limits），不另寫一份警語。
// 標籤只是標示，不改任何行為；送出前的確認在 betaGuard。

import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { useT } from '../i18n'
import { featureName } from '../featureTiers'

const BADGE_STYLE = {
  display: 'inline-block',
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 600,
  padding: '0 6px',
  borderRadius: 4,
  // 規劃第 4 節的配色：深底 #3A2B0B、字 #FFD166、框 #8A6D23（對比約 10:1）。
  background: '#3A2B0B',
  color: '#FFD166',
  border: '1px solid #8A6D23',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
  cursor: 'help',
  fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
} as const

interface Props {
  /** 登錄檔的功能 ID；說明取該項限制。 */
  feature?: string
  /** 群組／入口用：只顯示通用說明。 */
  label?: string
  style?: CSSProperties
}

export default function BetaBadge({ feature, label, style }: Props) {
  const { t } = useT()
  const ft = t.featureTier
  const [open, setOpen] = useState(false)
  const tipId = useId()
  const limit = feature ? (ft.limits as Record<string, string>)[feature] : ''
  const tip = [
    feature ? featureName(feature, ft) : '',
    limit,
    ft.summary,
  ].filter(Boolean).join('\n')

  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 6, ...style }}>
      <span
        className="beta-badge"
        data-feature={feature || undefined}
        tabIndex={0}
        role="button"
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        aria-label={`${label || ft.badge}${feature ? ` ${featureName(feature, ft)}` : ''}`}
        style={BADGE_STYLE}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(v => !v) }}
        onKeyDown={event => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); event.stopPropagation(); setOpen(v => !v)
          }
        }}
      >
        {label || ft.badge}
      </span>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          style={{
            position: 'absolute', zIndex: 10000, top: '100%', left: 0, marginTop: 4,
            width: 280, padding: '8px 10px', borderRadius: 6,
            background: '#1b1f26', border: '1px solid #8A6D23', color: '#e6edf5',
            fontSize: 12, lineHeight: 1.55, fontWeight: 400, whiteSpace: 'pre-line',
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)', textAlign: 'left',
            fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
          }}
        >
          {tip}
        </span>
      )}
    </span>
  )
}
