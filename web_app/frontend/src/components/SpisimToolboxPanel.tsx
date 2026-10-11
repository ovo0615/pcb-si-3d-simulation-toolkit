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
import { useT } from '../i18n'
import { errorText, pickText } from '../backendFields'

interface ToolboxOperation { name: string; description: string; description_en?: string }
interface BatchStatus {
  available: boolean; checked_at: string; detail: string; detail_en?: string
  /** 原生引擎待收尾紀錄還在（#0083）：後端自動對帳查不到時，讓使用者確認清除。 */
  cleanup_pending?: boolean; claim_id?: string | null; pid?: number | null; work_dir?: string
  /** #0113：refresh=0 只讀快取。沒探測過 probed:false；快取過期 expired:true。 */
  probed?: boolean; expired?: boolean
}
interface ComStandard { name: string; description: string; description_en?: string }
interface ComJobState {
  running?: boolean
  status?: string
  message?: string
  message_en?: string
  standard?: string
  /** 這件工作算的是哪一條通道。面板重掛時要靠它認回來——沒有它就無法確定
   *  結果屬於現在選的檔案。後端已經在 `start_com_job` 把它寫進工作狀態裡
   *  （spisim_batch.py），這裡是必然拿得到的，不是待補的欄位。 */
  touchstone_path?: string
  elapsed_seconds?: number
  error?: string
  error_en?: string
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

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    let detailEn: string | undefined
    try {
      const body = await response.json()
      message = body?.detail || message
      if (typeof body?.detail_en === 'string' && body.detail_en) detailEn = body.detail_en
    } catch { /* 保留 */ }
    // 英文介面要的 detail_en 掛在 Error 上，顯示時用 errorText 挑。
    throw Object.assign(new Error(message), { detail_en: detailEn })
  }
  return response.json() as Promise<T>
}

/** `active`：工具箱分頁正在顯示。模型頁一打開就掛載這個面板（隱藏），掛載時只讀快取，
 *  不得探測 SPISim（審稿 H1：探測會占 Electronics Enterprise，授權不通時卡 84 秒）。 */
export default function SpisimToolboxPanel({ active = true }: { active?: boolean } = {}) {
  const { t: messages, lang } = useT()
  const t = messages.spisim
  /** `renderComOutcome` 會從輪詢 interval 的舊閉包裡呼叫（見下方 comSourceRef 的說明），
   *  直接讀 `t` 會拿到啟動當下的語言；同步寫進 ref，切換語言後的結果文字才會對。 */
  const i18nRef = useRef({ t, lang })
  i18nRef.current = { t, lang }
  /** 操作選單的顯示名稱。中文介面照舊用後端的 description；英文介面優先用
   *  後端的 description_en，沒有就依操作代號（name，穩定識別字）取語言檔。 */
  const operationLabel = (item: ToolboxOperation) => {
    if (lang !== 'en') return item.description
    return item.description_en
      || (t.operations as Record<string, string>)[item.name] || item.description
  }
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
  const [clearError, setClearError] = useState('')
  const [comStandards, setComStandards] = useState<ComStandard[]>([])
  const [comStandard, setComStandard] = useState('')
  const [comJob, setComJob] = useState<ComJobState | null>(null)
  // 引擎留有待收尾紀錄時後端回 running:true（探測逾時留下的也是），但沒有 COM 在算：
  // 按鈕不能寫「計算中…」，取消也沒有東西可取消。輪詢照舊，紀錄清掉就恢復（#0083）。
  const comPending = comJob?.status === 'cleanup_pending'
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
    const { t, lang } = i18nRef.current
    if (state.status === 'failed') {
      // 失敗也要把舊值清掉：不清的話上一次成功的 COM 值會留在報告中繼資料裡，
      // 跟著這一次的快照被寫進報告。
      clearComMetadata()
      setError(pickText(state, 'error', lang) || t.comFailed)
      return
    }
    if (state.status === 'cancelled') { clearComMetadata(); setComResult(t.cancelled); return }
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
      mismatch = t.sourceMismatch(channel ? nameOf(channel) : t.sourceUnknown)
    } else {
      setModelsReportMetadata({
        'COM_標準': state.standard || comStandard,
        'COM_通道': nameOf(channel),
        'COM_產出檔數': out.artifacts?.length ?? 0,
        // 數字要進報告快照——圖上的字縮小後未必讀得出來。
        // 沒有值時寫「無法取得」而不是空字串：空字串會被報告產生器整筆丟掉，
        // 於是「量不到」看起來就跟「沒做這件事」一樣（ADR-0039）。
        // 鍵維持中文（後端相依，#0087 另案處理）；值是給人看的，照介面語言。
        'COM_最差值_dB': worst ?? t.metaNoComValue,
        'COM_最差case': com?.worst_case || t.metaUnavailable,
        'COM_門檻_dB': com?.pass_threshold_db ?? t.metaUnavailable,
        'COM_判定': com?.passed === undefined
          ? t.metaNoVerdict : (com.passed ? t.metaPass : t.metaFail),
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
      const verdict = com?.passed === undefined ? '' : t.verdict(com.passed)
      const threshold = com?.pass_threshold_db !== undefined
        ? t.threshold(com.pass_threshold_db) : ''
      parts.push(`COM = ${worst.toFixed(4)} dB${threshold}${verdict}\n` +
        t.worstCase(com?.worst_case || t.caseFallback))
      // 左邊是後端 headline 的鍵（spisim_batch._COM_HEADLINE_FIELDS 的中文標籤，
      // 拿來查值，不能改）；右邊是畫面上印的名稱。
      const headlineFields: [string, string][] = [
        ['眼高 VEO (mV)', t.headlineVeo], ['眼壓縮 VEC (dB)', t.headlineVec],
        ['Nyquist 插入損耗 (dB)', t.headlineIl], ['Tx 封裝長度 (mm)', t.headlinePkgTx],
      ]
      const rows = (com?.cases || []).map(item => {
        const head = item.headline || {}
        const detail = headlineFields
          .filter(([key]) => head[key] !== undefined)
          .map(([key, label]) => `${label} ${head[key]}`).join(t.listSep)
        return t.caseRow(item.case, String(item.com_db ?? '—')) +
          (detail ? `\n    ${detail}` : '')
      })
      if (rows.length) parts.push(t.perCase + '\n' + rows.join('\n'))
    }

    // 引擎自己的 HTML 報告與圖單獨列，不要淹沒在二十幾個檔案裡。
    if (out.html_report) parts.push(t.htmlReport + '\n' + out.html_report)
    if (out.plots?.length) {
      parts.push(t.plots(out.plots.length) + '\n' + out.plots.join('\n'))
    }
    if (out.messages?.length) parts.push(t.engineMessages + '\n' + out.messages.join('\n'))
    if (out.artifacts?.length) parts.push(t.allArtifacts + '\n' + out.artifacts.join('\n'))
    if (names.length && worst === null) {
      // 解析不出 COM 值時才貼原始報表，否則上面的摘要已經夠讀。
      parts.push(t.reportNamed(names[0]) + '\n' + (out.reports[names[0]] || ''))
    }
    setComResult(parts.length ? parts.join('\n\n')
      : `${t.noOutput}\n${out.stdout_tail || ''}`)
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
        // 只讀快取、不占授權（任何版本的後端都一樣）。
        setBatchStatus(await api<BatchStatus>('/api/spisim/license-status?refresh=0'))
      } catch { /* 舊後端沒有這個端點：等打開分頁再讀 */ }
    })()
  }, [])

  // 打開工具箱分頁才讀完整的引擎狀態（含待收尾紀錄的 PID／claim_id）。#0113 起
  // batch-status 不帶 refresh 永不探測；要探測請按「重新探測引擎」，COM 開跑時後端自己探。
  const statusLoaded = useRef(false)
  useEffect(() => {
    if (!active || statusLoaded.current) return
    statusLoaded.current = true
    void (async () => {
      try {
        setBatchStatus(await api<BatchStatus>('/api/spisim/batch-status'))
      } catch { /* 讀不到就維持掛載時的快取狀態 */ }
    })()
  }, [active])

  const browseInto = async (setter: (value: string) => void) => {
    try {
      // `/api/browse_touchstone` 回的是 **`paths` 陣列**（它是多選對話框）。
      // 這裡原本讀單數的 `picked.path`，永遠是 undefined，於是
      // **選完檔案、對話框關掉、欄位一個字都沒填、也沒有任何錯誤**。
      // 其餘三個呼叫點（串接、AMI、多道）都讀對了，只有這裡漏掉。
      const picked = await api<{ paths?: string[] }>('/api/browse_touchstone')
      const first = picked?.paths?.[0] || ''
      if (first) setter(first)
      else setError(t.noFilePicked)
    } catch (reason) { setError(errorText(reason, lang)) }
  }

  const runToolbox = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      const options: Record<string, unknown> = {}
      if (operation === 'renormalize') options.impedance_ohm = Number(impedance)
      if (operation === 'reorder') {
        // \uFF0C 是全形逗號：中文輸入法打出來的「，」也要當分隔符號。
        options.port_order = portOrder.split(/[\uFF0C,\s]+/).filter(Boolean).map(Number)
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
      setMessage(t.toolboxDone(out.output_path, out.ports, out.points))
    } catch (reason) {
      setError(errorText(reason, lang))
    } finally { setBusy(false) }
  }

  const openFolder = async (path: string) => {
    const failure = await revealPath(path, lang)
    if (failure) setError(failure)
  }

  // 沒探測過或快取過期時 COM 仍可按：開跑時後端會自己探測（#0113）。只有「探測過、沒過期、不可用」才擋。
  const notProbed = Boolean(batchStatus) && (batchStatus!.probed === false || batchStatus!.expired === true)
  const comUsable = Boolean(batchStatus?.available) || (notProbed && !batchStatus?.cleanup_pending)

  const reprobe = async () => {
    setProbing(true)
    try {
      setBatchStatus(await api<BatchStatus>('/api/spisim/batch-status?refresh=1'))
    } catch (reason) { setError(errorText(reason, lang)) } finally { setProbing(false) }
  }

  // 後端確定引擎、子程序都不在時會自己清（ADR-0064）；這裡是查不到時的後備。
  const clearPending = async () => {
    if (!batchStatus?.cleanup_pending) return
    const ok = window.confirm(t.clearPendingConfirm(String(batchStatus.pid ?? t.unknown)))
    if (!ok) return
    setClearError('')
    try {
      await api('/api/engine/clear_pending', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: batchStatus.claim_id ?? null }),
      })
      setBatchStatus(await api<BatchStatus>('/api/spisim/batch-status'))
    } catch (reason) {
      // 顯示在按鈕旁：面板底部的共用錯誤列在畫面外，按了像沒反應（#0083 實機驗證）。
      setClearError(errorText(reason, lang))
    }
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
      setError(errorText(reason, lang))
    }
  }

  const cancelCom = async () => {
    try {
      const state = await api<ComJobState>('/api/spisim/com/cancel',
        { method: 'POST' })
      setComJob(state)
      renderComOutcome(state)
    } catch (reason) {
      setError(errorText(reason, lang))
    }
  }

  return (
    <div className="ibis-wizard">
      <section>
        <h3>{t.toolboxTitle}</h3>
        <p className="hint">{t.toolboxHint}</p>
        <label>{t.sourceLabel}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input is-wide" value={source}
              placeholder="path\to\channel.s4p"
              onChange={event => setSource(event.target.value)} />
            <button className="btn" onClick={() => void browseInto(setSource)}>{t.browse}</button>
          </div>
        </label>
        <label>{t.operationLabel}
          <select className="input" value={operation}
            onChange={event => setOperation(event.target.value)}>
            {operations.map(item => (
              <option key={item.name} value={item.name}>{operationLabel(item)}</option>
            ))}
          </select>
        </label>
        <p className="hint">{(t.optionHints as Record<string, string>)[operation] || ''}</p>
        {operation === 'renormalize' && (
          <label>{t.impedanceLabel}
            <input className="input" value={impedance}
              onChange={event => setImpedance(event.target.value)} />
          </label>
        )}
        {operation === 'reorder' && (
          <label>{t.portOrderLabel}
            <input className="input" value={portOrder} placeholder="1,3,2,4"
              onChange={event => setPortOrder(event.target.value)} />
          </label>
        )}
        {operation === 'resample' && (
          <label>{t.pointsLabel}
            <input className="input" value={points}
              onChange={event => setPoints(event.target.value)} />
          </label>
        )}
        {operation === 'deembed' && <>
          <label>{t.leftFixture}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input is-wide" value={leftFixture}
                onChange={event => setLeftFixture(event.target.value)} />
              <button className="btn" onClick={() => void browseInto(setLeftFixture)}>{t.browse}</button>
            </div>
          </label>
          <label>{t.rightFixture}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input is-wide" value={rightFixture}
                onChange={event => setRightFixture(event.target.value)} />
              <button className="btn" onClick={() => void browseInto(setRightFixture)}>{t.browse}</button>
            </div>
          </label>
        </>}
        <button className="btn btn--primary" disabled={busy || !source}
          onClick={() => void runToolbox()}>
          {busy ? t.processing : t.run}
        </button>
        {message && <div className="model-library__notice">{message}</div>}
        {outputFolder && (
          <div className="field-row" style={{ marginTop: 6 }}>
            <button className="btn" onClick={() => void openFolder(outputFolder)}>
              {t.openFolder}
            </button>
          </div>
        )}
      </section>

      {comStandards.length > 0 && (
        <section>
          <h3>{t.comTitle}</h3>
          <p className="hint">{t.comHintClause}</p>
          <p className="hint">{t.comHintStandards(comStandards.length)}</p>
          <p className="hint">{t.comHintPorts}</p>
          <p className="hint">{t.comHintPortOrder}</p>
          <p className="hint">{t.comHintPreflight}</p>
          {notProbed && !batchStatus?.cleanup_pending && <p className="hint">{t.notProbed}</p>}
          {batchStatus && !batchStatus.available && (!notProbed || batchStatus.cleanup_pending) && (
            <div className="model-library__notice model-library__notice--error">
              {t.probeFailed}{pickText(batchStatus, 'detail', lang)}
              {batchStatus.cleanup_pending && (
                <div>
                  {t.pendingInfo(String(batchStatus.pid ?? t.unknown), batchStatus.work_dir || t.unknown)}
                  {' '}{t.pendingAutoRelease}
                  <button className="btn" style={{ marginLeft: 8 }}
                    onClick={() => void clearPending()}>
                    {t.clearPending}
                  </button>
                  {clearError && <div><strong>{t.notCleared}</strong>{clearError}</div>}
                </div>
              )}
            </div>
          )}
          <div className="field-row">
            <label style={{ minWidth: 260 }}>{t.standardLabel}
              <select className="input" value={comStandard}
                style={{ minWidth: 240 }}
                onChange={event => setComStandard(event.target.value)}>
                {comStandards.map(item => (
                  <option key={item.name} value={item.name}
                    title={pickText(item, 'description', lang)}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" disabled={probing} onClick={() => void reprobe()}>
              {probing ? t.probing : t.reprobe}
            </button>
            <button className="btn btn--primary"
              disabled={Boolean(comJob?.running) || !source || !comUsable || Boolean(comBlock)}
              title={comPending ? t.enginePendingTip
                : comBlock || (comUsable ? '' : t.probeFailedTip)}
              onClick={() => void startCom()}>
              {comPending ? t.enginePending : comJob?.running ? t.computing : t.computeCom}
            </button>
            <LicenseTag functions={['spisim_com']} style={{ alignSelf: 'center' }} />
            {comJob?.running && !comPending && (
              <button className="btn" onClick={() => void cancelCom()}>{t.cancel}</button>
            )}
          </div>
          <label style={{ display: 'flex', flexDirection: 'row', gap: 6,
            alignItems: 'center' }}>
            <input type="checkbox" checked={comOvernight}
              style={{ width: 'auto' }}
              onChange={event => setComOvernight(event.target.checked)} />
            {t.overnight}
          </label>
          <p className="hint">{t.overnightHint}</p>
          {comPending && (
            <p className="hint">{pickText(comJob, 'message', lang) || t.pendingNoDispatch}</p>
          )}
          {comJob?.running && !comPending && (
            <p className="hint">
              {t.runningStatus(comJob.standard || '', comJob.elapsed_seconds ?? 0)}
              {pickText(comJob, 'message', lang)}
            </p>
          )}
          {comFolder && (
            <div className="field-row" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => void openFolder(comFolder)}>
                {t.openFolder}
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
                data-report-title={t.comSnapshotTitle}
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
