// 通道證據徽章：這份 S 參數是誰、用什麼設定、在什麼狀態下解出來的。
//
// 後端早就有 channel_provenance 與 channel_quality 兩套判定，但結果從來沒有
// 離開過後端——2026-08-31 盤點時，frontend/src 全文搜尋 provenance 與
// calibrated 都是 0 命中。這個元件就是那個缺掉的出口。
//
// 三個結果頁（串接、TDR、S 參數）共用同一列，所以做成獨立元件而不是各自
// 寫一份：判定的措辭要一致，否則同一份檔案在不同分頁會像有不同的結論。

import { useEffect, useState } from 'react'

type Level = 'ok' | 'warn' | 'unknown'

type Badge = {
  key: string
  label: string
  value: string
  level: Level
  detail: string
}

type Evidence = {
  path: string
  has_provenance: boolean
  may_claim_verified_channel: boolean
  badges: Badge[]
  warnings: string[]
  n_ports: number | null
}

/** 「量不出來」與「量出來不合格」刻意不同色——混成同一個顏色，
 *  使用者會以為模型有問題，而其實是我們不知道。 */
const LEVEL_STYLE: Record<Level, { dot: string; text: string }> = {
  ok: { dot: '#3f9a5c', text: '通過' },
  warn: { dot: '#c9652f', text: '要看' },
  unknown: { dot: '#8a8f99', text: '未知' },
}

export default function EvidenceBadges(
  { path, expectedPorts, extra, dark }: {
    path: string
    expectedPorts?: number | null
    /** 呼叫端已經知道、但不屬於這個檔案的證據（例如這次分析用了誰的
     *  緩衝器模型）。模型來源屬於分析，不屬於 Touchstone，所以由呼叫端傳。 */
    extra?: Badge[]
    /** 放在深色的結果畫布上時換一組顏色；措辭完全不變。 */
    dark?: boolean
  },
) {
  const [data, setData] = useState<Evidence | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string>('')

  useEffect(() => {
    if (!path) { setData(null); setError(''); return }
    let cancelled = false
    const params = new URLSearchParams({ path })
    if (expectedPorts) params.set('expected_ports', String(expectedPorts))
    setError('')
    void fetch(`/api/channel/evidence?${params.toString()}`)
      .then(async res => {
        if (!res.ok) throw new Error((await res.json())?.detail || `HTTP ${res.status}`)
        return res.json()
      })
      .then(json => { if (!cancelled) setData(json) })
      .catch(err => { if (!cancelled) setError(String(err.message || err)) })
    return () => { cancelled = true }
  }, [path, expectedPorts])

  const root = 'evidence-badges' + (dark ? ' evidence-badges--dark' : '')
  if (!path) return null
  if (error) {
    return (
      <div className={root}>
        <div className="evidence-badges__error">證據讀不到：{error}</div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className={root}>
        <div className="evidence-badges__error">讀取證據中…</div>
      </div>
    )
  }

  const badges = [...data.badges, ...(extra || [])]

  return (
    <div className={root}>
      <div className="evidence-badges__row">
        {badges.map(b => (
          <button
            key={b.key}
            type="button"
            className={`evidence-badge evidence-badge--${b.level}`}
            title={b.detail || undefined}
            onClick={() => setOpen(open === b.key ? '' : b.key)}>
            <span className="evidence-badge__dot"
              style={{ background: LEVEL_STYLE[b.level].dot }} />
            <span className="evidence-badge__label">{b.label}</span>
            <span className="evidence-badge__value">{b.value}</span>
          </button>
        ))}
      </div>
      {badges.filter(b => b.key === open && b.detail).map(b => (
        <div key={b.key} className="evidence-badges__detail">{b.detail}</div>
      ))}
      {!data.may_claim_verified_channel && (
        <div className="evidence-badges__detail">
          這份結果<b>不得標示為「通道求解已驗證」</b>——
          {data.has_provenance
            ? '來源證據存在但未通過查核。'
            : '旁邊沒有來源證據檔，工具無從確認它怎麼來的。'}
        </div>
      )}
    </div>
  )
}
