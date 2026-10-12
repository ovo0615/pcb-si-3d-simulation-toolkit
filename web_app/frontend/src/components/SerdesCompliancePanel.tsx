// SerDes 合規判定（#0084）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 頻域限值線、TDR 上下限、眼罩、ERL 對一份使用者自建的規格設定檔判定
// （ADR-0015：工具不內建規格限值）。判定結果會自動附進 HTML 報告的
// 「SerDes 合規總表」——前提是報告指定的通道檔就是這裡判的那一份。
import { useState } from 'react'

import { errorText, pickList, pickText } from '../backendFields'
import { useT } from '../i18n'
import OpenFolderButton from './OpenFolderButton'
import type { Lang, Messages } from '../i18n'
import BetaBadge from './BetaBadge'

type SerdesText = Messages['serdes']

interface Check {
  kind: string; name: string; status: string; why?: string; why_en?: string; note?: string
  margin?: number | null; parameter?: string; eye?: string
  violations?: { start: number; stop: number; distance_mm?: number[] }[]
}
interface JudgeResult {
  verdict: string; warnings?: string[]; checks: Check[]; disclaimer?: string
  profile?: { name: string; version: string; source: string }
  report_table?: { columns: string[]; rows: string[][]; verdicts: string[] } | null
  erl_run?: { result_path?: string | null }
}
interface LoadedProfile {
  name: string; version: string; source: string
  frequency_limits: unknown[]; tdr_limits: unknown[]; eye_masks: unknown[]; erl: unknown
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    let english: unknown
    try {
      const body = await response.json()
      message = body?.detail || message
      english = body?.detail_en
    } catch { /* 保留 */ }
    throw Object.assign(new Error(message), { detail_en: english })
  }
  return response.json() as Promise<T>
}

/** 字典查表；查不到回空字串，呼叫端退回原值（不編一個好看的字蓋掉真正的狀態）。 */
function lookup(table: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : ''
}

/** 合規總表的一列。後端 `report_table` 是中文版（`serdes_report_table` 預設語言）；
 *  類別、判定、說明三欄改由這裡依語言產生——說明用後端的 `why`／`why_en`，
 *  不在前端翻譯。其餘欄位（名稱、數值、限值）照後端原文。 */
function localizedRow(row: string[], check: Check | undefined, tx: SerdesText,
  lang: Lang): string[] {
  if (!check || row.length !== tx.columns.length) return row
  // 同後端 `_check_why`：沒有中文 why 時就用 why_en。
  const why = pickText(check, 'why', lang) || (typeof check.why_en === 'string' ? check.why_en : '')
  const note = typeof check.note === 'string' ? check.note : ''
  const notes = [why, note ? tx.noteSource(note) : ''].filter(Boolean).join(tx.whySep)
  const out = [...row]
  out[1] = lookup(tx.kind, String(check.kind)) || row[1]
  out[6] = lookup(tx.verdict, String(check.status)) || row[6]
  out[7] = notes
  return out
}
// 判定底色。報告的 `v-pass`／`v-fail` 只定義在報告 HTML 的樣式裡，工具畫面
// 沒有那些 class（2026-10-09 實機截圖：整張表沒有顏色，不通過的列看不出來）。
const ROW_STYLE: Record<string, React.CSSProperties> = {
  pass: { background: 'rgba(22, 128, 60, 0.18)' },
  fail: { background: 'rgba(197, 48, 48, 0.28)', fontWeight: 600 },
  incomplete: { background: 'rgba(183, 121, 31, 0.22)' },
}
const CELL: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)', padding: '4px 8px', textAlign: 'left',
}

export default function SerdesCompliancePanel() {
  const { t, lang } = useT()
  const tx = t.serdes
  const [touchstone, setTouchstone] = useState('')
  const [profilePath, setProfilePath] = useState('')
  const [profile, setProfile] = useState<LoadedProfile | null>(null)
  const [portOrder, setPortOrder] = useState('')
  const [useLatestTdr, setUseLatestTdr] = useState(true)
  const [runErl, setRunErl] = useState(false)
  const [busy, setBusy] = useState(false)
  // 存原本的錯誤物件，顯示時才用 errorText 依語言取 detail／detail_en。
  const [error, setError] = useState<unknown>(null)
  const [result, setResult] = useState<JudgeResult | null>(null)

  const browseTouchstone = async () => {
    try {
      const picked = await api<{ paths?: string[] }>('/api/browse_touchstone')
      const first = picked?.paths?.[0] || ''
      if (first) setTouchstone(first)
    } catch (reason) { setError(reason) }
  }

  const loadProfile = async (path: string) => {
    setError(null); setProfile(null); setResult(null)
    if (!path.trim()) return
    try {
      const out = await api<{ path: string; profile: LoadedProfile }>(
        '/api/compliance/serdes/load_profile', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
      setProfilePath(out.path)
      setProfile(out.profile)
    } catch (reason) {
      setError(reason)
    }
  }

  const browseProfile = async () => {
    try {
      const picked = await api<{ path?: string }>('/api/compliance/serdes/browse_profile')
      if (picked?.path) await loadProfile(picked.path)
    } catch (reason) { setError(reason) }
  }

  const judge = async () => {
    if (!profile) return
    setBusy(true); setError(null); setResult(null)
    try {
      // 介面上的埠號從 1 起算（同 S 參數工具箱的換埠序），送給後端前換成 0 起算。
      // \uFF0C 是全形逗號：中文輸入法打出來的「，」也要當分隔符號。
      const order = portOrder.split(/[\uFF0C,\s]+/).filter(Boolean).map(item => Number(item) - 1)
      const out = await api<JudgeResult>('/api/compliance/serdes/judge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touchstone_path: touchstone, profile, port_order: order,
          use_latest_tdr: useLatestTdr, run_erl: runErl,
        }),
      })
      setResult(out)
    } catch (reason) {
      setError(reason)
    } finally { setBusy(false) }
  }

  const tdrViolations = (result?.checks || [])
    .filter(check => check.kind === 'tdr')
    .flatMap(check => (check.violations || [])
      .filter(item => item.distance_mm)
      .map(item => tx.tdrViolation(check.name,
        item.distance_mm![0].toFixed(2), item.distance_mm![1].toFixed(2))))
  const warnings = result ? pickList(result, 'warnings', lang) : []
  const reportTable = result?.report_table
  const columns = reportTable && reportTable.columns.length === tx.columns.length
    ? [...tx.columns] : reportTable?.columns || []

  return (
    <div className="ibis-wizard">
      <section>
        <h3>{tx.title}<BetaBadge feature="B17" /></h3>
        <p className="hint">
          {tx.intro}
        </p>
        <label>{tx.touchstone}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input is-wide" value={touchstone}
              placeholder="channel.s4p"
              onChange={event => setTouchstone(event.target.value)} />
            <button className="btn" onClick={() => void browseTouchstone()}>{tx.browse}</button>
          </div>
        </label>
        <label>{tx.profile}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input is-wide" value={profilePath}
              placeholder="serdes_profile.json"
              onChange={event => setProfilePath(event.target.value)}
              onBlur={event => void loadProfile(event.target.value)} />
            <button className="btn" onClick={() => void browseProfile()}>{tx.browse}</button>
          </div>
        </label>
        {profile && (
          <p className="hint">
            {tx.profileSummary(profile.name, profile.version, profile.source || tx.sourceMissing,
              profile.frequency_limits.length, profile.tdr_limits.length,
              profile.eye_masks.length, Boolean(profile.erl))}
          </p>
        )}
        <label>{tx.portOrder}
          <input className="input" value={portOrder} placeholder="1,2,3,4"
            onChange={event => setPortOrder(event.target.value)} />
        </label>
        <p className="hint">{tx.portOrderHint}</p>
        <label>
          <input type="checkbox" checked={useLatestTdr}
            onChange={event => setUseLatestTdr(event.target.checked)} />
          {tx.useLatestTdr}
        </label>
        <label>
          <input type="checkbox" checked={runErl}
            onChange={event => setRunErl(event.target.checked)} />
          {tx.runErl}
        </label>
        <div>
          <button className="btn" disabled={busy || !profile || !touchstone.trim()}
            onClick={() => void judge()}>
            {busy ? tx.judging : tx.start}
          </button>
        </div>
        {error != null && <p className="error">{errorText(error, lang)}</p>}
      </section>

      {result && (
        <section>
          <h3>{tx.resultTitle(lookup(tx.verdict, String(result.verdict)) || result.verdict)}</h3>
          {reportTable && (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead><tr>{columns.map(col => <th key={col} style={CELL}>{col}</th>)}</tr></thead>
              <tbody>
                {reportTable.rows.map((row, index) => (
                  <tr key={index} style={ROW_STYLE[reportTable.verdicts[index]] || {}}>
                    {localizedRow(row, result.checks[index], tx, lang)
                      .map((cell, k) => <td key={k} style={CELL}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tdrViolations.length > 0 && (
            <p className="hint">{tx.tdrViolations(tdrViolations.join(tx.tdrViolationSep))}</p>
          )}
          {warnings.length > 0 && (
            <ul className="hint">{warnings.map(item => <li key={item}>{item}</li>)}</ul>
          )}
          <p className="hint">{pickText(result, 'disclaimer', lang)}</p>
          <p className="hint">{tx.reportHint}</p>
          {/* 只有跑了 ERL 才有輸出檔（com_reports/ERL_*）；純判定沒有資料夾可開。 */}
          <OpenFolderButton path={result.erl_run?.result_path} />
        </section>
      )}
    </div>
  )
}
