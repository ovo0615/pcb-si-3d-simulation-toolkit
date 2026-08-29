// S 參數工具箱＋IEEE COM 簽核（2026-08-29）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 工具箱（重正規化／換埠序／重取樣／DC 外插／去嵌入）走 skrf 原生實作，
// 免授權、立即可用；COM 簽核走 AEDT 內建的 SPISim 批次引擎，授權實測
// 尚未打通，介面誠實顯示探測結果，不讓使用者按下去等七分鐘。
import { useEffect, useState } from 'react'

interface ToolboxOperation { name: string; description: string }
interface BatchStatus { available: boolean; checked_at: string; detail: string }
interface ComStandard { name: string; description: string }

const OPTION_HINTS: Record<string, string> = {
  renormalize: '目標阻抗（Ω），例如差分半邊 42.5、單端 50',
  reorder: '新埠序：逗號分隔的舊埠號，例如 1,3,2,4（新位置 k 放哪個舊埠）',
  resample: '重取樣點數，例如 1001',
  extrapolate_dc: '無參數：線性外插補出 DC 點',
  deembed: '左右治具 2 埠 Touchstone（慣例：Port1 朝儀器、Port2 朝 DUT）',
  flip: '無參數：Port1↔Port2 對調（限 2 埠）',
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

export default function SpisimToolboxPanel() {
  const [operations, setOperations] = useState<ToolboxOperation[]>([])
  const [operation, setOperation] = useState('renormalize')
  const [source, setSource] = useState('')
  const [impedance, setImpedance] = useState('42.5')
  const [portOrder, setPortOrder] = useState('')
  const [points, setPoints] = useState('1001')
  const [leftFixture, setLeftFixture] = useState('')
  const [rightFixture, setRightFixture] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null)
  const [probing, setProbing] = useState(false)
  const [comStandards, setComStandards] = useState<ComStandard[]>([])
  const [comStandard, setComStandard] = useState('')
  const [comBusy, setComBusy] = useState(false)
  const [comResult, setComResult] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const ops = await api<{ operations: ToolboxOperation[] }>(
          '/api/sparam/toolbox/operations')
        setOperations(ops.operations)
      } catch { /* 後端未啟動時整區留空 */ }
      try {
        const catalogue = await api<{ standards: ComStandard[] }>(
          '/api/spisim/com/standards')
        setComStandards(catalogue.standards)
        if (catalogue.standards.length) setComStandard(catalogue.standards[0].name)
      } catch { /* COM 素材不在就不顯示 */ }
      try {
        setBatchStatus(await api<BatchStatus>('/api/spisim/batch-status'))
      } catch { /* 探測失敗視同不可用 */ }
    })()
  }, [])

  const browseInto = async (setter: (value: string) => void) => {
    try {
      const picked = await api<{ path?: string }>('/api/browse_touchstone')
      if (picked.path) setter(picked.path)
    } catch (reason) { setError(String(reason)) }
  }

  const runToolbox = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      const options: Record<string, unknown> = {}
      if (operation === 'renormalize') options.impedance_ohm = Number(impedance)
      if (operation === 'reorder') {
        options.port_order = portOrder.split(/[，,\s]+/).filter(Boolean).map(Number)
      }
      if (operation === 'resample') options.points = Number(points)
      if (operation === 'deembed') {
        options.left_fixture = leftFixture
        options.right_fixture = rightFixture
      }
      const out = await api<{ output_path: string; ports: number; points: number }>(
        '/api/sparam/toolbox/process', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation, touchstone_path: source, options }),
        })
      setMessage(`完成：${out.output_path}（${out.ports} 埠、${out.points} 點）。`
        + '路徑可直接貼到串接或通道分析。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  const reprobe = async () => {
    setProbing(true)
    try {
      setBatchStatus(await api<BatchStatus>('/api/spisim/batch-status?refresh=1'))
    } catch (reason) { setError(String(reason)) } finally { setProbing(false) }
  }

  const runCom = async () => {
    setComBusy(true); setError(''); setComResult('')
    try {
      const out = await api<{
        status: string; reports: Record<string, string>
        artifacts: string[]; messages: string[]; stdout_tail: string
      }>('/api/spisim/com/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touchstone_path: source, standard: comStandard }),
      })
      const names = Object.keys(out.reports || {})
      const parts: string[] = []
      if (out.messages?.length) parts.push('引擎訊息：\n' + out.messages.join('\n'))
      if (out.artifacts?.length) parts.push('產出檔（含 IL／RL／ILD 曲線）：\n' + out.artifacts.join('\n'))
      if (names.length) parts.push(`報告 ${names[0]}：\n` + (out.reports[names[0]] || ''))
      setComResult(parts.length ? parts.join('\n\n')
        : `引擎已執行但沒有輸出。輸出尾段：\n${out.stdout_tail}`)
    } catch (reason) {
      setComResult('')
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setComBusy(false) }
  }

  return (
    <div className="ibis-wizard">
      <section>
        <h3>S 參數工具箱（免授權、skrf 原生）</h3>
        <p className="hint">
          處理過的檔案寫進模型庫旁的 sparam_processed，來源檔一個位元不動。
        </p>
        <label>來源 Touchstone
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input is-wide" value={source}
              placeholder="path\to\channel.s4p"
              onChange={event => setSource(event.target.value)} />
            <button className="btn" onClick={() => void browseInto(setSource)}>瀏覽…</button>
          </div>
        </label>
        <label>操作
          <select className="input" value={operation}
            onChange={event => setOperation(event.target.value)}>
            {operations.map(item => (
              <option key={item.name} value={item.name}>{item.description}</option>
            ))}
          </select>
        </label>
        <p className="hint">{OPTION_HINTS[operation] || ''}</p>
        {operation === 'renormalize' && (
          <label>目標阻抗（Ω）
            <input className="input" value={impedance}
              onChange={event => setImpedance(event.target.value)} />
          </label>
        )}
        {operation === 'reorder' && (
          <label>新埠序
            <input className="input" value={portOrder} placeholder="1,3,2,4"
              onChange={event => setPortOrder(event.target.value)} />
          </label>
        )}
        {operation === 'resample' && (
          <label>點數
            <input className="input" value={points}
              onChange={event => setPoints(event.target.value)} />
          </label>
        )}
        {operation === 'deembed' && <>
          <label>左側治具（.s2p）
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input is-wide" value={leftFixture}
                onChange={event => setLeftFixture(event.target.value)} />
              <button className="btn" onClick={() => void browseInto(setLeftFixture)}>瀏覽…</button>
            </div>
          </label>
          <label>右側治具（.s2p，可留空）
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input is-wide" value={rightFixture}
                onChange={event => setRightFixture(event.target.value)} />
              <button className="btn" onClick={() => void browseInto(setRightFixture)}>瀏覽…</button>
            </div>
          </label>
        </>}
        <button className="btn btn--primary" disabled={busy || !source}
          onClick={() => void runToolbox()}>
          {busy ? '處理中…' : '執行'}
        </button>
        {message && <div className="model-library__notice">{message}</div>}
      </section>

      {comStandards.length > 0 && (
        <section>
          <h3>IEEE COM 簽核（SPISim 批次引擎）</h3>
          <p className="hint">對串接後的通道算 COM，直接對 IEEE 802.3／OIF 條文。</p>
          <p className="hint">內建 {comStandards.length} 份標準參數組態，不必自己填門檻。</p>
          <p className="hint">計算是分鐘級起跳（頻點多會到數十分鐘），先泡杯茶。</p>
          {batchStatus && !batchStatus.available && (
            <div className="model-library__notice model-library__notice--error">
              引擎探測未通過：{batchStatus.detail}
            </div>
          )}
          <div className="field-row">
            <label>標準
              <select className="input" value={comStandard}
                onChange={event => setComStandard(event.target.value)}>
                {comStandards.map(item => (
                  <option key={item.name} value={item.name} title={item.description}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" disabled={probing} onClick={() => void reprobe()}>
              {probing ? '探測中…' : '重新探測引擎'}
            </button>
            <button className="btn btn--primary"
              disabled={comBusy || !source || !batchStatus?.available}
              title={batchStatus?.available ? '' : '引擎探測未通過，先按「重新探測引擎」'}
              onClick={() => void runCom()}>
              {comBusy ? '計算中…（大通道要幾分鐘）' : '計算 COM'}
            </button>
          </div>
          {comResult && (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 320, overflow: 'auto' }}>
              {comResult}
            </pre>
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
