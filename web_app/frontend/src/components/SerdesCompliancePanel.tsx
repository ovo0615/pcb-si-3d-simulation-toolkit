// SerDes 合規判定（#0084）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 頻域限值線、TDR 上下限、眼罩、ERL 對一份使用者自建的規格設定檔判定
// （ADR-0015：工具不內建規格限值）。判定結果會自動附進 HTML 報告的
// 「SerDes 合規總表」——前提是報告指定的通道檔就是這裡判的那一份。
import { useState } from 'react'

interface Check {
  kind: string; name: string; status: string; why?: string
  margin?: number | null; parameter?: string; eye?: string
  violations?: { start: number; stop: number; distance_mm?: number[] }[]
}
interface JudgeResult {
  verdict: string; warnings?: string[]; checks: Check[]; disclaimer?: string
  profile?: { name: string; version: string; source: string }
  report_table?: { columns: string[]; rows: string[][]; verdicts: string[] } | null
}
interface LoadedProfile {
  name: string; version: string; source: string
  frequency_limits: unknown[]; tdr_limits: unknown[]; eye_masks: unknown[]; erl: unknown
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try { message = (await response.json()).detail || message } catch { /* 保留 */ }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

const VERDICT_LABEL: Record<string, string> = {
  pass: '通過', fail: '不通過', incomplete: '未完整', missing: '缺資料', not_evaluated: '未判定',
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
  const [touchstone, setTouchstone] = useState('')
  const [profilePath, setProfilePath] = useState('')
  const [profile, setProfile] = useState<LoadedProfile | null>(null)
  const [portOrder, setPortOrder] = useState('')
  const [useLatestTdr, setUseLatestTdr] = useState(true)
  const [runErl, setRunErl] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<JudgeResult | null>(null)

  const browseTouchstone = async () => {
    try {
      const picked = await api<{ paths?: string[] }>('/api/browse_touchstone')
      const first = picked?.paths?.[0] || ''
      if (first) setTouchstone(first)
    } catch (reason) { setError(String(reason)) }
  }

  const loadProfile = async (path: string) => {
    setError(''); setProfile(null); setResult(null)
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
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const browseProfile = async () => {
    try {
      const picked = await api<{ path?: string }>('/api/compliance/serdes/browse_profile')
      if (picked?.path) await loadProfile(picked.path)
    } catch (reason) { setError(String(reason)) }
  }

  const judge = async () => {
    if (!profile) return
    setBusy(true); setError(''); setResult(null)
    try {
      // 介面上的埠號從 1 起算（同 S 參數工具箱的換埠序），送給後端前換成 0 起算。
      const order = portOrder.split(/[，,\s]+/).filter(Boolean).map(item => Number(item) - 1)
      const out = await api<JudgeResult>('/api/compliance/serdes/judge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touchstone_path: touchstone, profile, port_order: order,
          use_latest_tdr: useLatestTdr, run_erl: runErl,
        }),
      })
      setResult(out)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  const tdrViolations = (result?.checks || [])
    .filter(check => check.kind === 'tdr')
    .flatMap(check => (check.violations || [])
      .filter(item => item.distance_mm)
      .map(item => `${check.name}：${item.distance_mm![0].toFixed(2)}～${item.distance_mm![1].toFixed(2)} mm`))

  return (
    <div className="ibis-wizard">
      <section>
        <h3>SerDes 合規判定</h3>
        <p className="hint">
          限值由你依規格書自建設定檔（JSON），工具不內建任何規格數值；
          判定結果不等同標準組織的正式認證。
        </p>
        <label>通道 Touchstone
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input is-wide" value={touchstone}
              placeholder="channel.s4p"
              onChange={event => setTouchstone(event.target.value)} />
            <button className="btn" onClick={() => void browseTouchstone()}>瀏覽…</button>
          </div>
        </label>
        <label>規格設定檔
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input is-wide" value={profilePath}
              placeholder="serdes_profile.json"
              onChange={event => setProfilePath(event.target.value)}
              onBlur={event => void loadProfile(event.target.value)} />
            <button className="btn" onClick={() => void browseProfile()}>瀏覽…</button>
          </div>
        </label>
        {profile && (
          <p className="hint">
            {profile.name} {profile.version}｜出處：{profile.source || '未註明（判定無法追溯）'}｜
            頻域 {profile.frequency_limits.length} 條、TDR {profile.tdr_limits.length} 條、
            眼罩 {profile.eye_masks.length} 個{profile.erl ? '、ERL 1 項' : ''}
          </p>
        )}
        <label>埠序（從 1 起算：近端 P, 近端 N, 遠端 P, 遠端 N；要 NEXT／FEXT 再接攻擊對 4 個）
          <input className="input" value={portOrder} placeholder="1,2,3,4"
            onChange={event => setPortOrder(event.target.value)} />
        </label>
        <p className="hint">埠序不從埠名推測（ADR-0038）。配錯不會報錯，只會判到別的埠。</p>
        <label>
          <input type="checkbox" checked={useLatestTdr}
            onChange={event => setUseLatestTdr(event.target.checked)} />
          使用最近一次 TDR 結果（必須是同一份 Touchstone）
        </label>
        <label>
          <input type="checkbox" checked={runErl}
            onChange={event => setRunErl(event.target.checked)} />
          執行 ERL（SPISim CalcERL，佔用 Electronics 授權）
        </label>
        <div>
          <button className="btn" disabled={busy || !profile || !touchstone.trim()}
            onClick={() => void judge()}>
            {busy ? '判定中…' : '開始判定'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <section>
          <h3>判定結果：{VERDICT_LABEL[result.verdict] || result.verdict}</h3>
          {result.report_table && (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead><tr>{result.report_table.columns.map(col => <th key={col} style={CELL}>{col}</th>)}</tr></thead>
              <tbody>
                {result.report_table.rows.map((row, index) => (
                  <tr key={index} style={ROW_STYLE[result.report_table!.verdicts[index]] || {}}>
                    {row.map((cell, k) => <td key={k} style={CELL}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tdrViolations.length > 0 && (
            <p className="hint">TDR 違規位置（沿走線距離，可到 TDR 分頁標回 Layout）：{tdrViolations.join('；')}</p>
          )}
          {(result.warnings || []).length > 0 && (
            <ul className="hint">{result.warnings!.map(item => <li key={item}>{item}</li>)}</ul>
          )}
          <p className="hint">{result.disclaimer}</p>
          <p className="hint">產生 HTML 報告時，若報告指定的通道檔就是這一份，會自動附上「SerDes 合規總表」。</p>
        </section>
      )}
    </div>
  )
}
