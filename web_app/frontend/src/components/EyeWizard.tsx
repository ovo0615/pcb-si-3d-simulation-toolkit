// 眼圖精靈（#0088 方案 A）：一條通道的標準 IBIS／IBIS-AMI 眼圖，五步做完。
//
//   1 通道 → 2 速率與題型 → 3 兩端晶片與變體 → 4 接線確認 → 5 執行與結果
//
// 規則（ADR-0006、ADR-0046）：速率與有無 ODT 由工具決定；ODT 阻值與驅動強度
// 由使用者回答，不給預設值；模型、Corner、Port 與 P／N 要使用者明確確認。
// 判斷邏輯在 ../eyeWizard.ts（有 Node 測試），這裡只負責畫與呼叫後端。
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelPackage } from './ModelLibrary'
import MultiPortEyeWizard from './MultiPortEyeWizard'
import EyeImageGallery from './EyeImageGallery'
import OpenFolderButton from './OpenFolderButton'
import ResultDetailsDrawer, { useResultDrawer } from './ResultDetailsDrawer'
import ModelOriginNotice from './ModelOriginNotice'
import EyeWizardAmiAdvanced from './EyeWizardAmiAdvanced'
import type { AmiCandidate } from './EyeWizardAmiAdvanced'
import { useCascadedChannel } from './useCascadedChannel'
import { useEyePresets } from './useEyePresets'
import { LicenseTag, useLicenseBlock } from './LicenseTag'
import {
  applyPreset, findPreset, groupPresets, presetBasis, presetEngineWarning, presetOverrides,
} from '../eyePresets'
import type { PresetOverride } from '../eyePresets'
import { errorText, pickList, pickText, releasedWithErrors } from '../backendFields'
import {
  analysisExtras, analysisRoutes, bitAdjustment, cleanPath, confirmationState, currentFunnel,
  eyeImages, funnelRows, impulseImages, missingItems, nativeTrustState, portsValid,
  resultBlocks, routeFor, selectorsFor, startRequest, untrustedCount,
  belowMinBits, ddrMaskApplies, mergeWarnings, parseQuickCheck, routeHint, statusLabel, symbolRateGbd, uiPs,
  wizardEngine,
} from '../eyeWizard'
import type { Funnel, PortMap, QuickCheckMark, WizardLane } from '../eyeWizard'
import { useT } from '../i18n'

type Side = 'tx' | 'rx'

interface SideState {
  packageId: string
  /** '' ＝ 不用 Selector，直接選模型。 */
  selector: string
  odt: number | null
  drive: number | null
  /** 漏斗剩多個時使用者點選的那一個。 */
  pick: string
  /** 不用 Selector 時直接選的模型。 */
  model: string
  override: boolean
  overrideModel: string
  overrideReason: string
}

const EMPTY_SIDE: SideState = {
  packageId: '', selector: '', odt: null, drive: null, pick: '', model: '',
  override: false, overrideModel: '', overrideReason: '',
}

interface Inspect { n_ports: number; port_names: string[]; has_port_names: boolean; sha256?: string }

interface Suggestion {
  touchstone: { n_ports: number; port_names: string[]; has_port_names: boolean }
  supported_topologies: string[]
  recommended_topology: string
  dual_single_lanes: WizardLane[]
  ports: PortMap
  port_confidence?: string
  tx: { candidates: AmiCandidate[] }
  rx: { candidates: AmiCandidate[] }
  blockers: string[]
  warnings: string[]
}

interface Job {
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

const EMPTY_PORTS: PortMap = { input_p: '', input_n: '', output_p: '', output_n: '' }

/** 自己送出的工作；重新整理頁面後仍認得（交叉審查）。 */
const JOB_KEY = 'pcbsi.eyeWizard.job.v1'
function loadJobId(): string {
  try { return window.sessionStorage.getItem(JOB_KEY) || '' } catch { return '' }
}
/** 那個工作走哪個引擎（#0104：快速檢驗由套件決定引擎，不一定和第 3 步相同）。 */
const JOB_ENGINE_KEY = 'pcbsi.eyeWizard.jobEngine.v1'
/** 快速檢驗的標記也要跟著 job 存，否則重新整理後第 5 步看不出那是基準眼圖（審稿 L7）。 */
const QUICK_KEY = 'pcbsi.eyeWizard.quickCheck.v1'
function loadQuickCheck(): QuickCheckMark | null {
  try { return parseQuickCheck(window.sessionStorage.getItem(QUICK_KEY)) } catch { return null }
}
function loadJobEngine(): 'ami' | 'ibis' | null {
  try {
    const value = window.sessionStorage.getItem(JOB_ENGINE_KEY)
    return value === 'ami' || value === 'ibis' ? value : null
  } catch { return null }
}

function failure(data: any, fallback: string): Error {
  return Object.assign(new Error(data?.detail || fallback), { detail_en: data?.detail_en })
}

async function postJson(url: string, body: unknown, fallback: string): Promise<any> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw failure(data, fallback)
  return data
}

export default function EyeWizard(
  { packages, onLibraryChanged }:
  { packages: ModelPackage[]; onLibraryChanged?: () => void | Promise<void> },
) {
  const { t: all, lang } = useT()
  const t = all.eyeWizard
  const cascaded = useCascadedChannel()
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // ① 通道
  const [touchstone, setTouchstone] = useState('')
  const [inspect, setInspect] = useState<Inspect | null>(null)
  // ② 速率與題型
  const [dataRate, setDataRate] = useState('')
  const [modulation, setModulation] = useState('NRZ')
  const [bitCount, setBitCount] = useState(2000)
  // #0104 常見規範預設：只帶資料率、調變、bit 數下限（ADR-0046）。
  const presets = useEyePresets()
  const [presetId, setPresetId] = useState('')
  const preset = findPreset(presets.data, presetId)
  const presetFields = { dataRate, modulation, bitCount }
  const overrides = presetOverrides(preset, presetFields)
  function choosePreset(id: string) {
    setPresetId(id)
    const next = applyPreset(findPreset(presets.data, id), presetFields)
    setDataRate(next.dataRate); setModulation(next.modulation); setBitCount(next.bitCount)
  }
  function restorePreset(field: PresetOverride['field']) {
    if (!preset) return
    if (field === 'data_rate_gbps') setDataRate(String(preset.rate_gbps))
    if (field === 'modulation' && preset.modulation) setModulation(preset.modulation)
    if (field === 'bit_count' && preset.min_bits) setBitCount(preset.min_bits)
  }
  // ③ 兩端晶片
  const [sides, setSides] = useState<Record<Side, SideState>>({ tx: EMPTY_SIDE, rx: EMPTY_SIDE })
  const [funnelChecks, setFunnelChecks] = useState<Record<Side,
    { signature: string; data: Funnel } | null>>({ tx: null, rx: null })
  const [corner, setCorner] = useState('typ')
  // ④ 接線
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [topology, setTopology] = useState('')
  const [ports, setPorts] = useState<PortMap>(EMPTY_PORTS)
  const [lanes, setLanes] = useState<WizardLane[]>([])
  const [confirmedSig, setConfirmedSig] = useState<string | null>(null)
  // ⑤ 執行
  const [job, setJob] = useState<Job | null>(null)
  const [myJobId, setMyJobIdState] = useState(loadJobId)
  const setMyJobId = (id: string) => {
    setMyJobIdState(id)
    try { window.sessionStorage.setItem(JOB_KEY, id) } catch { /* 存不了就只在這次有效 */ }
  }
  /** 送出當下的設定簽章：之後改了設定，重用／重跑按鈕就不能拿舊確認直接送。 */
  const [startedSig, setStartedSig] = useState('')
  const [started, setStarted] = useState('')
  /** 預檢的請求序號：晚到的舊回應不得蓋掉新的（交叉審查）。 */
  const suggestSeq = useRef(0)
  /** AMI 設定預檢的結果，綁著當時的設定簽章。 */
  const [amiCheck, setAmiCheck] = useState<{ sig: string; data: any | null; error: string } | null>(null)
  // #0104 搬自舊 AMI 面板：分析方式、親手改的 AMI 參數、快速檢驗
  const [analysisRoute, setAnalysisRoute] = useState('auto')
  const [txParams, setTxParams] = useState<Record<string, string>>({})
  const [rxParams, setRxParams] = useState<Record<string, string>>({})
  const [lossyReference, setLossyReference] = useState(false)
  const [quickCheck, setQuickCheckState] = useState(loadQuickCheck)
  const setQuickCheck = (value: QuickCheckMark | null) => {
    setQuickCheckState(value)
    try {
      if (value) window.sessionStorage.setItem(QUICK_KEY, JSON.stringify(value))
      else window.sessionStorage.removeItem(QUICK_KEY)
    } catch { /* 只在這次有效 */ }
  }
  const [jobEngine, setJobEngineState] = useState(loadJobEngine)
  const setJobEngine = (value: 'ami' | 'ibis') => {
    setJobEngineState(value)
    try { window.sessionStorage.setItem(JOB_ENGINE_KEY, value) } catch { /* 只在這次有效 */ }
  }

  const rate = Number(dataRate) > 0 ? Number(dataRate) : null
  const pkg = (side: Side) => packages.find(item => item.package_id === sides[side].packageId)
  const txPkg = pkg('tx')
  const rxPkg = pkg('rx')
  // 超過 4 埠走多埠分支，只有標準 IBIS；不沿用單通道選過的 AMI 判定（畫面驗收 B4）。
  const engine = wizardEngine(txPkg?.kind, rxPkg?.kind, inspect?.n_ports ?? null)
  const runEngine: 'ami' | 'ibis' = engine === 'ami' ? 'ami' : 'ibis'
  /** 輪詢與取圖跟著「最後送出的那個工作」的引擎走。 */
  const pollEngine: 'ami' | 'ibis' = jobEngine ?? runEngine
  const route = routeFor(runEngine, analysisRoute)
  const ibisBlock = useLicenseBlock(['ibis_channel'])
  const amiBlock = useLicenseBlock(['ami_channel'])
  const quickCheckBlock = useLicenseBlock(['model_check'])
  const licenseBlock = runEngine === 'ami' ? amiBlock : ibisBlock

  const updateSide = (side: Side, patch: Partial<SideState>) =>
    setSides(prev => ({ ...prev, [side]: { ...prev[side], ...patch } }))

  // ── ① 通道：讀埠數與 Port 名稱 ──
  useEffect(() => {
    setInspect(null)
    const path = cleanPath(touchstone)
    if (!path) return
    let alive = true
    postJson('/api/cascade/inspect_files', { paths: [path] }, t.inspectFailed)
      .then(data => { if (alive) setInspect(data?.files?.[0] || null) })
      .catch(exc => { if (alive) setError(errorText(exc, lang)) })
    return () => { alive = false }
  }, [touchstone])

  async function browseTouchstone() {
    setError('')
    try {
      const picked = await fetch('/api/browse_touchstone').then(r => r.json())
      const first: string = picked?.paths?.[0] || ''
      if (first) setTouchstone(first)
    } catch (exc) { setError(errorText(exc, lang)) }
  }

  async function importIbs(side: Side) {
    setBusy(true); setError('')
    try {
      const picked = await fetch('/api/models/browse').then(r => r.json())
      const paths: string[] = picked?.paths?.length ? picked.paths : (picked?.path ? [picked.path] : [])
      let lastId = ''
      for (const path of paths) {
        const data = await postJson('/api/models/import', { path }, t.importFailed(path))
        lastId = data?.model?.package_id || lastId
      }
      await onLibraryChanged?.()
      if (lastId) updateSide(side, { ...EMPTY_SIDE, packageId: lastId })
    } catch (exc) { setError(errorText(exc, lang)) } finally { setBusy(false) }
  }

  // ── 預檢（兩種引擎同形狀：拓撲、Port 建議、兩端候選）──
  async function runSuggest() {
    if (!engine || engine === 'mixed' || !touchstone || !txPkg || !rxPkg) return
    const seq = ++suggestSeq.current
    setBusy(true); setError('')
    try {
      const body: Record<string, unknown> = {
        touchstone_path: cleanPath(touchstone), tx_package_id: txPkg.package_id,
        rx_package_id: rxPkg.package_id,
      }
      if (engine === 'ibis' && rate) body.data_rate_gbps = rate
      const data = await postJson(
        engine === 'ami' ? '/api/ami-channel/suggest' : '/api/ibis-channel/suggest',
        body, t.suggestFailed) as Suggestion
      if (seq !== suggestSeq.current) return
      setSuggestion(data)
      setTopology(data.recommended_topology || data.supported_topologies[0] || '')
      setPorts({ ...EMPTY_PORTS, ...data.ports })
      setLanes((data.dual_single_lanes || []).map((lane, index) => ({
        lane_id: lane.lane_id || `lane_${index + 1}`, label: lane.label || t.laneN(index + 1),
        input_port: lane.input_port || '', output_port: lane.output_port || '' })))
    } catch (exc) {
      if (seq === suggestSeq.current) { setError(errorText(exc, lang)); setSuggestion(null) }
    } finally { setBusy(false) }
  }

  // 換通道、換套件或換引擎，舊的預檢就不算數。
  // 標準 IBIS 的通道品質預檢看速率，所以速率改了也要重做。請求序號一起往前，
  // 還在路上的舊預檢回來時就會被丟掉。
  useEffect(() => { suggestSeq.current += 1; setSuggestion(null) },
    [touchstone, sides.tx.packageId, sides.rx.packageId, engine === 'ibis' ? rate : null])
  // 進到第 3 步以後，條件齊了就自動預檢一次（候選模型清單要靠它）。
  useEffect(() => {
    if (step >= 3 && !suggestion && !busy && engine && engine !== 'mixed'
      && touchstone && txPkg && rxPkg) void runSuggest()
  }, [step, suggestion, engine, touchstone, txPkg?.package_id, rxPkg?.package_id])

  const candidates = (side: Side) => (suggestion?.[side].candidates || []).map(item => item.name)

  // 候選只有一個就直接帶入（Ansys AMI 範例兩端各只有一個）；第 4 步仍要人確認。
  useEffect(() => {
    if (!suggestion) return
    ;(['tx', 'rx'] as Side[]).forEach(side => {
      const names = candidates(side)
      if (names.length === 1 && !sides[side].model && !sides[side].selector) {
        updateSide(side, { model: names[0] })
      }
    })
  }, [suggestion])

  // ── ③ 變體漏斗 ──
  const funnelSignature = (side: Side) => {
    const state = sides[side]
    return JSON.stringify([state.packageId, state.selector, rate, state.odt, state.drive])
  }
  const funnels = {
    tx: currentFunnel(funnelChecks.tx, funnelSignature('tx')),
    rx: currentFunnel(funnelChecks.rx, funnelSignature('rx')),
  }
  useEffect(() => {
    let alive = true
    ;(['tx', 'rx'] as Side[]).forEach(side => {
      const state = sides[side]
      if (!state.packageId || !state.selector || !rate) {
        setFunnelChecks(prev => ({ ...prev, [side]: null }))
        return
      }
      const signature = funnelSignature(side)
      setFunnelChecks(prev => ({ ...prev, [side]: null }))
      postJson(`/api/models/${encodeURIComponent(state.packageId)}/selector-funnel`, {
        selector: state.selector, data_rate_gbps: rate, driving: side === 'tx',
        odt_ohm: state.odt, drive_ohm: state.drive,
      }, t.funnelFailed)
        .then(data => { if (alive) setFunnelChecks(prev => ({ ...prev,
          [side]: { signature, data: data as Funnel } })) })
        .catch(exc => { if (alive) setError(errorText(exc, lang)) })
    })
    // 換了答案或 Selector，上一輪還沒回來的漏斗作廢（交叉審查：晚到的舊回應會蓋掉新的）。
    return () => { alive = false }
  }, [rate, sides.tx.packageId, sides.tx.selector, sides.tx.odt, sides.tx.drive,
    sides.rx.packageId, sides.rx.selector, sides.rx.odt, sides.rx.drive])

  /** 這一側最後送出的模型與理由。 */
  const resolved = (side: Side): { model: string; reason: 'funnel' | 'plain' | 'override' } => {
    const state = sides[side]
    if (state.override) return { model: state.overrideModel, reason: 'override' }
    if (state.selector) {
      const funnel = funnels[side]
      const remaining = (funnel?.remaining || []).map(item => item.name)
      const model = funnel?.selected || (remaining.includes(state.pick) ? state.pick : '')
      return { model, reason: 'funnel' }
    }
    return { model: state.model, reason: 'plain' }
  }
  const txModel = resolved('tx').model
  const rxModel = resolved('rx').model
  /** 選型依據（ADR-0047）：寫進執行紀錄，也進確認簽章。 */
  const basisOf = (side: Side) => {
    const state = sides[side]
    const r = resolved(side)
    return {
      basis: r.reason, model: r.model,
      ...(state.selector ? { selector: state.selector, odt_ohm: state.odt, drive_ohm: state.drive } : {}),
      ...(r.reason === 'override' ? { override_reason: state.overrideReason.trim() } : {}),
    }
  }
  const selectionBasis = { tx: basisOf('tx'), rx: basisOf('rx'),
    ...(preset ? { preset: presetBasis(preset, presetFields) } : {}) }

  // ── ④ 確認：設定一變就是「需重新確認」，不悄悄清掉 ──
  const signature = JSON.stringify([cleanPath(touchstone), engine, sides.tx.packageId,
    sides.rx.packageId, txModel, rxModel, corner, topology, ports, lanes, rate,
    modulation, bitCount, selectionBasis, inspect?.sha256,
    route, engine === 'ami' ? txParams : {}, engine === 'ami' ? rxParams : {}])
  const confirmation = confirmationState(confirmedSig, signature)

  // AMI 設定預檢（Ignore_Bits、路由）在第 4 步起自動跑，設定一變就作廢重跑；
  // 原本要手動按、第一次按還可能拿到空的模型（交叉審查）。
  useEffect(() => {
    if (engine !== 'ami' || step < 4 || !suggestion || !rate || !txModel || !rxModel) return
    let alive = true
    const sig = signature
    const { body } = startRequest('ami', requestState(false))
    postJson('/api/ami-channel/preflight', body, t.suggestFailed)
      .then(data => { if (alive) setAmiCheck({ sig, data, error: '' }) })
      .catch(exc => { if (alive) setAmiCheck({ sig, data: null, error: errorText(exc, lang) }) })
    return () => { alive = false }
  }, [engine, step, suggestion, signature])
  const amiCurrent = engine === 'ami' && amiCheck?.sig === signature ? amiCheck : null
  const preflight = amiCurrent?.data ?? null

  function requestState(confirmed: boolean) {
    return {
      touchstone: cleanPath(touchstone), txPackageId: sides.tx.packageId,
      rxPackageId: sides.rx.packageId, txModel, rxModel, topology, ports, lanes,
      dataRateGbps: rate || 0, corner, modulation, bitCount, confirmed, selectionBasis,
      analysisRoute: route, txParameters: txParams, rxParameters: rxParams,
    }
  }

  // 換成另一個模型，親手改的 AMI 參數就不屬於它了（舊面板換預檢時也清掉）。
  // 漏斗重查時模型會短暫變空，那不算換，不清。
  const paramModels = useRef({ tx: '', rx: '' })
  useEffect(() => {
    const last = paramModels.current
    if (txModel && txModel !== last.tx) { if (last.tx) setTxParams({}); last.tx = txModel }
    if (rxModel && rxModel !== last.rx) { if (last.rx) setRxParams({}); last.rx = rxModel }
  }, [txModel, rxModel])

  // ── ③ 快速檢驗：兩端模型背對背接參考通道，不接使用者的 Touchstone ──
  async function runQuickCheck() {
    if (!txPkg || !rate) return
    setBusy(true); setError(''); setStarted('')
    try {
      const data = await postJson('/api/ibis-channel/quick-check', {
        tx_package_id: txPkg.package_id,
        rx_package_id: rxPkg?.package_id || txPkg.package_id,
        data_rate_gbps: rate,
        reference: lossyReference ? 'lossy' : 'lossless',
      }, t.quickCheckStartFailed)
      setJobEngine(data.engine === 'ami' ? 'ami' : 'ibis')
      setMyJobId(data.job_id || '')
      setStartedSig('')
      setQuickCheck({ jobId: data.job_id || '', txModel: data.quick_check?.tx_model || '',
        rxModel: data.quick_check?.rx_model || '' })
    } catch (exc) { setError(errorText(exc, lang)) } finally { setBusy(false) }
  }

  // ── ⑤ 執行 ──
  useEffect(() => {
    let alive = true
    const url = pollEngine === 'ami' ? '/api/ami-channel/status' : '/api/ibis-channel/status'
    const tick = async () => {
      try {
        const state = await fetch(url).then(r => r.json())
        if (alive) setJob(state)
      } catch { /* 輪詢失敗不打斷畫面 */ }
    }
    void tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [pollEngine])

  const libraries = [txPkg, rxPkg].filter(Boolean)
    .filter(item => item!.kind === 'ibis_ami').map(item => item!.native_libraries || [])
  const missing = missingItems({
    touchstone: cleanPath(touchstone), nPorts: inspect?.n_ports ?? null, dataRateGbps: rate,
    txPackageId: sides.tx.packageId, rxPackageId: sides.rx.packageId, engine,
    txModel, rxModel,
    overrideReasonMissing: (['tx', 'rx'] as Side[]).some(
      side => sides[side].override && !sides[side].overrideReason.trim()),
    untrustedLibraries: untrustedCount(libraries),
    suggested: Boolean(suggestion),
    blockers: suggestion?.blockers.length ?? 0,
    portsValid: suggestion
      ? portsValid(topology, ports, suggestion.touchstone.port_names, lanes) : false,
    confirmation, licenseBlocked: Boolean(licenseBlock), jobRunning: Boolean(job?.running),
    bitCount, preflightFailed: Boolean(amiCurrent?.error),
    preflightPending: engine === 'ami' && !amiCurrent?.data,
  })

  async function start(reuse?: 'use' | 'rerun') {
    if (busy || missing.length > 0 || (reuse && startedSig !== signature)) return
    setBusy(true); setError(''); setStarted('')
    try {
      const { url, body } = startRequest(runEngine, requestState(true))
      if (reuse === 'use') body.reuse_use_existing = true
      if (reuse === 'rerun') body.reuse_acknowledged = true
      const data = await postJson(url, body, t.startFailed)
      setJobEngine(runEngine)
      setMyJobId(data.job_id || '')
      setQuickCheck(null)
      setStartedSig(signature)
      setStarted(t.queued(data.job_id ?? '—'))
    } catch (exc) { setError(errorText(exc, lang)) } finally { setBusy(false) }
  }

  const myJob = job && myJobId && job.job_id === myJobId ? job : null
  const jobResult = myJob?.status === 'done' ? myJob.result : null
  const details = useResultDrawer(myJobId)
  const reuseOffer = jobResult?.status === 'reuse_available'
  const blocks = useMemo(() => resultBlocks(reuseOffer ? null : jobResult, lang),
    [jobResult, reuseOffer, lang])
  const images = useMemo(() => {
    const shown = reuseOffer ? null : jobResult
    // 眼圖在前、impulse 響應排在後面（#0104）。
    return [...eyeImages(pollEngine, shown, lang, myJobId),
      ...impulseImages(pollEngine, shown, lang, myJobId)]
  }, [pollEngine, jobResult, reuseOffer, lang, myJobId])
  // 張數分開算：impulse 不是眼圖（畫面驗收 T4）。
  const impulseCount = images.filter(card => card.key.startsWith('impulse-')).length
  const eyeCount = images.length - impulseCount
  const extras = useMemo(() => analysisExtras(reuseOffer ? null : jobResult, lang),
    [jobResult, reuseOffer, lang])
  const isQuickCheck = Boolean(quickCheck && myJob && quickCheck.jobId === myJob.job_id)
  const adjustment = bitAdjustment(jobResult || preflight, lang)
  const elapsed = myJob?.started_at
    ? Math.max(0, Math.round(((myJob.finished_at || Date.now() / 1000) - myJob.started_at))) : 0

  // ── DLL 就地掃描與信任（小修 3）──
  const TERMS_KEY = 'pcbsi.native-library-terms.v1'
  function acceptTerms(): boolean {
    try { if (window.localStorage.getItem(TERMS_KEY) === 'accepted') return true } catch { /* 讀不到就問 */ }
    if (!window.confirm(t.termsText)) return false
    try { window.localStorage.setItem(TERMS_KEY, 'accepted') } catch { /* 記不住就下次再問 */ }
    return true
  }
  async function scan(item: ModelPackage) {
    setBusy(true); setError('')
    try {
      await postJson(`/api/models/${encodeURIComponent(item.package_id)}/scan`, {}, t.scanFailed)
      await onLibraryChanged?.()
    } catch (exc) { setError(errorText(exc, lang)) } finally { setBusy(false) }
  }
  async function trust(item: ModelPackage, lib: { file: string; sha256: string; scan_status: string }) {
    if (!acceptTerms()) return
    const note = lib.scan_status === 'unavailable' ? t.scanUnavailableNote : ''
    if (!window.confirm(t.trustConfirm(lib.file, lib.sha256) + note)) return
    setBusy(true); setError('')
    try {
      await postJson(`/api/models/${encodeURIComponent(item.package_id)}/trust`,
        { sha256: lib.sha256, confirmed: true }, t.trustFailed)
      await onLibraryChanged?.()
      setStarted(t.trustDone(lib.file))
    } catch (exc) { setError(errorText(exc, lang)) } finally { setBusy(false) }
  }

  const stepKeys = ['channel', 'rate', 'chips', 'wiring', 'run'] as const
  const stepHasMissing = (n: number) => missing.some(item => item.step === n
    && !(n === 5 && item.key === 'running'))

  // ── 畫面 ──
  const sidePanel = (side: Side) => {
    const state = sides[side]
    const item = pkg(side)
    const choices = packages.filter(p => p.kind === 'ibis' || p.kind === 'ibis_ami')
    const names = candidates(side)
    const selectors = selectorsFor(item?.ibis?.model_selectors, names)
    const funnel = funnels[side]
    const rows = funnel ? funnelRows(funnel, t) : []
    const noRole = (p: ModelPackage) => p.capabilities
      && (side === 'tx' ? p.capabilities.tx_models === 0 : p.capabilities.rx_models === 0)
    const pick = resolved(side)
    return (
      <div className="eye-wizard__side" key={side}>
        <h4>{side === 'tx' ? t.tx : t.rx}</h4>
        <label>{t.package}
          <select className="input" value={state.packageId}
            onChange={e => updateSide(side, { ...EMPTY_SIDE, packageId: e.target.value })}>
            <option value="">{t.pleaseSelect}</option>
            {choices.map(p => (
              <option key={p.package_id} value={p.package_id} disabled={Boolean(noRole(p))}>
                {noRole(p) ? t.packageNote(p.display_name, side === 'tx' ? t.noTxModels : t.noRxModels)
                  : p.display_name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy} onClick={() => void importIbs(side)}>{t.importIbs}</button>

        {item?.kind === 'ibis_ami' && (item.native_libraries || []).length > 0 && (
          <div className="eye-wizard__trust">
            <strong>{t.trustTitle}</strong>
            {(item.native_libraries || []).map(lib => {
              const status = nativeTrustState(lib)
              return (
                <div key={lib.sha256 + lib.file} className={`is-${status}`}>
                  <code>{lib.file}</code>{all.apiError.fieldSep}{t.trustState[status]}
                  {status === 'pending' && <button className="btn" disabled={busy}
                    onClick={() => void scan(item)}>{t.scan}</button>}
                  {status === 'scanned' && <button className="btn" disabled={busy}
                    onClick={() => void trust(item, lib)}>{t.trust}</button>}
                </div>
              )
            })}
          </div>
        )}

        {item && suggestion && <>
          <label>{t.selector}
            <select className="input" value={state.selector}
              onChange={e => updateSide(side, { selector: e.target.value, odt: null, drive: null, pick: '' })}>
              <option value="">{t.noSelector}</option>
              {selectors.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          {!state.selector && (
            <label>{t.model}
              <select className="input" value={state.model}
                onChange={e => updateSide(side, { model: e.target.value })}>
                <option value="">{t.pleaseSelect}</option>
                {names.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
          {state.selector && funnel && (
            <div className="eye-wizard__funnel">
              <strong>{t.funnelTitle(funnel.total)}</strong>
              <ol>
                {rows.map(row => (
                  <li key={row.key} className={row.ask ? 'is-user' : 'is-tool'}>
                    <span className="eye-wizard__funnel-label">{row.label}</span>
                    <span className="eye-wizard__funnel-by">{row.decidedBy}</span>
                    {row.ask ? (
                      <select className="input" aria-label={row.label}
                        value={row.value ?? ''}
                        onChange={e => updateSide(side, {
                          [row.key === 'odt_ohm' ? 'odt' : 'drive']:
                            e.target.value === '' ? null : Number(e.target.value), pick: '' })}>
                        <option value="">{t.notAnswered}</option>
                        {row.options.map(ohm => <option key={ohm} value={ohm}>{t.ohmValue(ohm)}</option>)}
                      </select>
                    ) : <span>{row.valueText}</span>}
                    <span className="eye-wizard__funnel-count">{t.remaining(row.count)}</span>
                    {row.note && <em className="hint">{row.note}</em>}
                  </li>
                ))}
              </ol>
              <p className="hint">{t.answerHint}</p>
              {funnel.remaining.length === 0 && <p className="warning">{t.noneLeft}</p>}
              {!funnel.selected && funnel.remaining.length > 1 && <>
                <p>{t.pickOne(funnel.remaining.length)}</p>
                <div className="eye-wizard__chips">
                  {funnel.remaining.map(v => (
                    <button key={v.name} title={v.description}
                      className={'btn' + (state.pick === v.name ? ' is-active' : '')}
                      onClick={() => updateSide(side, { pick: v.name })}>{v.name}</button>
                  ))}
                </div>
              </>}
            </div>
          )}
          {pick.model && !state.override && <p><strong>{t.selected(pick.model)}</strong></p>}
          {!state.override ? (
            <button className="btn--mini" onClick={() => updateSide(side, { override: true })}>
              {t.override}</button>
          ) : (
            <div className="eye-wizard__override">
              <label>{t.model}
                <select className="input" value={state.overrideModel}
                  onChange={e => updateSide(side, { overrideModel: e.target.value })}>
                  <option value="">{t.pleaseSelect}</option>
                  {names.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label>{t.overrideReason}
                <input className="input" value={state.overrideReason}
                  onChange={e => updateSide(side, { overrideReason: e.target.value })} />
              </label>
              <button className="btn" onClick={() => updateSide(side,
                { override: false, overrideModel: '', overrideReason: '' })}>{t.overrideCancel}</button>
            </div>
          )}
        </>}
      </div>
    )
  }

  const portSelect = (key: keyof PortMap, label: string) => (
    <label key={key}>{label}
      <select className="input" value={ports[key]}
        onChange={e => setPorts(prev => ({ ...prev, [key]: e.target.value }))}>
        <option value="">{t.pleaseSelect}</option>
        {(suggestion?.touchstone.port_names || []).map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
  )

  const reasonText = (side: Side) => {
    const r = resolved(side)
    return r.reason === 'override' ? t.diagramReason.override(sides[side].overrideReason)
      : t.diagramReason[r.reason]
  }
  const cornerText = engine === 'ami' ? t.cornerNames.typ : t.cornerNames[corner as 'typ' | 'min' | 'max']

  // ── 規範預設的欄位標示：規範值／已覆寫（規範值 X）＋還原 ──
  const p = t.preset
  const presetWarning = presetEngineWarning(preset, engine)
  const presetUi = preset ? uiPs(preset.rate_gbps, preset.modulation) : null
  const shownModulation = engine === 'ami' ? modulation : 'NRZ'
  const presetTag = (field: PresetOverride['field'], shown: string) => {
    if (!preset || !shown) return null
    const changed = overrides.some(item => item.field === field)
    return changed
      ? <span className="eye-wizard__preset-tag is-overridden">{t.preset.overridden(shown)}
          <button type="button" className="btn--mini" onClick={() => restorePreset(field)}>
            {t.preset.restore}</button></span>
      : <span className="eye-wizard__preset-tag">{p.fromPreset}</span>
  }

  return (
    <div className="ibis-wizard eye-wizard">
      <header className="eye-wizard__header">
        <h3>{t.title}</h3>
        <p className="hint">{t.intro}</p>
        <ol className="ibis-wizard__steps eye-wizard__steps">
          {stepKeys.map((key, index) => {
            const n = index + 1
            const done = !(inspect && inspect.n_ports > 4) && !stepHasMissing(n) && n < 5
            return (
              <li key={key}>
                <button className={(step === n ? 'is-active' : '') + (done ? ' is-done' : '')}
                  onClick={() => setStep(n)}>
                  <span className="eye-wizard__step-n">{done ? '✓' : t.stepNumber(n)}</span>{t.steps[key]}
                </button>
              </li>
            )
          })}
        </ol>
      </header>
      {error && <p className="error">{error}</p>}

      {step === 1 && <section>
        <h3>{t.steps.channel}</h3>
        <label>{t.touchstone}
          <div className="eye-wizard__row">
            <input className="input is-wide" value={touchstone} placeholder="channel.s4p"
              onChange={e => setTouchstone(e.target.value)} />
            <button className="btn" onClick={() => void browseTouchstone()}>{t.browse}</button>
          </div>
        </label>
        {cascaded && <div className="ibis-wizard__from-cascade">
          <button className="btn" onClick={() => setTouchstone(cascaded.path)}>{t.useCascade}</button>
          <code title={cascaded.path}>{t.cascadeFile(cascaded.path.split(/[\\/]/).pop() || cascaded.path, cascaded.n_ports)}</code>
        </div>}
        {inspect && (inspect.n_ports === 2 || inspect.n_ports === 4
          ? <p className="hint">{t.portSummary(inspect.n_ports, inspect.has_port_names)}</p>
          : <p className="warning">{t.portCountUnsupported(inspect.n_ports)}</p>)}
      </section>}

      {step === 2 && <section>
        <h3>{t.steps.rate}</h3>
        <div className="eye-wizard__preset">
          <label>{p.label}
            <select className="input" value={presetId} disabled={!presets.data}
              onChange={e => choosePreset(e.target.value)}>
              <option value="">{p.none}</option>
              {groupPresets(presets.data?.presets || []).map(group => (
                <optgroup key={group.family} label={group.family}>
                  {group.items.map(item => (
                    <option key={item.id} value={item.id} disabled={!item.supported}
                      title={item.supported ? undefined : pickText(item, 'unsupported_reason', lang)}>
                      {pickText(item, 'label', lang)}{item.supported ? '' : p.unsupportedTag}
                    </option>))}
                </optgroup>))}
            </select>
          </label>
          {!presets.data && !presets.error && <p className="hint">{p.loading}</p>}
          {presets.error && <p className="hint">{p.loadFailed}</p>}
          <p className="hint">{p.hint}</p>
          {preset && <div className="eye-wizard__preset-info">
            <span>{[preset.rate_gbps ? p.rateValue(String(preset.rate_gbps)) : '',
              preset.baud_gbd && preset.modulation === 'PAM4' ? p.baudValue(String(preset.baud_gbd)) : '',
              // 和引擎同一個換算（PAM4 用符號率），不直接印後端的 ui_ps（審稿 H2）。
              presetUi !== null ? p.uiValue(String(presetUi)) : '',
              preset.modulation || '', preset.encoding || ''].filter(Boolean).join(' · ')}</span>
            {pickText(preset, 'note', lang) && <span className="hint">{pickText(preset, 'note', lang)}</span>}
            {pickText(preset, 'analysis_note', lang) && <span className="hint">{pickText(preset, 'analysis_note', lang)}</span>}
            <span className="hint">{pickText(preset, 'compliance_note', lang) || p.noVerdict}</span>
            {preset.modulation === 'PAM4' && <span className="hint">{p.pam4Hint}</span>}
            {preset.source && <span className="hint">{p.sourceLabel}{all.apiError.fieldSep}{preset.source}</span>}
          </div>}
        </div>
        <div className="eye-wizard__row">
          <label>{t.dataRate}
            <input className="input" type="number" step="0.1" min="0" value={dataRate}
              onChange={e => setDataRate(e.target.value)} />
          </label>
          {presetTag('data_rate_gbps', preset?.rate_gbps ? p.rateValue(String(preset.rate_gbps)) : '')}
        </div>
        {/* 資料率是位元率；PAM4 時另外寫出符號率與 UI，和引擎同一個換算（ADR-0068）。 */}
        {uiPs(rate, shownModulation) !== null && <p className="hint">
          {t.uiNow(String(uiPs(rate, shownModulation)), shownModulation, String(symbolRateGbd(rate, shownModulation)))}</p>}
        <p className="hint">{t.dataRateHint}</p>
        <p><strong>{t.engine}{all.apiError.fieldSep}</strong>{t.engineNames[engine ?? 'pending']}</p>
        {presetWarning && <p className="warning">{p[presetWarning]}</p>}
        {/* 規範標籤一律放在欄位旁（和資料率同一種排法），不塞進 label 撐寬下拉（畫面驗收 V3）。 */}
        {engine === 'ami' && <>
          <div className="eye-wizard__row">
            <label>{t.modulation}
              <select className="input" value={modulation} onChange={e => setModulation(e.target.value)}>
                <option value="NRZ">NRZ</option>
                <option value="PAM4">PAM4</option>
              </select>
            </label>
            {presetTag('modulation', preset?.modulation || '')}
          </div>
          <div className="eye-wizard__row">
            <label>{t.bitCount}
              <input className="input" type="number" value={bitCount}
                onChange={e => setBitCount(Number(e.target.value))} />
            </label>
            {presetTag('bit_count', preset?.min_bits ? String(preset.min_bits) : '')}
          </div>
          {belowMinBits(preset, bitCount) !== null && <p className="warning">
            {p.belowMin(String(belowMinBits(preset, bitCount)))}</p>}
        </>}
        {engine === 'ami' && <p className="hint">{t.modulationHint}</p>}
      </section>}

      {inspect && inspect.n_ports > 4 && <div hidden={step < 3}><MultiPortEyeWizard
        packages={packages} onLibraryChanged={onLibraryChanged}
        wizardStep={step}
        presetSelectionBasis={presetBasis(preset, presetFields)}
        touchstonePath={cleanPath(touchstone)} dataRateGbps={rate}
        onTouchstoneChange={setTouchstone} onDataRateChange={value => setDataRate(value > 0 ? String(value) : '')} /></div>}

      {step === 3 && (!inspect || inspect.n_ports <= 4) && <section>
        <h3>{t.steps.chips}</h3>
        {engine === 'mixed' && <p className="warning">{t.engineNames.mixed}</p>}
        {presetWarning && <p className="warning">{p[presetWarning]}</p>}
        <div className="eye-wizard__sides">{sidePanel('tx')}{sidePanel('rx')}</div>
        {engine === 'ami'
          ? <p className="hint">{t.cornerAmi}</p>
          : <label>{t.corner}
            <select className="input" value={corner} onChange={e => setCorner(e.target.value)}>
              {(['typ', 'min', 'max'] as const).map(code => (
                <option key={code} value={code}>{t.cornerNames[code]}</option>))}
            </select>
          </label>}
        {engine !== 'ami' && <p className="hint">{t.cornerHint}</p>}

        <div className="eye-wizard__quick">
          <h4>{t.quickTitle}</h4>
          <p className="hint">{t.quickHint}</p>
          <p className="hint">{t.quickAttribution}</p>
          <label className="eye-wizard__inline">
            <input type="checkbox" checked={lossyReference}
              onChange={e => setLossyReference(e.target.checked)} />
            {t.lossyReference}
          </label>
          <div className="eye-wizard__row">
            <button className="btn" disabled={busy || !txPkg || !rate || Boolean(job?.running)
              || Boolean(quickCheckBlock)}
              title={quickCheckBlock || undefined} onClick={() => void runQuickCheck()}>
              {busy ? t.starting : t.quickRun}</button>
            <LicenseTag functions={['model_check']} />
          </div>
          {(!txPkg || !rate) && <p className="hint">{t.quickNeeds}</p>}
          {quickCheck && quickCheck.jobId === myJobId && <p className="hint">
            {t.quickQueued(quickCheck.txModel || '—', quickCheck.rxModel || '—')}
            <button className="btn--mini" onClick={() => setStep(5)}>{t.goToResults}</button></p>}
        </div>
      </section>}

      {step === 4 && (!inspect || inspect.n_ports <= 4) && <section>
        <h3>{t.steps.wiring}</h3>
        <button className="btn" disabled={busy || !engine || engine === 'mixed'}
          onClick={() => void runSuggest()}>
          {busy ? t.preflighting : suggestion ? t.preflightAgain : t.preflight}</button>
        {suggestion && <>
          {suggestion.blockers.length > 0 && <div className="blockers">
            <strong>{t.blockers}</strong>
            <ul>{pickList(suggestion, 'blockers', lang).map(text => <li key={text}>{text}</li>)}</ul>
          </div>}
          <label>{t.topology}
            <select className="input" value={topology} onChange={e => setTopology(e.target.value)}>
              {suggestion.supported_topologies.map(name => (
                <option key={name} value={name}>
                  {t.topologyNames[name as 'single' | 'differential' | 'dual_single'] || name}</option>))}
            </select>
          </label>
          {topology === 'dual_single' ? (
            <table className="model-library__table">
              <thead><tr><th>{t.laneColumn}</th><th>{t.portTx}</th><th>{t.portRx}</th></tr></thead>
              <tbody>{lanes.map((lane, index) => (
                <tr key={index}>
                  <td>{lane.label}</td>
                  {(['input_port', 'output_port'] as const).map(key => (
                    <td key={key}><select className="input" value={lane[key] || ''}
                      onChange={e => setLanes(prev => prev.map((item, i) =>
                        i === index ? { ...item, [key]: e.target.value } : item))}>
                      <option value="">{t.pleaseSelect}</option>
                      {suggestion.touchstone.port_names.map(name => <option key={name} value={name}>{name}</option>)}
                    </select></td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          ) : (
            <div className="field-row">
              {portSelect('input_p', topology === 'differential' ? t.portTxP : t.portTx)}
              {topology === 'differential' && portSelect('input_n', t.portTxN)}
              {portSelect('output_p', topology === 'differential' ? t.portRxP : t.portRx)}
              {topology === 'differential' && portSelect('output_n', t.portRxN)}
            </div>
          )}
          {suggestion.port_confidence && suggestion.port_confidence !== 'high'
            && <p className="warning">{t.lowConfidence}</p>}

          <label>{t.analysisRoute}
            <select className="input" value={route} onChange={e => setAnalysisRoute(e.target.value)}>
              {analysisRoutes(runEngine).map(code => (
                <option key={code} value={code}>
                  {t.routeLabel[code as keyof typeof t.routeLabel] || code}</option>))}
            </select>
          </label>
          <p className="hint">{routeHint(runEngine, route, lang)}</p>

          <div className="eye-wizard__diagram" data-report-separate-snapshot="true"
            data-report-kind="eye-wizard-diagram" data-report-title={t.snapshotTitle(t.steps.wiring)}>
            <div className="eye-wizard__box">
              <strong>{t.tx}</strong>
              <span>{txPkg?.display_name || '—'}</span>
              <code>{txModel || '—'}</code>
              <span>{t.diagramDirection.tx}</span>
              <span>{t.diagramCorner(cornerText)}</span>
              <em>{reasonText('tx')}</em>
            </div>
            <div className="eye-wizard__wire">
              <strong>{t.diagramChannel}</strong>
              <code>{cleanPath(touchstone).split(/[\\/]/).pop()}</code>
              {inspect?.sha256 && <code title={inspect.sha256}>SHA-256{all.apiError.fieldSep}{inspect.sha256}</code>}
              <span>{t.topologyNames[topology as 'single' | 'differential' | 'dual_single'] || topology}</span>
              <span>{t.analysisRoute}{all.apiError.fieldSep}{t.routeLabel[route as keyof typeof t.routeLabel] || route}</span>
              {topology === 'dual_single'
                ? lanes.map(lane => <span key={lane.lane_id}>{lane.label}{all.apiError.fieldSep}{lane.input_port} → {lane.output_port}</span>)
                : <span>{ports.input_p}{topology === 'differential' ? `/${ports.input_n}` : ''} → {ports.output_p}{topology === 'differential' ? `/${ports.output_n}` : ''}</span>}
            </div>
            <div className="eye-wizard__box">
              <strong>{t.rx}</strong>
              <span>{rxPkg?.display_name || '—'}</span>
              <code>{rxModel || '—'}</code>
              <span>{t.diagramDirection.rx}</span>
              <span>{t.diagramCorner(cornerText)}</span>
              <em>{reasonText('rx')}</em>
            </div>
          </div>

          {(suggestion.warnings.length > 0 || (preflight?.warnings?.length ?? 0) > 0) && <details>
            <summary>{t.warnings}</summary>
            <ul>
              {/* 建議與設定預檢常回同一句，合併去重（畫面驗收 B3）。 */}
              {mergeWarnings(pickList(suggestion, 'warnings', lang), pickList(preflight, 'warnings', lang))
                .map(text => <li key={text} className="hint">{text}</li>)}
            </ul>
          </details>}
          {/* 後端預檢回報實際求解用的符號率與 UI（#0113，ADR-0068）。 */}
          {preflight?.unit_interval_ps && preflight?.symbol_rate_gbd && <p className="hint">
            {t.solveRate(String(preflight.symbol_rate_gbd), String(preflight.unit_interval_ps))}</p>}
          {adjustment && <p className="warning">
            {t.bitNote(adjustment.requested, adjustment.actual)}{adjustment.message ? `${all.apiError.listSep}${adjustment.message}` : ''}</p>}

          {engine === 'ami' && <EyeWizardAmiAdvanced
            touchstone={cleanPath(touchstone)} dataRateGbps={rate} modulation={modulation} ports={ports}
            txPackageId={sides.tx.packageId} rxPackageId={sides.rx.packageId}
            txModel={txModel} rxModel={rxModel}
            txCandidates={suggestion.tx.candidates} rxCandidates={suggestion.rx.candidates}
            txParams={txParams} rxParams={rxParams}
            showDdrMask={ddrMaskApplies(preset)}
            onParamsChange={next => { setTxParams(next.tx); setRxParams(next.rx) }} />}

          <label className={'eye-wizard__confirm' + (confirmation === 'stale' ? ' is-stale' : '')}>
            <input type="checkbox" checked={confirmation === 'confirmed'}
              disabled={!txModel || !rxModel || (engine === 'ami' && !amiCurrent?.data)}
              onChange={e => setConfirmedSig(e.target.checked ? signature : null)} />
            {t.confirm}
          </label>
          {confirmation === 'stale' && <p className="warning">{t.stale}</p>}
          {amiCurrent?.error && <p className="error">{t.preflightFailed(amiCurrent.error)}</p>}
        </>}
      </section>}

      {step === 5 && (!inspect || inspect.n_ports <= 4) && <section>
        <h3>{t.steps.run}</h3>
        <div className="eye-wizard__checklist">
          {missing.length === 0 ? <p>{t.ready}</p> : <>
            <strong>{t.checklistTitle}</strong>
            <ul>{missing.map(item => (
              <li key={item.key}>
                {t.missing[item.key]}
                {item.step !== 5 && <button className="btn--mini"
                  onClick={() => setStep(item.step)}>{t.goToStep(item.step)}</button>}
              </li>
            ))}</ul>
          </>}
        </div>
        <button className="btn--primary" disabled={busy || missing.length > 0}
          title={licenseBlock || undefined} onClick={() => void start()}>
          {busy ? t.starting : t.start}</button>
        {runEngine === 'ami'
          ? <LicenseTag functions={['ami_channel']} />
          : <LicenseTag functions={['ibis_channel']} />}
        {started && <p>{started}</p>}

        {myJob && <div className="eye-wizard__status">
          <h4>{t.statusTitle}</h4>
          <div className={`ibis-wizard__job is-${myJob.status || 'idle'}`}>
            <div><strong>{pickText(myJob, 'phase', lang) || t.notRun}</strong>
              <span>{pickText(myJob, 'message', lang)}</span></div>
            <div>{t.statusLine(statusLabel(myJob.status || 'idle', lang), elapsed, myJob.job_id || '—')}</div>
          </div>
          {myJob.error && <div className="model-library__issue is-error">{t.failed(pickText(myJob, 'error', lang))}</div>}
          {isQuickCheck && quickCheck && <p className="warning">
            {t.quickCheckBase}{all.apiError.fieldSep}{quickCheck.txModel || '—'} → {quickCheck.rxModel || '—'}</p>}
          {reuseOffer && <div className="eye-wizard__reuse">
            <strong>{t.reuseTitle}</strong>
            <p className="hint">{pickText(jobResult, 'message', lang)}</p>
            <button className="btn" disabled={busy || missing.length > 0 || startedSig !== signature}
              onClick={() => void start('use')}>{t.reuseUse}</button>
            <button className="btn" disabled={busy || missing.length > 0 || startedSig !== signature}
              onClick={() => void start('rerun')}>{t.reuseRerun}</button>
            {startedSig !== signature && <p className="warning">{t.reuseStale}</p>}
          </div>}
          {/* ADR-0017：重用的結果不得看起來像新求解。 */}
          {jobResult?.is_reused && <div className="model-library__issue is-warning">
            {t.reused(String(jobResult.manifest?.reused_from_run_id || jobResult.run_id || '—'))}</div>}
          {/* #0116：規格模型（SPISim 產生／本工具合成）要在結果頁看得出來；DDR5 Rx 合成模型標未含 DFE。 */}
          {!reuseOffer && <ModelOriginNotice result={jobResult} />}
          {(jobResult?.warnings?.length ?? 0) > 0 && !reuseOffer && (
            <details open={releasedWithErrors(jobResult)}>
              <summary>{t.runWarnings(jobResult.warnings.length)}</summary>
              <ul>{pickList(jobResult, 'warnings', lang).map((w: string) => <li key={w} className="hint">{w}</li>)}</ul>
            </details>
          )}
          {/* #0115：結果頁只放眼圖；量測表收進「眼圖參數」抽屜。眼圖無效的警示
              （黃字沒有眼圖資料、紅框無效）留在頁面上，不能藏進按鈕後面。 */}
          {blocks.map(block => <Fragment key={block.key}>
            {block.tone === 'warn' && <div className="model-library__issue is-warning">
              {t.resultTitle([block.analysis, block.lane].filter(Boolean).join(' · '))}{all.apiError.fieldSep}{t.noEyeData(block.reason)}</div>}
            {block.tone === 'error' && <div className="model-library__issue is-error">
              {t.resultTitle([block.analysis, block.lane].filter(Boolean).join(' · '))}{all.apiError.fieldSep}{t.invalid(block.reason)}</div>}
          </Fragment>)}
          {(images.length > 0 || blocks.length > 0 || Boolean(jobResult?.run_dir)) && <div className="eye-results__toolbar">
            {images.length > 0 && <h4>{t.eyeImages(eyeCount, impulseCount)}</h4>}
            {images.length > 0 && blocks.length > 0 && <button type="button" className="btn"
              aria-expanded={details.open} onClick={details.toggle}>
              {all.resultDetails.open}</button>}
            <OpenFolderButton path={jobResult?.run_dir} />
          </div>}
          {images.length > 0 && <EyeImageGallery items={images.map(card => ({
            key: card.key, title: card.title, sub: card.sub, url: card.url,
            reportKind: `eye-wizard-${card.key}`, reportTitle: t.snapshotTitle(card.title),
          }))} />}
          <ResultDetailsDrawer open={details.open} onClose={details.close} inline={images.length === 0}>
          {blocks.map(block => {
            // GetWave 疊眼與註記屬於整個分析（道的區塊沒有）。
            const extra = block.lane ? undefined : extras[block.key]
            return (
            <div key={block.key}>
              <h4>{t.resultTitle([block.analysis, block.lane].filter(Boolean).join(' · '))}</h4>
              {block.unitNote && <p className="hint">{block.unitNote}</p>}
              {block.unavailable && <p className="hint">{t.noMeasurements(block.unavailable)}</p>}
              {block.metrics.length > 0 && <table className="model-library__table eye-metrics">
                <thead><tr><th>{t.colMeasure}</th><th>{t.colValue}</th></tr></thead>
                <tbody>{block.metrics.map(row => <tr key={row.key}><td>{row.label}</td><td>{row.value}</td></tr>)}</tbody>
              </table>}
              {extra?.getwave?.available === true && <>
                <h4>{t.getwaveTitle}</h4>
                <table className="model-library__table eye-metrics">
                  <tbody>
                    <tr><td>{t.worstEyeHeight}</td><td>{extra.getwave.eyeHeight}</td></tr>
                    <tr><td>{t.worstEyeWidth}</td><td>{extra.getwave.eyeWidth}</td></tr>
                    <tr><td>{t.bitsUsed(extra.getwave.ignoredBits)}</td><td>{extra.getwave.bitsUsed}</td></tr>
                  </tbody>
                </table>
                {extra.getwave.definition && <p className="hint">{extra.getwave.definition}</p>}
              </>}
              {extra?.getwave?.available === false && <p className="hint">
                {t.getwaveUnavailable(extra.getwave.reason)}</p>}
              {extra && extra.notes.length > 0 && <div className="eye-wizard__notes">
                <strong>{t.notesTitle}</strong>
                <ul>{extra.notes.map(note => <li key={note} className="hint">{note}</li>)}</ul>
              </div>}
            </div>
            )
          })}
          </ResultDetailsDrawer>
        </div>}
      </section>}

      <div className="eye-wizard__nav">
        <button className="btn" disabled={step <= 1} onClick={() => setStep(step - 1)}>{t.back}</button>
        <button className="btn" disabled={step >= 5} onClick={() => setStep(step + 1)}>{t.next}</button>
      </div>
    </div>
  )
}
