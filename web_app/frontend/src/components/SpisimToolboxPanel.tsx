// S 參數工具箱＋IEEE COM 簽核（2026-08-29）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 工具箱（重正規化／換埠序／重取樣／DC 外插／去嵌入）走 skrf 原生實作，
// 免授權、立即可用；COM 簽核走 AEDT 內建的 SPISim 批次引擎，授權實測
// 尚未打通，介面誠實顯示探測結果，不讓使用者按下去等七分鐘。
import { useEffect, useState } from 'react'
import { setModelsReportMetadata } from './reportMetadataStore'
import { revealPath, commonFolderOf } from '../revealPath'

interface ToolboxOperation { name: string; description: string }
interface BatchStatus { available: boolean; checked_at: string; detail: string }
interface ComStandard { name: string; description: string }
interface ComJobState {
  running?: boolean
  status?: string
  message?: string
  standard?: string
  elapsed_seconds?: number
  error?: string
  result?: {
    reports: Record<string, string>
    artifacts?: string[]
    messages?: string[]
    stdout_tail?: string
    com?: ComReport
    /** 引擎自己生的 HTML 報告與 BATH／FD／TD 圖。 */
    html_report?: string
    plots?: string[]
  }
}
/** 主報表 CSV 解析出來的結構（後端 `parse_com_report`）。 */
interface ComReport {
  cases?: { case: string; com_db: number | null;
            headline?: Record<string, number | string> }[]
  columns?: string[]
  worst_case?: string
  worst_com_db?: number | null
  pass_threshold_db?: number
  passed?: boolean
}

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
  const [comJob, setComJob] = useState<ComJobState | null>(null)
  const [comResult, setComResult] = useState('')
  const [comOvernight, setComOvernight] = useState(false)
  /** 「開啟結果資料夾」要開哪裡。工具箱與 COM 各自記一份：
   *  兩者的輸出落在不同地方（sparam_processed 對 com_reports）。 */
  const [outputFolder, setOutputFolder] = useState('')
  const [comFolder, setComFolder] = useState('')

  // COM 是背景工作（時域計算分鐘級起跳）：跑著就每 5 秒問一次狀態。
  useEffect(() => {
    if (!comJob?.running) return
    const timer = window.setInterval(async () => {
      try {
        const state = await api<ComJobState>('/api/spisim/com/status')
        setComJob(state)
        if (!state.running) renderComOutcome(state)
      } catch { /* 下一輪再試 */ }
    }, 5000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comJob?.running])

  function renderComOutcome(state: ComJobState) {
    if (state.status === 'failed') { setError(state.error || 'COM 計算失敗'); return }
    if (state.status === 'cancelled') { setComResult('已取消。'); return }
    const out = state.result
    if (!out) return
    const com = out.com
    const worst = typeof com?.worst_com_db === 'number' ? com.worst_com_db : null
    setModelsReportMetadata({
      'COM_標準': state.standard || comStandard,
      'COM_通道': source.split(/[\\/]/).pop() || source,
      'COM_產出檔數': out.artifacts?.length ?? 0,
      // 數字要進報告快照——圖上的字縮小後未必讀得出來。
      'COM_最差值_dB': worst ?? '',
      'COM_最差case': com?.worst_case || '',
      'COM_門檻_dB': com?.pass_threshold_db ?? '',
      'COM_判定': com?.passed === undefined ? '' : (com.passed ? '通過' : '不通過'),
      'COM_引擎訊息': (out.messages || []).slice(-1)[0] || '',
    })
    // 產物全部落在同一個時間戳資料夾；記下來給「開啟結果資料夾」用。
    setComFolder(commonFolderOf(out.artifacts || []))
    const names = Object.keys(out.reports || {})
    const parts: string[] = []

    // 結論放最前面。先前只印引擎訊息，COM 值埋在一長串 [MESG] 裡。
    if (worst !== null) {
      const verdict = com?.passed === undefined ? ''
        : `　${com.passed ? '✅ 通過' : '❌ 不通過'}`
      const threshold = com?.pass_threshold_db !== undefined
        ? `（門檻 ${com.pass_threshold_db} dB）` : ''
      parts.push(`COM = ${worst.toFixed(4)} dB${threshold}${verdict}\n` +
        `取最差的 ${com?.worst_case || '案例'}——` +
        `多個案例是同一條通道在不同封裝長度下各算一次。`)
      const rows = (com?.cases || []).map(item => {
        const head = item.headline || {}
        const detail = ['眼高 VEO (mV)', '眼壓縮 VEC (dB)', 'Nyquist 插入損耗 (dB)',
                        'Tx 封裝長度 (mm)']
          .filter(key => head[key] !== undefined)
          .map(key => `${key} ${head[key]}`).join('、')
        return `  ${item.case}：COM ${item.com_db ?? '—'} dB` +
          (detail ? `\n    ${detail}` : '')
      })
      if (rows.length) parts.push('逐案例：\n' + rows.join('\n'))
    }

    // 引擎自己的 HTML 報告與圖單獨列，不要淹沒在二十幾個檔案裡。
    if (out.html_report) parts.push('引擎 HTML 報告：\n' + out.html_report)
    if (out.plots?.length) {
      parts.push(`圖（BATH／FD／TD，共 ${out.plots.length} 張）：\n` +
        out.plots.join('\n'))
    }
    if (out.messages?.length) parts.push('引擎訊息：\n' + out.messages.join('\n'))
    if (out.artifacts?.length) parts.push('全部產出檔：\n' + out.artifacts.join('\n'))
    if (names.length && worst === null) {
      // 解析不出 COM 值時才貼原始報表，否則上面的摘要已經夠讀。
      parts.push(`報告 ${names[0]}：\n` + (out.reports[names[0]] || ''))
    }
    setComResult(parts.length ? parts.join('\n\n')
      : `引擎已執行但沒有輸出。輸出尾段：\n${out.stdout_tail || ''}`)
  }

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
      // `/api/browse_touchstone` 回的是 **`paths` 陣列**（它是多選對話框）。
      // 這裡原本讀單數的 `picked.path`，永遠是 undefined，於是
      // **選完檔案、對話框關掉、欄位一個字都沒填、也沒有任何錯誤**。
      // 其餘三個呼叫點（串接、AMI、多道）都讀對了，只有這裡漏掉。
      const picked = await api<{ paths?: string[] }>('/api/browse_touchstone')
      const first = picked?.paths?.[0] || ''
      if (first) setter(first)
      else setError('沒有選到檔案。若剛才有選，請回報——這代表對話框回傳的形狀變了。')
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
      setOutputFolder(out.output_path)
      setMessage(`完成：${out.output_path}（${out.ports} 埠、${out.points} 點）。`
        + '路徑可直接貼到串接或通道分析。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  const openFolder = async (path: string) => {
    const failure = await revealPath(path)
    if (failure) setError(failure)
  }

  const reprobe = async () => {
    setProbing(true)
    try {
      setBatchStatus(await api<BatchStatus>('/api/spisim/batch-status?refresh=1'))
    } catch (reason) { setError(String(reason)) } finally { setProbing(false) }
  }

  const startCom = async () => {
    setError(''); setComResult('')
    try {
      const state = await api<ComJobState>('/api/spisim/com/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touchstone_path: source, standard: comStandard,
          overnight: comOvernight }),
      })
      setComJob(state)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const cancelCom = async () => {
    try {
      const state = await api<ComJobState>('/api/spisim/com/cancel',
        { method: 'POST' })
      setComJob(state)
      renderComOutcome(state)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
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
        {outputFolder && (
          <div className="field-row" style={{ marginTop: 6 }}>
            <button className="btn" onClick={() => void openFolder(outputFolder)}>
              開啟結果資料夾
            </button>
          </div>
        )}
      </section>

      {comStandards.length > 0 && (
        <section>
          <h3>IEEE COM 簽核（SPISim 批次引擎）</h3>
          <p className="hint">對串接後的通道算 COM，直接對 IEEE 802.3／OIF 條文。</p>
          <p className="hint">內建 {comStandards.length} 份標準參數組態，不必自己填門檻。</p>
          <p className="hint">通道要 4 埠差分，埠序 [in+, in−, out+, out−]；2 埠只出頻域曲線。</p>
          <p className="hint">即 PORT_ORDER [1 2 3 4]，本工具串接輸出就是這個順序。</p>
          <p className="hint">送出前會預檢最低頻與埠序；一般約 8 秒，走背景可取消。</p>
          {batchStatus && !batchStatus.available && (
            <div className="model-library__notice model-library__notice--error">
              引擎探測未通過：{batchStatus.detail}
            </div>
          )}
          <div className="field-row">
            <label style={{ minWidth: 260 }}>標準
              <select className="input" value={comStandard}
                style={{ minWidth: 240 }}
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
              disabled={Boolean(comJob?.running) || !source || !batchStatus?.available}
              title={batchStatus?.available ? '' : '引擎探測未通過，先按「重新探測引擎」'}
              onClick={() => void startCom()}>
              {comJob?.running ? '計算中…' : '計算 COM（背景）'}
            </button>
            {comJob?.running && (
              <button className="btn" onClick={() => void cancelCom()}>取消</button>
            )}
          </div>
          <label style={{ display: 'flex', flexDirection: 'row', gap: 6,
            alignItems: 'center' }}>
            <input type="checkbox" checked={comOvernight}
              style={{ width: 'auto' }}
              onChange={event => setComOvernight(event.target.checked)} />
            放寬逾時到 12 小時（預設 4 小時）
          </label>
          <p className="hint">
            一般通道約 8 秒就出結果，上面那個選項是留給特別大的輸入，不是常態。
          </p>
          {comJob?.running && (
            <p className="hint">
              {comJob.standard}　·　已跑 {comJob.elapsed_seconds ?? 0} 秒　·
              {comJob.message || ''}
            </p>
          )}
          {comFolder && (
            <div className="field-row" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => void openFolder(comFolder)}>
                開啟結果資料夾
              </button>
              <span className="hint" style={{ wordBreak: 'break-all' }}>{comFolder}</span>
            </div>
          )}
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
