// 眼圖精靈的純函式（ 方案 A）。不碰 React，Node 直接測
// （tests/test_eye_wizard_logic_0088.py）。
//
// 畫面上「為什麼按不下去」「要不要重新確認」「這個變體是誰決定的」「結果能不能用」
// 都在這裡判斷，元件只負責畫。要顯示的字一律從語言檔來。

import { notesBesideValidity, pickList, pickText } from './backendFields'
import { messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'
import type { Messages } from './i18n/zh-TW'

export type WizardText = Messages['eyeWizard']

export function wizardText(lang: Lang): WizardText {
  return messagesFor(lang).eyeWizard
}

// ── 引擎分流 ──────────────────────────────────────────────

/** 兩端都是 AMI 才走 AMI；兩端都是標準 IBIS 走 ibis_channel。混用兩條後端都會
 *  擋（AMI 只收 ibis_ami、標準只收 ibis），所以在精靈裡先講清楚。 */
export type Engine = 'ami' | 'ibis' | 'mixed'

export function engineFor(txKind?: string, rxKind?: string): Engine | null {
  if (!txKind || !rxKind) return null
  const tx = txKind === 'ibis_ami'
  const rx = rxKind === 'ibis_ami'
  if (tx && rx) return 'ami'
  if (!tx && !rx) return 'ibis'
  return 'mixed'
}

// ── 輸入整理 ──────────────────────────────────────────────

/** 檔案總管「複製檔案位址」會連引號一起複製；前後引號與空白去掉。 */
export function cleanPath(text: string): string {
  return String(text || '').trim().replace(/^["']+|["']+$/g, '').trim()
}

// ── 小修 3：精靈裡就地看 DLL 信任狀態 ───────────────────────

export interface NativeLibraryState {
  file: string
  sha256: string
  scan_status: string
  trust_status: string
  required_here?: boolean
}

export type TrustState = 'trusted' | 'pending' | 'scanned' | 'scanError' | 'notHere'

/** 這台電腦不會載入的（Windows 上的 Linux .so）不必信任（小修 8）。 */
export function nativeTrustState(item: NativeLibraryState): TrustState {
  if (item.required_here === false) return 'notHere'
  if (item.trust_status === 'trusted') return 'trusted'
  if (item.scan_status === 'error') return 'scanError'
  if (item.scan_status === 'pending') return 'pending'
  return 'scanned'
}

export function untrustedCount(libraries: NativeLibraryState[][]): number {
  return libraries.flat().filter(item => {
    const state = nativeTrustState(item)
    return state !== 'trusted' && state !== 'notHere'
  }).length
}

/** 這一側可以選的 `[Model Selector]`：底下至少有一個變體在後端給的候選裡。 */
export function selectorsFor(
  selectors: { name: string; models: { name: string }[] }[] | undefined,
  candidates: string[],
): string[] {
  const allowed = new Set(candidates)
  return (selectors || [])
    .filter(selector => selector.models.some(model => allowed.has(model.name)))
    .map(selector => selector.name)
}

// ── 小修 2：確認狀態 ───────────────────────────────────────

/** 勾選當下記下設定簽章；之後設定一變就是 stale，畫面標黃要人重新核對，
 *  而不是像舊面板那樣悄悄把勾清掉、按鈕跟著變灰卻不說為什麼。 */
export type Confirmation = 'none' | 'confirmed' | 'stale'

export function confirmationState(confirmedSignature: string | null, current: string): Confirmation {
  if (confirmedSignature === null) return 'none'
  return confirmedSignature === current ? 'confirmed' : 'stale'
}

// ── 小修 1：開始前還缺什麼 ─────────────────────────────────

/** 每個缺項在第幾步補（1 起算）。順序就是畫面列出的順序。 */
export const MISSING_STEP = {
  touchstone: 1,
  portCount: 1,
  rate: 2,
  bitCount: 2,
  txPackage: 3,
  rxPackage: 3,
  engineMixed: 3,
  txModel: 3,
  rxModel: 3,
  overrideReason: 3,
  trust: 3,
  suggest: 4,
  preflight: 4,
  blockers: 4,
  ports: 4,
  confirm: 4,
  stale: 4,
  license: 5,
  running: 5,
  healthcheck: 5,
} as const

export type MissingKey = keyof typeof MISSING_STEP

export interface ChecklistInput {
  touchstone: string
  nPorts: number | null
  dataRateGbps: number | null
  txPackageId: string
  rxPackageId: string
  engine: Engine | null
  txModel: string
  rxModel: string
  overrideReasonMissing: boolean
  untrustedLibraries: number
  suggested: boolean
  blockers: number
  portsValid: boolean
  confirmation: Confirmation
  licenseBlocked: boolean
  jobRunning: boolean
  healthcheckRunning?: boolean
  /** AMI 的模擬位元數（標準 IBIS 不看）。 */
  bitCount: number
  /** AMI 的設定預檢（Ignore_Bits、路由）失敗。 */
  preflightFailed: boolean
  preflightPending?: boolean
}

export function missingItems(input: ChecklistInput): { key: MissingKey; step: number }[] {
  const keys: MissingKey[] = []
  if (!input.touchstone) keys.push('touchstone')
  else if (input.nPorts !== null && input.nPorts !== 2 && input.nPorts !== 4) keys.push('portCount')
  if (!(Number(input.dataRateGbps) > 0)) keys.push('rate')
  // AMI 後端只收 128 位元以上；清空欄位會變 0（交叉審查）。
  if (input.engine === 'ami' && !(Number(input.bitCount) >= 128)) keys.push('bitCount')
  if (!input.txPackageId) keys.push('txPackage')
  if (!input.rxPackageId) keys.push('rxPackage')
  if (input.engine === 'mixed') keys.push('engineMixed')
  if (input.txPackageId && !input.txModel) keys.push('txModel')
  if (input.rxPackageId && !input.rxModel) keys.push('rxModel')
  if (input.overrideReasonMissing) keys.push('overrideReason')
  if (input.untrustedLibraries > 0) keys.push('trust')
  if (!input.suggested) keys.push('suggest')
  else {
    if (input.blockers > 0) keys.push('blockers')
    if (!input.portsValid) keys.push('ports')
    if (input.preflightFailed || (input.engine === 'ami' && input.preflightPending)) keys.push('preflight')
  }
  if (input.confirmation === 'none') keys.push('confirm')
  if (input.confirmation === 'stale') keys.push('stale')
  if (input.licenseBlocked) keys.push('license')
  if (input.jobRunning) keys.push('running')
  if (input.healthcheckRunning) keys.push('healthcheck')
  return keys.map(key => ({ key, step: MISSING_STEP[key] }))
}

// ── Port 檢查 ─────────────────────────────────────────────

export interface PortMap { input_p: string; input_n: string; output_p: string; output_n: string }
export interface WizardLane {
  lane_id?: string
  label?: string
  input_port?: string
  output_port?: string
}

export interface WizardBindings { topology: string; ports: PortMap; lanes: WizardLane[] }

/** 預檢回來後要用的接線。keepRestored＝重開還原後的第一次預檢：已存了接線
 *  （有拓撲）就保留，只補建議；沒存過才照建議填。 */
export function bindingsAfterSuggest(current: WizardBindings, suggested: WizardBindings,
                                     keepRestored: boolean): WizardBindings {
  return keepRestored && current.topology ? current : suggested
}

/** 選到的埠要都在通道裡、彼此不重複（後端也會擋，這裡是讓按鈕先講原因）。 */
export function portsValid(topology: string, ports: PortMap, portNames: string[],
  lanes: WizardLane[]): boolean {
  let chosen: string[]
  if (topology === 'dual_single') {
    if (lanes.length !== 2) return false
    chosen = lanes.flatMap(lane => [lane.input_port || '', lane.output_port || ''])
  } else {
    chosen = [ports.input_p, ports.output_p]
    if (topology === 'differential') chosen.push(ports.input_n, ports.output_n)
  }
  if (chosen.some(name => !name || !portNames.includes(name))) return false
  return new Set(chosen).size === chosen.length
}

// ── 方案 A ③：變體漏斗 ────────────────────────────────────

export interface FunnelStep {
  key: 'technology' | 'rate' | 'odt_presence' | 'odt_ohm' | 'drive_ohm'
  decided_by: 'tool' | 'user'
  value: number | boolean | string | null
  count: number
  checked?: boolean
  options?: number[]
  needed?: boolean
}

export interface Funnel {
  selector: string
  total: number
  steps: FunnelStep[]
  remaining: { name: string; description: string }[]
  selected: string
  requires_user: boolean
  candidates?: string[]
}

export interface FunnelRow {
  key: FunnelStep['key']
  label: string
  decidedBy: string
  valueText: string
  count: number
  note: string
  /** 這一層是不是要使用者回答（ODT 阻值、驅動強度）。 */
  ask: boolean
  options: number[]
  value: number | null
}

export function funnelRows(funnel: Funnel, t: WizardText): FunnelRow[] {
  return funnel.steps.map(step => {
    // 檔內沒有這項資訊（例如接收端變體只寫 ODT、沒寫驅動強度）時 options 是空的：
    // 不問，否則畫面上是一個只有「尚未回答」的下拉。
    const noOptions = (step.key === 'odt_ohm' || step.key === 'drive_ohm')
      && step.needed !== false && !(step.options || []).length
    const ask = step.decided_by === 'user' && step.key !== 'technology'
      && step.needed !== false && !noOptions
    let valueText = ''
    if (step.key === 'rate') valueText = t.rateValue(Number(step.value))
    else if (step.key === 'odt_presence') valueText = step.value ? t.odtOn : t.odtOff
    else if (step.key === 'technology') valueText = String(step.value ?? '')
    else if (step.needed === false) valueText = t.notNeeded
    else if (noOptions) valueText = t.notInFile
    else valueText = step.value === null || step.value === undefined
      ? t.notAnswered : t.ohmValue(Number(step.value))
    return {
      key: step.key,
      label: t.funnelStep[step.key],
      decidedBy: t.decidedBy[step.decided_by],
      valueText,
      count: step.count,
      note: step.key === 'rate' && step.checked === false ? t.rateUnchecked : '',
      ask,
      options: ask ? [...(step.options || [])] : [],
      value: typeof step.value === 'number' ? step.value : null,
    }
  })
}

// ──  結果契約 ────────────────────────────────────────

export interface MetricRow { key: string; label: string; value: string }

export interface ResultBlock {
  key: string
  analysis: string
  lane: string
  /** ok：可用；warn：沒有眼圖資料（AEDT 沒累積出眼圖，不是閉合）；error：其他無效。 */
  tone: 'ok' | 'warn' | 'error'
  invalidKind: string
  reason: string
  unitNote: string
  unavailable: string
  metrics: MetricRow[]
}

type AnyRecord = Record<string, any>

function metricRows(measurements: AnyRecord | undefined, lang: Lang): MetricRow[] {
  const metrics = measurements?.metrics
  if (!metrics || typeof metrics !== 'object') return []
  return Object.entries(metrics as AnyRecord).map(([key, item]) => {
    const unit = typeof item?.unit === 'string' ? item.unit : ''
    // 單位照後端給的（AEDT 會自己切 V／mV）；沒給就只印數字，不自己補 mV。
    const value = item?.value !== undefined && item?.value !== null
      ? `${Number(item.value).toPrecision(4)}${unit ? ` ${unit}` : ''}`
      : pickText(item, 'text', lang)
    return { key, label: pickText(item, 'label', lang) || key, value }
  })
}

function block(key: string, analysis: string, lane: string, scope: AnyRecord,
  parent: AnyRecord, lang: Lang): ResultBlock {
  const validity: AnyRecord | undefined = scope.validity || parent.validity
  const measurements: AnyRecord | undefined = scope.measurements
  const invalid = validity?.valid === false
  const kind = invalid ? String(validity?.kind || '') : ''
  return {
    key, analysis, lane,
    tone: !invalid ? 'ok' : kind === 'no_eye_data' ? 'warn' : 'error',
    invalidKind: kind,
    reason: invalid ? pickText(validity, 'reason', lang) : '',
    unitNote: pickText(measurements, 'voltage_unit_note', lang),
    unavailable: measurements?.available === false
      ? pickText(measurements, 'unavailable_reason', lang) : '',
    metrics: metricRows(measurements, lang),
  }
}

/** 每個分析一塊；雙單端逐道一塊（道的量測在 lanes[] 裡）。 */
export function resultBlocks(result: AnyRecord | null | undefined, lang: Lang): ResultBlock[] {
  const t = wizardText(lang)
  const blocks: ResultBlock[] = []
  ;(result?.results || []).forEach((res: AnyRecord, index: number) => {
    const analysis = String(res?.analysis || '')
    const lanes: AnyRecord[] = res?.lanes || []
    if (lanes.length) {
      lanes.forEach((lane, laneIndex) => blocks.push(block(
        `${index}-${laneIndex}`, analysis, String(lane?.label || t.laneN(laneIndex + 1)),
        lane, res, lang)))
    } else {
      blocks.push(block(`${index}`, analysis, '', res, res, lang))
    }
  })
  return blocks
}

/** 後端因 Ignore_Bits 調整或警告的位元數；沒有就回 null。 */
export function bitAdjustment(result: AnyRecord | null | undefined, lang: Lang):
  { requested: number; actual: number; message: string } | null {
  const adjustment = result?.bit_count_adjustment
  if (!adjustment || typeof adjustment !== 'object') return null
  return {
    requested: Number(adjustment.requested),
    actual: Number(adjustment.actual),
    message: pickText(adjustment, 'message', lang),
  }
}

export interface EyeImage { key: string; title: string; sub: string; url: string }

/** 漏斗只可替與回應相同的選型條件供選模；等待新答案時舊結果不生效。 */
export function currentFunnel(
  result: { signature: string; data: Funnel } | null, signature: string,
): Funnel | null {
  return result?.signature === signature ? result.data : null
}

/** 只挑眼圖，不挑 impulse／波形：檔名 *_eye.jpg 或 *_Eye.jpg；道的第 0 張是波形。 */
export function eyeImages(engine: 'ami' | 'ibis', result: AnyRecord | null | undefined,
  lang: Lang = 'zh-TW', jobId = ''): EyeImage[] {
  const t = wizardText(lang)
  const prefix = engine === 'ami' ? '/api/ami-channel/image' : '/api/ibis-channel/image'
  const url = (analysis: number, lane: number, image: number) =>
    `${prefix}?analysis_index=${analysis}&lane_index=${lane}&image_index=${image}`
    + (jobId ? `&job_id=${encodeURIComponent(jobId)}` : '')
  const pickEye = (paths: string[]) => {
    const named = paths.findIndex(path => /_eye\.jpg$/i.test(String(path)))
    if (named >= 0) return named
    return paths.length > 1 ? paths.length - 1 : paths.length === 1 ? 0 : -1
  }
  const cards: EyeImage[] = []
  ;(result?.results || []).forEach((res: AnyRecord, index: number) => {
    const analysis = String(res?.analysis || '')
    const lanes: AnyRecord[] = res?.lanes || []
    if (lanes.length) {
      lanes.forEach((lane, laneIndex) => {
        const image = pickEye(lane?.image_paths || [])
        if (image >= 0) cards.push({ key: `${index}-${laneIndex}`,
          title: String(lane?.label || t.laneN(laneIndex + 1)), sub: analysis,
          url: url(index, laneIndex, image) })
      })
      return
    }
    const image = pickEye(res?.image_paths || [])
    if (image >= 0) cards.push({ key: `${index}`, title: analysis, sub: '', url: url(index, -1, image) })
  })
  return cards
}

/** 精靈第 5 步，impulse 響應另列在眼圖後面（舊 AMI 面板有）。只挑
 *  檔名 *_impulse.jpg 的；道的圖沒有 impulse。 */
export function impulseImages(engine: 'ami' | 'ibis', result: AnyRecord | null | undefined,
  lang: Lang = 'zh-TW', jobId = ''): EyeImage[] {
  const t = wizardText(lang)
  const prefix = engine === 'ami' ? '/api/ami-channel/image' : '/api/ibis-channel/image'
  const cards: EyeImage[] = []
  ;(result?.results || []).forEach((res: AnyRecord, index: number) => {
    if ((res?.lanes || []).length) return
    const analysis = String(res?.analysis || '')
    ;(res?.image_paths || []).forEach((path: string, image: number) => {
      if (!/_impulse\.jpg$/i.test(String(path))) return
      // 標題已經帶分析名，副標不重複（畫面驗收 T4）。
      cards.push({ key: `impulse-${index}-${image}`, title: t.impulseTitle(analysis), sub: '',
        url: `${prefix}?analysis_index=${index}&lane_index=-1&image_index=${image}`
          + (jobId ? `&job_id=${encodeURIComponent(jobId)}` : '') })
    })
  })
  return cards
}

// ── ：GetWave 結果與註記（舊 AMI 面板搬過來）──────────────

export type GetwaveSummary =
  | { available: true; eyeHeight: string; eyeWidth: string; bitsUsed: string;
      ignoredBits: string; definition: string }
  | { available: false; reason: string }

export interface AnalysisExtra {
  getwave: GetwaveSummary | null
  notes: string[]
}

/** 每個分析（以 results 的索引為鍵）的 GetWave 疊眼與後端註記。註記裡和
 *  「結果無效」原因重複的那一條不再列（紅框已經寫了）。 */
export function analysisExtras(result: AnyRecord | null | undefined, lang: Lang):
  Record<string, AnalysisExtra> {
  const out: Record<string, AnalysisExtra> = {}
  ;(result?.results || []).forEach((res: AnyRecord, index: number) => {
    const wave: AnyRecord | undefined = res?.waveform_eye
    let getwave: GetwaveSummary | null = null
    if (wave && wave.available) {
      getwave = {
        available: true,
        eyeHeight: `${Number(wave.eye_height).toPrecision(4)}${wave.unit ? ` ${wave.unit}` : ''}`,
        eyeWidth: `${Number(wave.eye_width_ui).toFixed(3)} UI`,
        bitsUsed: String(wave.bits_used ?? '—'),
        ignoredBits: String(wave.ignored_bits ?? '—'),
        definition: pickText(wave, 'definition', lang),
      }
    } else if (wave && wave.available === false) {
      getwave = { available: false, reason: pickText(wave, 'reason', lang) }
    }
    const raw: unknown[] = Array.isArray(res?.notes) ? res.notes : []
    const shown = notesBesideValidity(res?.notes, res?.validity)
    const notes = pickList(res, 'notes', lang).filter((_note, i) => shown.includes(String(raw[i])))
    out[String(index)] = { getwave, notes }
  })
  return out
}

// ── ：分析方式、AMI 參數、等化掃描、DDR4 眼罩 ─────────────

/** 兩條後端各自接受的 analysis_route（ibis_channel._ANALYSIS_ROUTES、ami_channel._ROUTES）。 */
export function analysisRoutes(engine: 'ami' | 'ibis'): string[] {
  return engine === 'ami'
    ? ['auto', 'statistical', 'getwave', 'compare']
    : ['auto', 'quick_eye', 'transient', 'quick_eye_then_transient']
}

/** 換了引擎，原本選的方式不在新清單裡就回到 auto，不送後端不認得的值。 */
export function routeFor(engine: 'ami' | 'ibis', route: string): string {
  return analysisRoutes(engine).includes(route) ? route : 'auto'
}

/** 只留親手改過的 AMI 參數；空字串＝清掉、回到 .ami 預設。 */
export function touchedParameters(params: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(params || {}).filter(([, value]) => value !== ''))
}

// ── 送出內容 ──────────────────────────────────────────────

export interface StartState {
  touchstone: string
  txPackageId: string
  rxPackageId: string
  txModel: string
  rxModel: string
  topology: string
  ports: PortMap
  lanes: WizardLane[]
  dataRateGbps: number
  corner: string
  modulation: string
  bitCount: number
  confirmed: boolean
  /** 選型依據：變體漏斗的答案、改用模型與理由，寫進執行紀錄。 */
  selectionBasis?: Record<string, unknown>
  /** 分析方式；沒給就是 auto。 */
  analysisRoute?: string
  /** 親手改過的 AMI 參數；標準 IBIS 不送。 */
  txParameters?: Record<string, string>
  rxParameters?: Record<string, string>
}

function wiring(state: StartState, withCorner: boolean): Record<string, unknown> {
  // 標準 IBIS 每一道明確帶 Corner：後端道的 Corner 留空才沿用頂層（交叉審查 高-1）；AMI 沒有 Corner。
  if (state.topology === 'dual_single') {
    return { lanes: withCorner ? state.lanes.map(lane => ({ ...lane, corner: state.corner })) : state.lanes }
  }
  const body: Record<string, unknown> = {
    input_p: state.ports.input_p, output_p: state.ports.output_p,
  }
  if (state.topology === 'differential') {
    body.input_n = state.ports.input_n
    body.output_n = state.ports.output_n
  }
  return body
}

/** 兩種引擎的開始請求。AMI 沒有 Corner 欄位；標準 IBIS 沒有調變。 */
export function startRequest(engine: 'ami' | 'ibis', state: StartState):
  { url: string; body: Record<string, unknown> } {
  const common = {
    touchstone_path: state.touchstone,
    tx_package_id: state.txPackageId,
    rx_package_id: state.rxPackageId,
    tx_model: state.txModel,
    rx_model: state.rxModel,
    topology: state.topology,
    data_rate_gbps: state.dataRateGbps,
    analysis_route: routeFor(engine, state.analysisRoute || 'auto'),
    confirmed: state.confirmed,
    selection_basis: state.selectionBasis || {},
    ...wiring(state, engine === 'ibis'),
  }
  if (engine === 'ami') {
    const body: Record<string, unknown> = {
      ...common, modulation: state.modulation, bit_count: state.bitCount }
    // 只送親手改過的；沒改的由 .ami 預設接手（後端記錄略過的）。
    const tx = touchedParameters(state.txParameters)
    const rx = touchedParameters(state.rxParameters)
    if (Object.keys(tx).length) body.tx_parameters = tx
    if (Object.keys(rx).length) body.rx_parameters = rx
    return { url: '/api/ami-channel/start', body }
  }
  return { url: '/api/ibis-channel/start', body: { ...common, corner: state.corner } }
}

// ──  第 3 輪（審稿 H2／L7、畫面驗收 B3／B4／T 系列）──────────────

/** 一個 UI 幾 ps。資料率欄是位元率（Gb/s）；PAM4 一個符號 2 bit，引擎看的是
 *  符號率，所以 UI＝1/(rate/2)（審稿 H2）。沒有速率回 null。 */
export function uiPs(rateGbps: number | null | undefined, modulation: string | null | undefined): number | null {
  const baud = symbolRateGbd(rateGbps, modulation)
  return baud === null ? null : Number((1000 / baud).toFixed(4))
}

/** 符號率（GBd）：NRZ 等於位元率，PAM4 是一半（後端 app/rate_semantics.symbol_rate_gbd）。 */
export function symbolRateGbd(rateGbps: number | null | undefined, modulation: string | null | undefined): number | null {
  const rate = Number(rateGbps)
  if (rateGbps === null || rateGbps === undefined || !Number.isFinite(rate) || rate <= 0) return null
  return Number((modulation === 'PAM4' ? rate / 2 : rate).toFixed(6))
}

export interface QuickCheckMark { jobId: string; txModel: string; rxModel: string }

/** 快速檢驗標記存在 sessionStorage（跟 job ID 一起），重新整理後仍認得那是基準眼圖。 */
export function parseQuickCheck(raw: string | null | undefined): QuickCheckMark | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value.jobId !== 'string' || !value.jobId) return null
    return { jobId: value.jobId, txModel: String(value.txModel || ''), rxModel: String(value.rxModel || '') }
  } catch { return null }
}

/** 建議與設定預檢各自回 warnings，同一句常常兩邊都有（畫面驗收 B3）。保留先後順序去重。 */
export function mergeWarnings(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat().filter(Boolean)))
}

/** 超過 4 埠走多埠分支，多埠只有標準 IBIS（畫面驗收 B4）。 */
export function wizardEngine(txKind?: string, rxKind?: string, nPorts?: number | null): Engine | null {
  if (nPorts !== null && nPorts !== undefined && nPorts > 4) return 'ibis'
  return engineFor(txKind, rxKind)
}

/** 分析方式的說明跟著所選方式換（畫面驗收 T3）。 */
export function routeHint(engine: 'ami' | 'ibis', route: string, lang: Lang = 'zh-TW'): string {
  const t = wizardText(lang)
  if (route === 'auto' || !route) return t.routeHint[engine]
  return (t.routeHintBy as Readonly<Record<string, string>>)[route] || t.routeHint[engine]
}

/** 工作狀態代碼 → 畫面文字；不認得的照原值（畫面驗收 T5）。 */
export function statusLabel(status: string, lang: Lang = 'zh-TW'): string {
  return (wizardText(lang).statusNames as Readonly<Record<string, string>>)[status] || status
}

/** 工作的失敗說明；只有真的結束在 error 才有。還在跑時的 error 不是結論，
 *  畫面維持處理中、繼續輪詢（ 驗收發現 G：後處理時先報失敗、約 20 秒後又出結果）。 */
export function jobFailureText(job: AnyRecord | null | undefined, lang: Lang = 'zh-TW'): string {
  if (!job || job.running || job.status !== 'error') return ''
  return pickText(job, 'error', lang)
}

interface PresetLike { family?: string; min_bits?: number | null; supported?: boolean }

/** bit 數低於規範下限時回下限（畫面驗收 T9）。 */
export function belowMinBits(preset: PresetLike | null | undefined, bitCount: number): number | null {
  const min = Number(preset?.min_bits)
  if (!preset || !Number.isFinite(min) || min <= 0) return null
  return Number(bitCount) < min ? min : null
}
