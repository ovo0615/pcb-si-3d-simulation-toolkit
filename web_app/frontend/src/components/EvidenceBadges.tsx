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
  /** 查核沒過的**原因**（`verify_for_analysis` 的 issues）。缺哪個欄位、
   *  哪一項對不上，只有這裡說得出來。後端已經在 `channel_evidence` 回傳
   *  這個欄位了，舊版沒有才留成選填。 */
  issues?: { check?: string; detail?: string }[]
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
  { path, expectedPorts, throughPaths, extra, dark }: {
    path: string
    expectedPorts?: number | null
    /** 穿透路徑 `[輸出埠, 輸入埠]`，**0 起算**的 Port 索引。2 埠以上的因果性
     *  只有給了這個才量得到，不給後端一律回「未判定」。呼叫端知道這次
     *  分析用了哪對 Port（TDR 的 input／output）時就傳過來。 */
    throughPaths?: [number, number][]
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
  // 陣列每次 render 都是新物件；用字串當相依，內容沒變就不重查。
  const throughKey = (throughPaths || []).map(([o, i]) => `${o},${i}`).join(';')

  useEffect(() => {
    if (!path) { setData(null); setError(''); return }
    let cancelled = false
    const params = new URLSearchParams({ path })
    if (expectedPorts) params.set('expected_ports', String(expectedPorts))
    for (const item of throughKey ? throughKey.split(';') : []) params.append('through_path', item)
    setError('')
    // 換檔案要先把上一份判定收掉。留著的話，新查詢還在飛的那段時間裡，
    // 上一個 Touchstone 的「通過」徽章會掛在新檔案的標題底下。
    setData(null)
    void fetch(`/api/channel/evidence?${params.toString()}`)
      .then(async res => {
        if (!res.ok) throw new Error((await res.json())?.detail || `HTTP ${res.status}`)
        return res.json()
      })
      .then(json => { if (!cancelled) setData(json) })
      .catch(err => { if (!cancelled) setError(String(err.message || err)) })
    return () => { cancelled = true }
  }, [path, expectedPorts, throughKey])

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
      {/* 後端算出來的提醒本來完全沒有出口：型別裡宣告了、端點也回了，
          畫面上一個字都沒有。 */}
      {(data.warnings || []).map((text, index) => (
        <div key={`warn-${index}`} className="evidence-badges__detail">{text}</div>
      ))}
      {!data.may_claim_verified_channel && (
        <div className="evidence-badges__detail">
          這份結果<b>不得標示為「通道求解已驗證」</b>——
          {data.has_provenance
            ? '來源證據存在但未通過查核。'
            : '旁邊沒有來源證據檔，工具無從確認它怎麼來的。'}
        </div>
      )}
      {/* 沒通過查核的話，把「哪一項沒過」也寫出來。只說「未通過查核」而不說
          原因，使用者無從修——而缺的常常只是 sidecar 少一個欄位。 */}
      {!data.may_claim_verified_channel
        && (data.issues || []).filter(item => item.detail).map((item, index) => (
          <div key={`issue-${index}`} className="evidence-badges__detail">
            {item.detail}
          </div>
        ))}
    </div>
  )
}
