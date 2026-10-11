// 分析執行歷史：每一次求解留下的不可變紀錄，以及「回到這一版設定」。
//
// ADR-0016 的機制（每次求解建立不可變紀錄、物理輸入改變後標示「設定不一致」
// 但仍可查看與比較）在後端寫了很久，而 `/api/ibis-channel/runs` 這個端點
// **前端從來沒有呼叫過**——2026-08-31 盤點時 frontend/src 搜尋
// `ibis-channel/runs` 是 0 命中。這個元件就是那個缺掉的入口。
//
// 這裡不刪任何東西，也不覆寫任何東西。「回到這一版設定」只是把那一次的
// 物理輸入填回表單，讓使用者按自己的意思重跑；舊紀錄原封不動留著。
// 一次求解要跑數十分鐘到數小時，能回頭比對的價值遠大於少一顆按鈕。

import { useCallback, useEffect, useState } from 'react'

import { errorText, pickText } from '../backendFields'
import { useT } from '../i18n'
import type { Messages } from '../i18n'
import { revealPath } from '../revealPath'

type RunHistoryText = Messages['runHistory']

/** 能從紀錄還原回表單的欄位。**不含**沒有把握對得上的東西——
 *  半套還原比不還原更危險，使用者會以為表單已經回到那一版。 */
export type RestorableRun = {
  touchstonePath: string
  txPackageId: string
  rxPackageId: string
  dataRateGbps: number
  corner: string
  /** 這一次紀錄裡有、但這個面板沒有把握填回去的東西。照實列出來。 */
  unrestored: string[]
}

/** 預設顯示的筆數。藏起來的會明講有幾筆，不安靜截斷。 */
const PREVIEW_COUNT = 8

type RunRow = {
  run_id: string
  run_dir: string
  readable: boolean
  status?: string
  created_at?: string
  error?: string
  relation: string
  relation_label: string
  run_kind?: string
  manifest: any
}

const RELATION_STYLE: Record<string, string> = {
  current: 'run-history__row--current',
  configuration_mismatch: 'run-history__row--mismatch',
  unreadable: 'run-history__row--unreadable',
  // `other_kind` 刻意不套「不一致」的樣式：那是**另一種分析**，
  // 不是同一件事跑出了不同設定。兩者混色會讓人以為設定被改壞了。
  other_kind: '',
  unknown: '',
}

/** 狀態字串取自 `analysis_runs` 的 `_SUCCESS_STATUS` 與 `_NON_REUSABLE_STATUS`
 *  （顯示文字在語言檔 `runHistory.status`）。
 *  對不到的直接顯示原文——編一個好看的中文會蓋掉真正的狀態。 */
function statusLabel(status: string | undefined, tx: RunHistoryText): string {
  const labels: Record<string, string> = tx.status
  const key = String(status)
  return (Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : '') || status || '—'
}

function restorableOf(manifest: any, tx: RunHistoryText): RestorableRun {
  const channel = manifest?.channel || {}
  const binding = manifest?.binding || {}
  const stimulus = manifest?.stimulus || {}
  const unrestored: string[] = []
  // 這幾項紀錄裡有，但填回表單需要重新對照模型庫或重新綁 Port，
  // 這個面板做不到——說出來，不要假裝已經還原。
  if (binding.ports?.length) unrestored.push(tx.unrestoredPorts)
  if (binding.lanes?.length) unrestored.push(tx.unrestoredLanes)
  if (binding.tx?.model || binding.rx?.model) unrestored.push(tx.unrestoredBuffers)
  // `!= null` 而不是 `!== undefined`：種子 0 是合法值要算進來，但 JSON `null`
  // （Python `None`）代表這一輪根本沒種子，講成「有種子還原不了」是假的。
  if (stimulus.random_seed != null) unrestored.push(tx.unrestoredSeed)
  return {
    touchstonePath: String(channel.source_path || ''),
    txPackageId: String(binding.tx?.package_id || ''),
    rxPackageId: String(binding.rx?.package_id || ''),
    dataRateGbps: Number(stimulus.data_rate_gbps || 0),
    corner: String(binding.corner || ''),
    unrestored,
  }
}


/** 明細列。**依種類給不同的欄位**——把 IBIS 的「資料率／Corner／通道」
 *  套在串接或 TDR 紀錄上會全部顯示「—」，讀起來像資料掉了，
 *  而不是「這一類分析本來就沒有這些欄位」。 */
function detailLines(run: RunRow, tx: RunHistoryText): string[] {
  const m = run.manifest || {}
  const kind = run.run_kind || 'ibis_channel'
  if (kind === 'cascade') {
    const c = m.cascade || {}
    const sources = c.sources || []
    return [
      tx.cascadeSummary(sources.length, (c.connections || []).length, (c.shorts || []).length),
      ...sources.slice(0, 4).map((item: any, i: number) =>
        tx.cascadeSource(i + 1, String(String(item.path || '').split(/[\\/]/).pop()),
          item.n_ports ?? '?')),
      sources.length > 4 ? tx.cascadeMore(sources.length - 4) : '',
      tx.output(m.outputs?.touchstone || '—'),
    ].filter(Boolean)
  }
  if (kind === 'tdr') {
    const t = m.tdr || {}
    const source = t.source_kind === 'measured_waveform' ? tx.tdrSourceMeasured
      : t.source_kind === 'touchstone' ? tx.tdrSourceTouchstone : (t.source_kind || '—')
    return [
      tx.tdrSource(source),
      tx.tdrFile(String(String(t.source_path || '—').split(/[\\/]/).pop())),
      tx.tdrDkRise(t.effective_dk ?? '—',
        t.rise_time_ps ? Number(t.rise_time_ps).toFixed(2) + ' ps' : '—'),
      t.t0_ns != null ? `t0 ${t.t0_ns} ns${
        t.t_end_ns != null ? tx.tdrLineEnd(t.t_end_ns) : ''}` : '',
      tx.tdrDiscontinuities(m.results?.[0]?.discontinuity_count ?? '—'),
    ].filter(Boolean)
  }
  // IBIS 通道與多道共用同一個形狀
  const r = restorableOf(m, tx)
  const lanes = m.binding?.multi_lane?.lanes || []
  return [
    tx.ibisRateCorner(r.dataRateGbps || '—', r.corner || '—')
    + (lanes.length ? tx.ibisLanes(lanes.length) : ''),
    tx.ibisChannel(r.touchstonePath || '—'),
  ]
}

export default function RunHistory(
  { touchstonePath, request, onRestore, kind, title }: {
    touchstonePath?: string
    /** 目前設定，用來算指紋比對。欄位不齊時後端會回 `unknown`
     *  ——「沒有東西可比」與「比過了不一樣」是兩回事。
     *  只有 IBIS 通道那條路會比指紋；其餘種類的參數形狀差太多，
     *  後端不假裝算得出來，一律回 `unknown`。 */
    request?: Record<string, unknown>
    onRestore?: (run: RestorableRun) => void
    /** 給了就讀那個種類的紀錄（`/api/runs`）。不給＝IBIS 通道的舊路徑。 */
    kind?: 'cascade' | 'tdr' | 'multi_lane' | 'ibis_channel'
    title?: string
  },
) {
  const { t, lang } = useT()
  const tx = t.runHistory
  const [runs, setRuns] = useState<RunRow[]>([])
  const [showAll, setShowAll] = useState(false)
  // 後端回的說明（note／fingerprint_error，英文介面優先 *_en）留原物件，
  // 切語言時才換得過去；開資料夾失敗的訊息已照語言產生，另外存。
  const [listing, setListing] = useState<Record<string, unknown> | null>(null)
  const [revealNote, setRevealNote] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState('')

  // 依序列化後的內容當相依，不是物件本身。呼叫端每次 render 都會給一個
  // 新的物件字面值——用物件當相依，`useEffect` 每次 render 都會重抓一次，
  // 變成無限迴圈。
  const requestKey = JSON.stringify(request || {})

  const refresh = useCallback(async () => {
    // IBIS 那條路要有 Touchstone 才比得了指紋；其餘種類讀的是固定位置，
    // 沒有 Touchstone 也該列得出來。
    if (!kind && !touchstonePath) {
      setRuns([]); setListing(null); setRevealNote(''); return
    }
    setBusy(true); setError(null)
    try {
      const res = kind
        ? await fetch('/api/runs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind }),
        })
        : await fetch('/api/ibis-channel/runs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            touchstone_path: touchstonePath, ...JSON.parse(requestKey),
          }),
        })
      const data = await res.json()
      if (!res.ok) {
        throw Object.assign(new Error(data?.detail || `HTTP ${res.status}`),
          { detail_en: data?.detail_en })
      }
      setRuns(data.runs || [])
      setListing(data && typeof data === 'object' ? data : null)
      setRevealNote('')
    } catch (exc) {
      setError(exc)
    } finally { setBusy(false) }
  }, [kind, touchstonePath, requestKey])

  useEffect(() => { void refresh() }, [refresh])

  if (!kind && !touchstonePath) return null

  // 預設只列最近幾筆，但**把藏起來的筆數講出來**——安靜地截斷會讓人以為
  // 這裡就是全部。實測一個輸出位置底下有 104 筆。
  const visible = showAll ? runs : runs.slice(0, PREVIEW_COUNT)
  const hidden = runs.length - visible.length
  const note = revealNote
    || pickText(listing, 'note', lang) || pickText(listing, 'fingerprint_error', lang)

  return (
    <div className="run-history">
      <div className="run-history__head">
        <b>{title || tx.title}</b>
        <button className="btn" style={{ fontSize: 10, padding: '0 7px' }}
          onClick={() => void refresh()} disabled={busy}>{tx.refresh}</button>
      </div>
      {error != null && (
        <div className="run-history__note">{tx.readFailed(errorText(error, lang))}</div>
      )}
      {note && <div className="run-history__note">{note}</div>}
      {error == null && !runs.length && (
        <div className="run-history__note">{tx.empty}</div>
      )}
      {visible.map(run => {
        const restorable = run.readable ? restorableOf(run.manifest, tx) : null
        const runError = pickText(run, 'error', lang)
        return (
          <div key={run.run_id}
            className={`run-history__row ${RELATION_STYLE[run.relation] || ''}`}>
            <div className="run-history__line">
              <span>{(run.created_at || '').replace('T', ' ').slice(0, 19) || run.run_id}</span>
              <span>{statusLabel(run.status, tx)}</span>
            </div>
            <div className="run-history__relation">{pickText(run, 'relation_label', lang)}</div>
            {runError && <div className="run-history__note">{runError}</div>}
            <div className="run-history__actions">
              <button className="btn" style={{ fontSize: 10, padding: '0 7px' }}
                onClick={() => void (async () => {
                  // `revealPath` 回傳錯誤字串而不是丟例外，丟掉它就變成
                  // 「按了沒反應」——舊後端回 405 的那句提示也一起消失。
                  const failure = await revealPath(run.run_dir, lang)
                  // 用 note 不用 error：error 前面掛著「讀不到：」的字樣。
                  if (failure) setRevealNote(failure)
                })()}>{tx.openFolder}</button>
              {restorable && onRestore && (
                <button className="btn" style={{ fontSize: 10, padding: '0 7px' }}
                  onClick={() => onRestore(restorable)}>{tx.restore}</button>
              )}
              {restorable && (
                <button className="btn" style={{ fontSize: 10, padding: '0 7px' }}
                  onClick={() => setOpen(open === run.run_id ? '' : run.run_id)}>
                  {open === run.run_id ? tx.collapse : tx.showSettings}
                </button>
              )}
            </div>
            {open === run.run_id && (
              <div className="run-history__detail">
                {detailLines(run, tx).map((line, index) => (
                  <div key={index} style={{ wordBreak: 'break-all' }}>{line}</div>
                ))}
                {restorable && restorable.unrestored.length > 0 && onRestore && (
                  <div>{tx.unrestored(restorable.unrestored.join(tx.listSep))}</div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {hidden > 0 && (
        <button className="btn" style={{ fontSize: 10, marginTop: 6 }}
          onClick={() => setShowAll(true)}>
          {tx.showAll(hidden)}
        </button>
      )}
      <div className="run-history__note">
        {tx.footer}
      </div>
    </div>
  )
}
