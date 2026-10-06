// S 參數工具箱＋IEEE COM 簽核（2026-08-29）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 工具箱（重正規化／換埠序／重取樣／DC 外插／去嵌入）走 skrf 原生實作，
// 免授權、立即可用；COM 簽核走 AEDT 內建的 SPISim 批次引擎，授權實測
// 尚未打通，介面誠實顯示探測結果，不讓使用者按下去等七分鐘。
import { useEffect, useRef, useState } from 'react'
import { setModelsReportMetadata } from './reportMetadataStore'
import { LicenseTag, useLicenseBlock } from './LicenseTag'
import { revealPath, commonFolderOf } from '../revealPath'

interface ToolboxOperation { name: string; description: string }
interface BatchStatus { available: boolean; checked_at: string; detail: string }
interface ComStandard { name: string; description: string }
interface ComJobState {
  running?: boolean
  status?: string
  message?: string
  standard?: string
  /** 這件工作算的是哪一條通道。面板重掛時要靠它認回來——沒有它就無法確定
   *  結果屬於現在選的檔案。後端已經在 `start_com_job` 把它寫進工作狀態裡
   *  （spisim_batch.py），這裡是必然拿得到的，不是待補的欄位。 */
  touchstone_path?: string
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
  // COM 會占 SIwave 求解授權（ADR-0062）：沒有空位就變灰並寫原因。
  const comBlock = useLicenseBlock(['spisim_com'])
  const [comResult, setComResult] = useState('')
  const [comOvernight, setComOvernight] = useState(false)
  /** 「開啟結果資料夾」要開哪裡。工具箱與 COM 各自記一份：
   *  兩者的輸出落在不同地方（sparam_processed 對 com_reports）。 */
  const [outputFolder, setOutputFolder] = useState('')
  const [comFolder, setComFolder] = useState('')
  /** 這一輪 COM 算的是哪一條通道（啟動時記下來，或從後端狀態認回來）。
   *  用 ref 不用 state：`renderComOutcome` 是從輪詢的 interval 裡呼叫的，
   *  那個閉包停在啟動當下那一次 render，讀 state 會讀到舊值——而這兩個值
   *  存在的意義正是「拿現在選的來源去比對」。 */
  const comSourceRef = useRef('')
  const sourceRef = useRef(source)
  sourceRef.current = source

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

  /**
   * 掛載時把還在跑（或已經跑完）的 COM 認回來。
   *
   * 這個面板是條件渲染的：切去模型庫／多道／AMI 再切回來就是一次
   * unmount＋mount，`comJob` 回到 null。而後端的訊息寫的是「可離開此頁，
   * 回來看狀態即可」，第二次按「計算 COM」還會被 422 擋掉——等於使用者
   * 照著提示做，結果既看不到進度也看不到結果，而且什麼都不能按。
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const state = await api<ComJobState>('/api/spisim/com/status')
        if (cancelled) return
        if (!state || state.status === 'idle') return
        setComJob(state)
        if (state.standard) setComStandard(state.standard)
        if (state.touchstone_path) {
          comSourceRef.current = state.touchstone_path
          // 重掛之後 `source` 是空的，而 `renderComOutcome` 比的正是它——
          // 不先把來源認回來，一件跑完的 COM 一被撿回來就當成「這份結果算
          // 的不是你現在選的檔案」，中繼資料被清掉、畫面上還多一句對不上的
          // 警告。`setSource` 是非同步的，所以 ref 要同步寫，下面那一行才
          // 比得到。
          if (!sourceRef.current) {
            sourceRef.current = state.touchstone_path
            setSource(state.touchstone_path)
          }
        }
        if (!state.running) renderComOutcome(state, state.touchstone_path)
      } catch { /* 後端沒起來就當作沒有工作 */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 把報告中繼資料裡的 COM 欄位清成空字串（產生器看到空值會整筆略過）。
   *  `reportMetadataStore` 只有 `Object.assign`，沒有刪除的入口。 */
  function clearComMetadata() {
    setModelsReportMetadata({
      'COM_標準': '', 'COM_通道': '', 'COM_產出檔數': '',
      'COM_最差值_dB': '', 'COM_最差case': '', 'COM_門檻_dB': '',
      'COM_判定': '', 'COM_引擎訊息': '',
    })
  }

  function renderComOutcome(state: ComJobState, jobSource?: string) {
    if (state.status === 'failed') {
      // 失敗也要把舊值清掉：不清的話上一次成功的 COM 值會留在報告中繼資料裡，
      // 跟著這一次的快照被寫進報告。
      clearComMetadata()
      setError(state.error || 'COM 計算失敗')
      return
    }
    if (state.status === 'cancelled') { clearComMetadata(); setComResult('已取消。'); return }
    const out = state.result
    if (!out) return
    const com = out.com
    const worst = typeof com?.worst_com_db === 'number' ? com.worst_com_db : null
    // 這份結果是哪一條通道算的。`reportMetadataStore` 是模組層級的全域，
    // 沒有人會替它把舊值清掉——算完 A、把來源換成 B、再拍 B 的快照，報告的
    // 中繼資料表上就會掛著 A 的 COM 值與判定。對不上就不寫，並且把舊值清掉。
    const channel = jobSource || comSourceRef.current || state.touchstone_path || ''
    const nameOf = (path: string) => path.split(/[\\/]/).pop() || path
    let mismatch = ''
    if (!channel || channel !== sourceRef.current) {
      clearComMetadata()
      mismatch = `這份結果算的是 ${channel ? nameOf(channel) : '（來源不明）'}，`
        + '與目前選的來源不同，數字沒有寫進報告中繼資料。'
    } else {
      setModelsReportMetadata({
        'COM_標準': state.standard || comStandard,
        'COM_通道': nameOf(channel),
        'COM_產出檔數': out.artifacts?.length ?? 0,
        // 數字要進報告快照——圖上的字縮小後未必讀得出來。
        // 沒有值時寫「無法取得」而不是空字串：空字串會被報告產生器整筆丟掉，
        // 於是「量不到」看起來就跟「沒做這件事」一樣（ADR-0039）。
        'COM_最差值_dB': worst ?? '無法取得（引擎未給 COM 值）',
        'COM_最差case': com?.worst_case || '無法取得',
        'COM_門檻_dB': com?.pass_threshold_db ?? '無法取得',
        'COM_判定': com?.passed === undefined
          ? '無法判定（沒有 COM 值）' : (com.passed ? '通過' : '不通過'),
        'COM_引擎訊息': (out.messages || []).slice(-1)[0] || '',
      })
    }
    // 產物全部落在同一個時間戳資料夾；記下來給「開啟結果資料夾」用。
    setComFolder(commonFolderOf(out.artifacts || []))
    const names = Object.keys(out.reports || {})
    const parts: string[] = []
    if (mismatch) parts.push(mismatch)

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
        // 用函式式更新：上面那個「認回背景工作」的 effect 可能已經把標準設成
        // 那件工作的標準了，直接覆寫會把它換掉（兩個 effect 讀到的都是舊值）。
        if (catalogue.standards.length) {
          setComStandard(prev => prev || catalogue.standards[0].name)
        }
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
    // 上一輪的 COM 值先清掉：新的一輪還沒有結果，這段期間拍的快照不該掛著
    // 舊通道的數字與判定。
    clearComMetadata()
    comSourceRef.current = source
    setComFolder('')
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
              disabled={Boolean(comJob?.running) || !source || !batchStatus?.available || Boolean(comBlock)}
              title={comBlock || (batchStatus?.available ? '' : '引擎探測未通過，先按「重新探測引擎」')}
              onClick={() => void startCom()}>
              {comJob?.running ? '計算中…' : '計算 COM（背景）'}
            </button>
            <LicenseTag functions={['spisim_com']} style={{ alignSelf: 'center' }} />
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
            // 捲軸放在外層 div，`<pre>` 本身維持自然高度：報告快照是以帶著
            // `data-report-separate-snapshot` 的節點為根去截的，根節點自己被
            // maxHeight 夾住的話，截出來一樣只有看得見的那幾行——而且圖上
            // 沒有任何記號說後面還有。
            <div style={{ maxHeight: 320, overflow: 'auto' }}>
              <pre
                data-report-separate-snapshot="true"
                data-report-kind="com-verdict"
                data-report-title="COM 判定輸出"
                style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>
                {comResult}
              </pre>
            </div>
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
