// AMI 通道（點對點）：IBIS-AMI 模型的完整分析路徑（2026-08-28 重建）。
//
// ADR-0055 收掉舊 AMI 面板的理由是「沒有人走得到」；這一版把它接回
// 標準流程：選兩側 AMI 套件 → 快速檢驗（無損直連基準）→ 接真實通道 →
// 眼圖。設定面刻意極簡（零新設定原則）：路由與調變由模型宣告自動解析，
// AMI 參數採 .ami 預設（親手設定的參數寫不進 AEDT 時後端會擋，預設的
// 略過並記錄——那套預檢已經在後端）。
import { useEffect, useMemo, useState } from 'react'
import type { ModelPackage } from './ModelLibrary'
import { useCascadedChannel } from './useCascadedChannel'
import { QuickProbeResult, QuickProbeView } from './AmiQuickProbe'
import { setModelsReportMetadata } from './reportMetadataStore'

interface AmiEditableParameter {
  name: string
  type?: string
  default?: string
  choices?: string[]
  minimum?: string
  maximum?: string
  description?: string
}

interface AmiCandidate {
  name: string
  editable_parameters?: AmiEditableParameter[]
  [key: string]: unknown
}

interface AmiSuggestion {
  touchstone: { n_ports: number; port_names: string[]; has_port_names: boolean }
  supported_topologies: string[]
  recommended_topology: string
  dual_single_lanes: { lane_id?: string; label?: string
    input_port?: string; output_port?: string }[]
  ports: { input_p: string; input_n: string; output_p: string; output_n: string }
  tx: { display_name: string; candidates: AmiCandidate[] }
  rx: { display_name: string; candidates: AmiCandidate[] }
  routes: string[]
  blockers: string[]
  warnings: string[]
}

interface AmiJob {
  running?: boolean
  status?: string
  phase?: string
  message?: string
  error?: string
  job_id?: string
  started_at?: number | null
  finished_at?: number | null
  result?: any
}

const ROUTE_LABEL: Record<string, string> = {
  auto: '自動（依模型宣告）',
  statistical: 'Statistical（統計眼）',
  getwave: 'GetWave（逐位元）',
  compare: '兩種都跑並列比較',
}

function sideBlocker(item: ModelPackage, side: 'tx' | 'rx'): string {
  const caps = item.capabilities
  if (!caps) return ''
  if (side === 'tx' && caps.tx_models === 0) return '沒有驅動器模型'
  if (side === 'rx' && caps.rx_models === 0) return '沒有接收器模型'
  return ''
}

function packageLabel(item: ModelPackage, side: 'tx' | 'rx'): string {
  const blocker = sideBlocker(item, side)
  if (blocker) return `${item.display_name}（${blocker}）`
  const status = item.compatibility?.status
  if (status === 'block') return `${item.display_name}（有錯誤）`
  if (status === 'warning') return `${item.display_name}（有警告）`
  return item.display_name
}

export default function AmiChannelPanel(
  { packages, onLibraryChanged }:
  { packages: ModelPackage[]; onLibraryChanged?: () => void | Promise<void> },
) {
  const cascaded = useCascadedChannel()
  const [touchstone, setTouchstone] = useState('')
  const [txPackageId, setTxPackageId] = useState('')
  const [rxPackageId, setRxPackageId] = useState('')
  const [dataRate, setDataRate] = useState(1.6)
  const [bitCount, setBitCount] = useState(2000)
  const [suggestion, setSuggestion] = useState<AmiSuggestion | null>(null)
  const [txModel, setTxModel] = useState('')
  const [rxModel, setRxModel] = useState('')
  const [topology, setTopology] = useState('')
  const [route, setRoute] = useState('auto')
  const [modulation, setModulation] = useState('NRZ')
  const [ports, setPorts] = useState({ input_p: '', input_n: '', output_p: '', output_n: '' })
  /** 使用者親手改過的 AMI 參數（只存改過的；空字串＝清掉、回到 .ami 預設）。
   *  親手設的值寫不進 AEDT 時後端會擋（既有的寫入預檢），不會默默略過。 */
  const [txParams, setTxParams] = useState<Record<string, string>>({})
  const [rxParams, setRxParams] = useState<Record<string, string>>({})
  const [job, setJob] = useState<AmiJob | null>(null)
  /** 快速檢驗那一輪的 job 與模型；靠 job_id 認出結果是基準眼圖。 */
  const [quickCheck, setQuickCheck] = useState<
    { jobId: string; txModel: string; rxModel: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState('')
  // 秒級預覽（SPISimAMI 引擎，2026-08-29）
  const [preview, setPreview] = useState<QuickProbeResult | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  // 快速檢驗的參考通道檔位（2026-08-29 下午）
  const [lossyReference, setLossyReference] = useState(false)
  // DDR4 Rx 遮罩統計簽核（乙8）：遮罩尺寸由使用者依 JESD79-4 填
  const [ddrMaskWidth, setDdrMaskWidth] = useState('')
  const [ddrMaskHeight, setDdrMaskHeight] = useState('')
  const [ddrRjSigma, setDdrRjSigma] = useState('1')

  const amiPackages = useMemo(
    () => packages.filter(item => item.kind === 'ibis_ami'), [packages])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const state = await fetch('/api/ami-channel/status').then(r => r.json())
        if (alive) setJob(state)
      } catch { /* 輪詢失敗不必打斷畫面 */ }
    }
    void tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  async function browseTouchstone() {
    setBusy(true); setError('')
    try {
      const picked = await fetch('/api/browse_touchstone').then(r => r.json())
      const first: string = picked?.paths?.[0] || ''
      if (first) { setTouchstone(first); setSuggestion(null) }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
  }

  /** 就地匯入 .ibs（會連同 .ami 與 DLL 一起收進模型庫）。 */
  async function importAmi(target: 'tx' | 'rx') {
    setBusy(true); setError('')
    try {
      const picked = await fetch('/api/models/browse').then(r => r.json())
      const paths: string[] = picked?.paths?.length ? picked.paths
        : (picked?.path ? [picked.path] : [])
      if (!paths.length) return
      let lastId = ''
      for (const path of paths) {
        const response = await fetch('/api/models/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.detail || `匯入失敗：${path}`)
        lastId = data?.model?.package_id || lastId
      }
      await onLibraryChanged?.()
      if (lastId) (target === 'tx' ? setTxPackageId : setRxPackageId)(lastId)
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
  }

  /** 快速檢驗：兩顆 AMI 模型背對背接無損參考通道，先看基準眼。 */
  async function runQuickCheck() {
    setBusy(true); setError(''); setStarted('')
    try {
      const response = await fetch('/api/ibis-channel/quick-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_package_id: txPackageId,
          rx_package_id: rxPackageId || txPackageId,
          data_rate_gbps: dataRate,
          reference: lossyReference ? 'lossy' : 'lossless',
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.detail || '快速檢驗啟動失敗')
      setQuickCheck({
        jobId: data.job_id || '',
        txModel: data.quick_check?.tx_model || '',
        rxModel: data.quick_check?.rx_model || '',
      })
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
  }

  /** 秒級預覽：Tx 模型的等化打在這條通道上長什麼樣（不開 AEDT）。 */
  async function runPreview() {
    setPreviewBusy(true); setPreviewError(''); setPreview(null)
    try {
      const response = await fetch(
        `/api/models/${encodeURIComponent(txPackageId)}/ami-quick-test`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: txModel || '',
            touchstone_path: touchstone,
            data_rate_gbps: dataRate,
            // 有 Rx 就做 Tx→Rx 串跑＋秒級統計眼（不開 AEDT）。
            rx_package_id: rxPackageId || txPackageId,
            rx_model: rxModel || '',
            modulation,
            // 4 埠差分：預檢帶入的埠對應直接沿用；沒跑預檢就交給後端
            // 用預設對應並在結果註明。
            ports,
            ddr4_mask: (Number(ddrMaskWidth) > 0 && Number(ddrMaskHeight) > 0)
              ? { width_ui: Number(ddrMaskWidth),
                  height_mv: Number(ddrMaskHeight),
                  rj_sigma_ps: Number(ddrRjSigma) || 1 }
              : {},
          }),
        })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.detail || '秒級預覽失敗')
      setPreview(data)
      if (data?.quick_eye?.metrics) {
        const m = data.quick_eye.metrics
        setModelsReportMetadata({
          '統計眼_眼高(V)': Number(m.eye_height_v ?? 0).toFixed(3),
          '統計眼_眼寬(UI)': Number(m.eye_width_ui ?? 0).toFixed(2),
          '統計眼_調變': data.quick_eye.modulation || 'NRZ',
          '統計眼_Tx': `${data.model}（${data.ami_file}）`,
          '統計眼_Rx': data.rx ? `${data.rx.model}（${data.rx.ami_file}）` : '—',
          '統計眼_通道': touchstone.split(/[\\/]/).pop() || touchstone,
          '統計眼_說明': '最壞情況疊加（Init/LTI），未含抖動與雜訊',
        })
      }
    } catch (exc) {
      setPreviewError(exc instanceof Error ? exc.message : String(exc))
    } finally { setPreviewBusy(false) }
  }

  async function runSuggest() {
    setBusy(true); setError(''); setSuggestion(null); setStarted('')
    try {
      const response = await fetch('/api/ami-channel/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touchstone_path: touchstone,
          tx_package_id: txPackageId,
          rx_package_id: rxPackageId || txPackageId,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.detail || 'AMI 預檢失敗')
      const s = data as AmiSuggestion
      setSuggestion(s)
      // 預設值全部從建議帶入；使用者只需要核對，不需要從零填。
      setTxModel(s.tx.candidates[0]?.name || '')
      setRxModel(s.rx.candidates[0]?.name || '')
      setTopology(s.recommended_topology || s.supported_topologies[0] || '')
      setPorts({ ...s.ports })
      setRoute('auto')
      // 換了預檢就清掉親手改的參數：那些值是綁著上一組模型的。
      setTxParams({}); setRxParams({})
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
  }

  async function start() {
    if (!suggestion) return
    setBusy(true); setError(''); setStarted('')
    try {
      const body: Record<string, unknown> = {
        touchstone_path: touchstone,
        tx_package_id: txPackageId,
        rx_package_id: rxPackageId || txPackageId,
        tx_model: txModel, rx_model: rxModel,
        topology,
        analysis_route: route,
        modulation,
        data_rate_gbps: dataRate,
        bit_count: bitCount,
      }
      // 只送親手改過的參數；沒改的由 .ami 預設接手（後端會記錄略過的）。
      const pick = (params: Record<string, string>) =>
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== ''))
      const txOverrides = pick(txParams)
      const rxOverrides = pick(rxParams)
      if (Object.keys(txOverrides).length) body.tx_parameters = txOverrides
      if (Object.keys(rxOverrides).length) body.rx_parameters = rxOverrides
      if (topology === 'dual_single') {
        body.lanes = suggestion.dual_single_lanes
      } else {
        body.input_p = ports.input_p
        body.output_p = ports.output_p
        if (topology === 'differential') {
          body.input_n = ports.input_n
          body.output_n = ports.output_n
        }
      }
      const response = await fetch('/api/ami-channel/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.detail || 'AMI 分析啟動失敗')
      setQuickCheck(null)
      setStarted(`已排入背景（job ${data.job_id ?? '—'}）。進度顯示在下方。`)
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
  }

  const jobElapsed = job?.started_at
    ? Math.max(0, Math.round(((job.finished_at || Date.now() / 1000) - job.started_at)))
    : 0
  const jobResult = job?.status === 'done' ? job?.result : null
  const isQuickCheck = Boolean(quickCheck && job?.job_id === quickCheck.jobId)
  /** 眼圖卡片：單端／差動的圖在 results[i].image_paths；雙單端逐 Lane。 */
  const eyeCards = useMemo(() => {
    if (!jobResult) return []
    const cards: { key: string; title: string; sub: string; imageUrl: string }[] = []
    ;(jobResult.results || []).forEach((res: any, analysisIndex: number) => {
      const analysisName = String(res?.analysis || '')
      if ((res?.lanes || []).length > 0) {
        res.lanes.forEach((lane: any, laneIndex: number) => {
          (lane.image_paths || []).forEach((_p: string, imageIndex: number) => {
            cards.push({
              key: `${analysisIndex}-${laneIndex}-${imageIndex}`,
              title: lane.label || `Lane ${laneIndex + 1}`,
              sub: analysisName,
              imageUrl: `/api/ami-channel/image?analysis_index=${analysisIndex}`
                + `&lane_index=${laneIndex}&image_index=${imageIndex}`,
            })
          })
        })
        return
      }
      ;(res?.image_paths || []).forEach((_p: string, imageIndex: number) => {
        cards.push({
          key: `${analysisIndex}-${imageIndex}`,
          title: isQuickCheck ? '基準眼圖（無損直連）' : analysisName || 'AMI',
          sub: isQuickCheck && quickCheck
            ? `${quickCheck.txModel} → ${quickCheck.rxModel}` : analysisName,
          imageUrl: `/api/ami-channel/image?analysis_index=${analysisIndex}`
            + `&lane_index=-1&image_index=${imageIndex}`,
        })
      })
    })
    return cards
  }, [jobResult, isQuickCheck, quickCheck])

  const measurementBlocks = useMemo(() => {
    if (!jobResult) return []
    return (jobResult.results || [])
      .map((res: any, index: number) => ({
        index, analysis: String(res?.analysis || ''),
        measurements: res?.measurements,
        notes: res?.notes || [],
      }))
      .filter((item: any) => item.measurements)
  }, [jobResult])

  return (
    <div className="ibis-wizard multi-lane-wizard">
      <section>
        <h3>選擇 AMI 模型與通道</h3>
        <p className="hint">兩側都要是 IBIS-AMI 套件；DLL 要先在模型庫掃描並信任（安全機制）。</p>
        <label>IBIS-AMI 套件（驅動側）
          <select className="input" value={txPackageId}
            onChange={event => { setTxPackageId(event.target.value); setSuggestion(null) }}>
            <option value="">請選擇…</option>
            {amiPackages.map(item => (
              <option key={item.package_id} value={item.package_id}
                disabled={Boolean(sideBlocker(item, 'tx'))}>
                {packageLabel(item, 'tx')}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy} onClick={() => void importAmi('tx')}>
          瀏覽並匯入驅動側 .ibs…
        </button>
        <label>IBIS-AMI 套件（接收側）
          <select className="input" value={rxPackageId}
            onChange={event => { setRxPackageId(event.target.value); setSuggestion(null) }}>
            <option value="">同上（兩側同一料號）</option>
            {amiPackages.map(item => (
              <option key={item.package_id} value={item.package_id}
                disabled={Boolean(sideBlocker(item, 'rx'))}>
                {packageLabel(item, 'rx')}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy} onClick={() => void importAmi('rx')}>
          瀏覽並匯入接收側 .ibs…
        </button>
        {amiPackages.length === 0 && <p className="hint">
          模型庫沒有 AMI 套件；用上面的按鈕匯入 .ibs（會連 .ami 與 DLL 一起收）。
        </p>}
        <label>資料率（Gbps）
          <input className="input" type="number" step="0.1" value={dataRate}
            onChange={event => setDataRate(Number(event.target.value))} />
        </label>
        <label>位元數（GetWave 逐位元用）
          <input className="input" type="number" value={bitCount}
            onChange={event => setBitCount(Number(event.target.value))} />
        </label>
        {error && <p className="error">{error}</p>}
      </section>

      <section>
        <h3>快速檢驗：參考通道基準眼圖</h3>
        <p className="hint">不接使用者通道，先知道這對 AMI 模型本來給多大的眼。</p>
        <p className="hint">基準眼好、接上通道才壞＝通道的問題；歸因從這裡開始。</p>
        <label style={{ display: 'flex', flexDirection: 'row', gap: 6,
          alignItems: 'center' }}>
          <input type="checkbox" checked={lossyReference}
            style={{ width: 'auto' }}
            onChange={event => setLossyReference(event.target.checked)} />
          用有損參考通道（Nyquist −10 dB 趨膚模型；預設是無損直連）
        </label>
        <button className="btn" disabled={!txPackageId || busy || Boolean(job?.running)}
          onClick={() => void runQuickCheck()}>
          {busy ? '處理中…' : '快速檢驗（不需 Touchstone）'}
        </button>
        {quickCheck && <p className="hint">
          已排入背景：{quickCheck.txModel} → {quickCheck.rxModel}，結果顯示在下方。
        </p>}
      </section>

      <section>
        <h3>接上真實通道</h3>
        <label>Touchstone 路徑（2-Port 或 4-Port）
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input is-wide" value={touchstone}
              placeholder="path\to\channel.s4p"
              onChange={event => { setTouchstone(event.target.value); setSuggestion(null) }} />
            <button className="btn" disabled={busy}
              onClick={() => void browseTouchstone()}>瀏覽…</button>
          </div>
        </label>
        {cascaded && <div className="ibis-wizard__from-cascade">
          <button className="btn"
            onClick={() => { setTouchstone(cascaded.path); setSuggestion(null) }}>帶入串接結果</button>
          <code title={cascaded.path}>
            {cascaded.path.split(/[\\/]/).pop()}（{cascaded.n_ports} Port）
          </code>
        </div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" disabled={!touchstone || !txPackageId || busy}
            onClick={() => void runSuggest()}>{busy ? '處理中…' : '執行預檢'}</button>
          {/* 秒級預覽（2026-08-29）：SPISim 引擎把「Tx 等化打在這條通道上」
              一秒畫出來，不開 AEDT。只吃 2 埠穿透，正式眼圖仍走下面流程。 */}
          <button className="btn"
            disabled={!touchstone || !txPackageId || previewBusy}
            title="用 SPISimAMI 引擎驅動 Tx→Rx 模型＋通道脈衝響應；2 埠取 S21、4 埠取差模 Sdd21"
            onClick={() => void runPreview()}>
            {previewBusy ? '預覽中…' : '秒級預覽（不開 AEDT）'}
          </button>
        </div>
        <details>
          <summary>進階：DDR4 Rx 遮罩統計簽核（BER 1e-16）</summary>
          <p className="hint">遮罩尺寸依速度等級查 JESD79-4（例：0.2 UI／136 mV）。</p>
          <p className="hint">填了寬與高，下一次秒級預覽就會附上遮罩簽核。</p>
          <div className="field-row">
            <label>遮罩寬（UI）
              <input className="input" value={ddrMaskWidth} placeholder="0.2"
                onChange={event => setDdrMaskWidth(event.target.value)} />
            </label>
            <label>遮罩高（mV）
              <input className="input" value={ddrMaskHeight} placeholder="136"
                onChange={event => setDdrMaskHeight(event.target.value)} />
            </label>
            <label>RJ σ（ps）
              <input className="input" value={ddrRjSigma}
                onChange={event => setDdrRjSigma(event.target.value)} />
            </label>
          </div>
        </details>
        {previewError && <p className="error">{previewError}</p>}
        {preview && <QuickProbeView result={preview} />}
      </section>

      {suggestion && <>
        {suggestion.blockers.length > 0 && <section className="blockers">
          <h3>必須先解決</h3>
          <ul>{suggestion.blockers.map(text => <li key={text}>{text}</li>)}</ul>
        </section>}
        {suggestion.warnings.length > 0 && <section>
          <h3>提醒</h3>
          <ul>{suggestion.warnings.map(text => <li key={text}>{text}</li>)}</ul>
        </section>}

        <section>
          <h3>綁定與執行模式</h3>
          <div className="field-row">
            <label>Tx AMI 模型
              <select className="input" value={txModel}
                onChange={event => setTxModel(event.target.value)}>
                {suggestion.tx.candidates.map(item => (
                  <option key={item.name} value={item.name}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>Rx AMI 模型
              <select className="input" value={rxModel}
                onChange={event => setRxModel(event.target.value)}>
                {suggestion.rx.candidates.map(item => (
                  <option key={item.name} value={item.name}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label>拓撲
              <select className="input" value={topology}
                onChange={event => setTopology(event.target.value)}>
                {suggestion.supported_topologies.map(name => (
                  <option key={name} value={name}>
                    {name === 'single' ? '2-Port 單端'
                      : name === 'differential' ? '4-Port 差動' : '4-Port 雙單端'}
                  </option>
                ))}
              </select>
            </label>
            <label>分析路由
              <select className="input" value={route}
                onChange={event => setRoute(event.target.value)}>
                {suggestion.routes.map(name => (
                  <option key={name} value={name}>{ROUTE_LABEL[name] || name}</option>
                ))}
              </select>
            </label>
            <label>調變
              <select className="input" value={modulation}
                onChange={event => setModulation(event.target.value)}>
                <option value="NRZ">NRZ</option>
                <option value="PAM4">PAM4（模型要明確宣告）</option>
              </select>
            </label>
          </div>
          {topology !== 'dual_single' ? (
            <div className="field-row">
              {(['input_p', 'output_p'] as const).map(key => (
                <label key={key}>{key === 'input_p' ? '驅動端 Port' : '接收端 Port'}
                  <select className="input" value={ports[key]}
                    onChange={event => setPorts(prev => ({ ...prev, [key]: event.target.value }))}>
                    <option value="">請選擇…</option>
                    {suggestion.touchstone.port_names.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
              ))}
              {topology === 'differential' && (['input_n', 'output_n'] as const).map(key => (
                <label key={key}>{key === 'input_n' ? '驅動端 N' : '接收端 N'}
                  <select className="input" value={ports[key]}
                    onChange={event => setPorts(prev => ({ ...prev, [key]: event.target.value }))}>
                    <option value="">請選擇…</option>
                    {suggestion.touchstone.port_names.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : (
            <table className="model-library__table">
              <thead><tr><th>道</th><th>驅動端 Port</th><th>接收端 Port</th></tr></thead>
              <tbody>{suggestion.dual_single_lanes.map((lane, index) => (
                <tr key={index}>
                  <td>{lane.label || lane.lane_id || `Lane ${index + 1}`}</td>
                  <td>{lane.input_port || '—'}</td>
                  <td>{lane.output_port || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="hint">AMI 參數採 .ami 內建預設；AEDT 未公開的預設會略過並記錄。</p>
          {/* 進階：親手改 AMI 參數（丙類第 2 項，2026-08-29）。摺疊起來，
              不動就是零設定；只列 .ami 宣告 Usage In/InOut 的 Model_Specific
              參數（保留參數是 EDA 工具在填的，列了只會教人填壞）。 */}
          {([
            ['Tx', txModel, suggestion.tx.candidates, txParams, setTxParams],
            ['Rx', rxModel, suggestion.rx.candidates, rxParams, setRxParams],
          ] as const).map(([side, model, candidates, params, setParams]) => {
            const editable = candidates.find(c => c.name === model)?.editable_parameters || []
            if (!editable.length) return null
            const touched = Object.values(params).filter(v => v !== '').length
            return (
              <details key={side}>
                <summary>進階：{side} AMI 參數（{editable.length} 個可編輯
                  {touched ? `，已改 ${touched} 個` : '，預設不必動'}）</summary>
                <table className="model-library__table">
                  <thead><tr><th>參數</th><th>值（留空＝用預設）</th><th>預設</th></tr></thead>
                  <tbody>{editable.map(item => (
                    <tr key={item.name} title={item.description || ''}>
                      <td>{item.name}</td>
                      <td>
                        {item.choices && item.choices.length > 0 ? (
                          <select className="input" value={params[item.name] ?? ''}
                            onChange={e => setParams(prev => ({ ...prev, [item.name]: e.target.value }))}>
                            <option value="">（預設）</option>
                            {item.choices.map(choice => (
                              <option key={choice} value={choice}>{choice}</option>
                            ))}
                          </select>
                        ) : (
                          <input className="input" value={params[item.name] ?? ''}
                            placeholder={item.minimum !== '' && item.maximum !== ''
                              ? `${item.minimum} ~ ${item.maximum}` : ''}
                            onChange={e => setParams(prev => ({ ...prev, [item.name]: e.target.value }))} />
                        )}
                      </td>
                      <td>{item.default || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <p className="hint">親手設的值寫不進 AEDT 時會被擋下，不會默默略過。</p>
              </details>
            )
          })}
          <button className="btn" disabled={busy || suggestion.blockers.length > 0
            || !txModel || !rxModel || Boolean(job?.running)}
            onClick={() => void start()}>
            {busy ? '處理中…' : '開始 AMI 分析'}
          </button>
          {started && <p>{started}</p>}
        </section>
      </>}

      {(job && job.status !== 'idle') && <section>
        <h3>分析狀態與結果</h3>
        <div className={`ibis-wizard__job is-${job?.status || 'idle'}`}>
          <div><strong>{job?.phase || '尚未執行'}</strong><span>{job?.message}</span></div>
          <div>狀態：{job?.status || 'idle'}　·　耗時 {jobElapsed} 秒
            　·　Job {job?.job_id || '—'}</div>
        </div>
        {job?.error && <div className="model-library__issue is-error">
          失敗：{job.error}</div>}

        {(jobResult?.warnings?.length ?? 0) > 0 && (
          <details open={jobResult.warnings.some((w: string) => w.includes('放行'))}>
            <summary>執行警告（{jobResult.warnings.length} 則）</summary>
            <ul>{jobResult.warnings.map((w: string) => (
              <li key={w} className="hint">{w}</li>
            ))}</ul>
          </details>
        )}

        {measurementBlocks.map((block: any) => (
          <div key={block.index}>
            <h4>眼圖量測{block.analysis ? `（${block.analysis}）` : ''}
              {isQuickCheck ? '　—　無損直連基準' : ''}</h4>
            {block.measurements.available === false && (
              <p className="hint">取不到眼圖量測：{block.measurements.unavailable_reason}</p>
            )}
            {Object.keys(block.measurements.metrics || {}).length > 0 && (
              <table className="model-library__table">
                <thead><tr><th>量測</th><th>數值</th></tr></thead>
                <tbody>{Object.entries(block.measurements.metrics)
                  .map(([key, item]: [string, any]) => (
                    <tr key={key}>
                      <td>{item.label || key}</td>
                      <td>{item.value !== undefined
                        ? `${Number(item.value).toPrecision(4)} ${item.unit || ''}`
                        : item.text}</td>
                    </tr>
                  ))}</tbody>
              </table>
            )}
            {block.notes.length > 0 && block.notes.map((note: string) => (
              <p className="hint" key={note}>{note}</p>
            ))}
          </div>
        ))}

        {eyeCards.length > 0 && <>
          <h4>眼圖（{eyeCards.length} 張）</h4>
          <div className="ibis-eye-gallery">
            {eyeCards.map(card => (
              <article key={card.key}
                data-report-separate-snapshot="true"
                data-report-kind={`ami-${card.key}`}
                data-report-title={`AMI 眼圖：${card.title}`}>
                <header><div><strong>{card.title}</strong>
                  <span>{card.sub}</span></div></header>
                <img src={card.imageUrl} alt={`${card.title} 眼圖`} />
              </article>
            ))}
          </div>
        </>}
      </section>}
    </div>
  )
}
