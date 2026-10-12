// 模型庫裡 SPISim 規格模型的純函式（#0104）。不碰 React，Node 直接測
// （tests/test_model_library_spisim_0104.py）。
//
// 來源不能從檔案內容推測：SPISim 產生的模型 [Manufacturer] 寫 ANSYS Inc，看起來
// 像原廠。後端在產生時標 source_classification（self_built＋generator: spisim），
// 這裡只讀那個標記。

import { pickText } from './backendFields'
import type { Lang } from './i18n/lang'

type AnyRecord = Record<string, any>

export type CcompLevel = 'ok' | 'warn' | 'error' | 'unknown'

/** 未判定的原因（#0104 E3）：C_comp ≤ 0 佔位值／模型沒寫 C_comp／沒有資料率。 */
export type CcompUnknownReason = 'placeholder' | 'no_ccomp' | 'no_rate' | ''

export interface CcompView {
  level: CcompLevel
  /** 後端寫好的完整說明（含模型名、C_comp、τ、τ/UI）。 */
  note: string
  ratio: string
  tau: string
  cpf: string
  rate: string
  /** level 是 unknown 時才有值。 */
  unknownReason: CcompUnknownReason
}

/** 後端有給 `unknown_reason` 就用；改版前的紀錄沒有，從 C_comp 與資料率推。
 *  SPISim 的 AMI 範本 C_comp 是 0 pF，有帶資料率也判不了——不能一律說「沒有資料率」。 */
function ccompUnknownReason(check: AnyRecord, level: CcompLevel): CcompUnknownReason {
  if (level !== 'unknown') return ''
  const given = check.unknown_reason
  if (given === 'placeholder' || given === 'no_ccomp' || given === 'no_rate') return given
  const cpf = check.c_comp_pf
  if (cpf === null || cpf === undefined || cpf === '' || !Number.isFinite(Number(cpf))) return 'no_ccomp'
  if (Number(cpf) <= 0) return 'placeholder'
  return 'no_rate'
}

export interface SpecModelInfo {
  /** SPISim 產生的規格模型（非原廠）。 */
  spisim: boolean
  /** 本工具合成的規格模型（非原廠、非 SPISim；#0116，ADR-0069）。 */
  synth: boolean
  /** manifest 的 generator：spisim／toolkit_synth；其他自建模型是空字串。 */
  generator: ModelGenerator
  /** 合成模型：規範代號、角色、各參數的值與出處；DDR5 Rx 未含 DFE。 */
  family: string
  /** 規範的顯示名稱（DDR5、LPDDR4X）；family 是小寫代號。 */
  familyLabel: string
  role: string
  noDfe: boolean
  /** 合成的 SerDes：只有 IBIS、沒有 AMI 等化（#0116 第二輪）。 */
  noEq: boolean
  parameters: SynthParameterView[]
  originNote: string
  template: string
  templateKind: string
  aedtVersion: string
  ccomp: CcompView | null
}

export type ModelGenerator = 'spisim' | 'toolkit_synth' | ''

export interface SynthParameterView {
  key: string
  value: string
  source: string
  /** confirmed／user（使用者輸入）／待確認。 */
  status: string
}

/** 合成參數（manifest 的 parameters）→ 顯示列；值是陣列就以「／」相接。 */
export function synthParameters(raw: unknown, lang: Lang): SynthParameterView[] {
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw as AnyRecord).map(([key, item]) => {
    const value = Array.isArray(item?.value)
      ? item.value.map((v: unknown) => num(v)).join(' / ')
      : num(item?.value)
    return { key, value, source: pickText(item || {}, 'source', lang), status: String(item?.status || '') }
  })
}

const num = (value: unknown, digits?: number): string => {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return digits === undefined ? String(Number(n.toPrecision(4))) : n.toFixed(digits)
}

/** 自建（self_built）的套件才回資料；原廠、範例、未標記回 null。 */
export function specModelInfo(pkg: AnyRecord | null | undefined, lang: Lang): SpecModelInfo | null {
  const source = pkg?.source_classification
  if (!source || source.source !== 'self_built') return null
  const check = source.ccomp_check
  const levels: CcompLevel[] = ['ok', 'warn', 'error', 'unknown']
  const level: CcompLevel = check && levels.includes(check.level) ? check.level : 'unknown'
  const ccomp: CcompView | null = check && typeof check === 'object' ? {
    level,
    note: pickText(check, 'note', lang),
    ratio: num(check.tau_over_ui, 2),
    tau: num(check.tau_ps),
    cpf: num(check.c_comp_pf),
    rate: num(check.data_rate_gbps),
    unknownReason: ccompUnknownReason(check, level),
  } : null
  return {
    spisim: source.generator === 'spisim',
    synth: source.generator === 'toolkit_synth',
    generator: source.generator === 'spisim' || source.generator === 'toolkit_synth' ? source.generator : '',
    family: String(source.family || ''),
    // 合成時記下規範表的 label；這之前產生的沒有，代號是顯示名稱的小寫（lpddr4x → LPDDR4X）。
    familyLabel: String(source.family_label || source.family || '').toUpperCase(),
    role: String(source.role || ''),
    noDfe: Boolean(source.no_dfe),
    noEq: Boolean(source.no_eq),
    parameters: synthParameters(source.parameters, lang),
    originNote: pickText(source, 'origin_note', lang),
    template: String(source.template || ''),
    templateKind: String(source.template_kind || ''),
    aedtVersion: String(source.aedt_version || ''),
    ccomp,
  }
}

export interface LicenseFailure {
  /** 引擎正在跑 COM／ERL（`spisim.engine_busy`）：不是授權問題，稍後再按即可。 */
  busy: boolean
  reason: string
  features: string[]
  detail: string
  detail_en: string
}

/** 產生規格模型被擋下（HTTP 409）：`spisim.license_unavailable` 是授權閘門，
 *  `spisim.engine_busy` 是引擎正在跑別的工作（#0113）。
 *  後端放在頂層；FastAPI 的 HTTPException 會包一層 detail，兩種都認。 */
export function licenseUnavailable(body: unknown): LicenseFailure | null {
  if (!body || typeof body !== 'object') return null
  const top = body as AnyRecord
  const known = (code: unknown) => code === 'spisim.license_unavailable' || code === 'spisim.engine_busy'
  const payload: AnyRecord | null = known(top.code) ? top
    : top.detail && typeof top.detail === 'object' && known(top.detail.code) ? top.detail : null
  if (!payload) return null
  return {
    busy: payload.code === 'spisim.engine_busy',
    reason: String(payload.reason || ''),
    features: Array.isArray(payload.required_features) ? payload.required_features.map(String) : [],
    detail: String(payload.detail || ''),
    detail_en: String(payload.detail_en || ''),
  }
}

export interface IbisTemplate {
  name: string
  kind: 'io' | 'input'
  vcc_v: number
  z_ohm: number
  slew_ps: number | null
}

export interface TemplateFilter { kind: string; vcc: string; z: string; slew: string }

/** 126 份 IBIS 範本依種類、Vcc、阻抗、斜率篩選；空字串＝不限。 */
export function filterTemplates(items: IbisTemplate[], filter: TemplateFilter): IbisTemplate[] {
  const same = (want: string, value: number | null) =>
    want === '' || (value !== null && Math.abs(Number(want) - value) < 1e-9)
  return (items || []).filter(item => (!filter.kind || item.kind === filter.kind)
    && same(filter.vcc, item.vcc_v) && same(filter.z, item.z_ohm) && same(filter.slew, item.slew_ps))
}

/** POST /api/models/generate-spec 的內容：standard 與 ibis_template 只帶一個；
 *  資料率有填才帶（C_comp τ/UI 用它算）。缺必要選擇回 null。 */
export function generateSpecBody(mode: 'ami' | 'ibis', standard: string, template: string,
  rate: string): Record<string, unknown> | null {
  const body: Record<string, unknown> = {}
  if (mode === 'ami') {
    if (!standard) return null
    body.standard = standard
  } else {
    if (!template) return null
    body.ibis_template = template
  }
  const gbps = Number(rate)
  if (String(rate).trim() !== '' && gbps > 0) body.data_rate_gbps = gbps
  return body
}

/** 規格標準在下拉裡的名稱。英文介面沒有 label_en 時用代號（例 USB32G2），
 *  不把全形括號與中文逗號的中文標籤塞進英文畫面（畫面驗收 T2）。 */
export function specStandardLabel(item: { name: string; label?: string; label_en?: string },
  lang: Lang): string {
  if (lang === 'en') return item.label_en || item.name
  return item.label || item.name
}

/** 只有中文的說明在英文介面不顯示（畫面驗收 T1）；有 `_en` 才顯示英文。 */
export function localizedNote(source: AnyRecord | null | undefined, key: string, lang: Lang): string {
  if (!source) return ''
  if (lang === 'en') return String(source[`${key}_en`] || '')
  return String(source[key] || '')
}

// ── 本工具合成（#0116，ADR-0069） ─────────────────────────────

export type SynthRoleChoice = 'tx' | 'rx' | 'both'

export interface SynthForm {
  family: string
  roles: SynthRoleChoice
  rate: string
  ccomp: string
  slewMin: string
  slewMax: string
  /** 規範表待確認的參數由使用者填（鍵同後端 PARAM_KEYS；清單用逗號分隔）。 */
  overrides: Record<string, string>
}

const positive = (text: string): number | null => {
  if (String(text ?? '').trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** POST /api/models/generate-synth 的內容。空白欄位不帶（後端用規範表）；
 *  填了但不是正數也不帶——後端會說哪一項待確認，比靜默送 0 好。
 *  待確認參數的字串原樣送（後端解析「34, 40」並檢查），錯了由後端講清楚。 */
export function generateSynthBody(form: SynthForm): Record<string, unknown> | null {
  if (!form.family) return null
  const body: Record<string, unknown> = {
    family: form.family,
    roles: form.roles === 'both' ? ['tx', 'rx'] : [form.roles],
  }
  const fields: [keyof SynthForm, string][] = [['rate', 'data_rate_gbps'], ['ccomp', 'c_comp_pf'],
    ['slewMin', 'slew_min_v_per_ns'], ['slewMax', 'slew_max_v_per_ns']]
  for (const [key, name] of fields) {
    const value = positive(form[key] as string)
    if (value !== null) body[name] = value
  }
  const overrides = Object.fromEntries(Object.entries(form.overrides || {})
    .filter(([, value]) => String(value ?? '').trim() !== ''))
  if (Object.keys(overrides).length) body.overrides = overrides
  return body
}

/** 規範表裡待確認、必須由使用者填的欄位（前端標紅、按鈕前先提醒）。
 *  和後端 resolve_request 的必要條件一致：VDDQ、Ron 可選值、C_IO；Rx 有端接時
 *  的 ODT 可選值；Tx 的斜率。預設值、容差、Vin 門檻查不到不擋。 */
export function synthMissingInputs(family: AnyRecord | null | undefined, form: SynthForm): string[] {
  if (!family?.params) return []
  const filled = (key: string) => String(form.overrides?.[key] ?? '').trim() !== ''
  const unconfirmed = (key: string) => !filled(key) && (family.params[key]?.status !== 'confirmed'
    || family.params[key]?.value === null || family.params[key]?.value === undefined)
  const missing: string[] = []
  if (family.kind === 'serdes') {
    // 差動 SerDes（#0116 第二輪）：和後端 _resolve_serdes 一致。
    // Rx 的擺幅只用來定共模，沒有也不擋。
    if (form.roles !== 'rx' && unconfirmed('vdiff_pp_v')) missing.push('vdiff_pp_v')
    if (unconfirmed('r_se_ohm')) missing.push('r_se_ohm')
    if (form.roles !== 'rx' && unconfirmed('rise_2080_ps')) missing.push('rise_2080_ps')
    // Tx、Rx 的 pad 電容各一列（USB 的上限不同）；C_comp 捷徑兩邊都適用。
    if (positive(form.ccomp) === null) {
      if (form.roles !== 'rx' && unconfirmed('c_pad_pf')) missing.push('c_pad_pf')
      if (form.roles !== 'tx' && unconfirmed('c_pad_rx_pf')) missing.push('c_pad_rx_pf')
    }
    return missing
  }
  if (unconfirmed('vddq')) missing.push('vddq')
  // Rx 的 Ron 只用來推接收門檻：CTT／無端接的 Rx 用不到（後端同一條規則）。
  const needRon = form.roles !== 'rx' || family.termination === 'pod' || family.termination === 'lvstl'
  if (needRon && unconfirmed('ron_options')) missing.push('ron_options')
  if (form.roles !== 'tx' && family.termination !== 'none' && unconfirmed('odt_options')) {
    missing.push('odt_options')
  }
  if (unconfirmed('c_io_pf') && positive(form.ccomp) === null) missing.push('c_io_pf')
  if (form.roles !== 'rx' && unconfirmed('slew_v_per_ns')
    && positive(form.slewMin) === null && positive(form.slewMax) === null) missing.push('slew_v_per_ns')
  return missing
}

export interface RunOriginLine {
  role: 'Tx' | 'Rx'
  generator: ModelGenerator
  name: string
  label: string
}

/** SPISim 規格模型當 Rx 的終端種類（後端 model_origin.spisim_rx_kind）：兩種都不是 POD。
 *  split：參數式（視窗產生）上下分壓；template：jar Input 範本只接地。 */
export type SpisimRxKind = 'split' | 'template'

/** 眼圖結果的模型來源（執行紀錄頂層 model_origin）；原廠模型不列。 */
export function runModelOrigin(result: AnyRecord | null | undefined, lang: Lang):
  { lines: RunOriginLine[]; noDfe: string; noEq: string[]; spisimRx: { name: string; kind: SpisimRxKind } | null } {
  // 一般結果在頂層、重用結果在 manifest、Corner 掃描取第一筆（各筆模型相同）。
  const origin = result?.model_origin || result?.manifest?.model_origin
    || result?.runs?.[0]?.result?.model_origin
  const lines: RunOriginLine[] = []
  let noDfe = ''
  // 合成的 SerDes 沒有 AMI 等化：Tx、Rx 都列（#0116 第二輪）。
  const noEq: string[] = []
  let spisimRx: { name: string; kind: SpisimRxKind } | null = null
  for (const role of ['tx', 'rx'] as const) {
    const item = origin?.[role]
    if (!item || (item.generator !== 'spisim' && item.generator !== 'toolkit_synth')) continue
    const name = String(item.display_name || '')
    lines.push({ role: role === 'tx' ? 'Tx' : 'Rx', generator: item.generator, name,
      label: pickText(item, 'label', lang) })
    if (role === 'rx' && item.no_dfe) noDfe = name
    if (item.no_eq) noEq.push(name)
    if (role === 'rx' && (item.spisim_rx === 'split' || item.spisim_rx === 'template')) {
      spisimRx = { name, kind: item.spisim_rx }
    }
  }
  return { lines, noDfe, noEq, spisimRx }
}

/** SPISim 一般 IBIS 範本的「依規範帶入」：規範表的 VDDQ 與預設阻抗
 *  （I/O 用 Ron、Input 用 ODT）。待確認的值不帶，留給使用者自己選。 */
export function spisimFilterForFamily(family: AnyRecord, kind: string): Partial<TemplateFilter> {
  const confirmed = (key: string) => family?.params?.[key]?.status === 'confirmed'
    ? family.params[key].value : null
  const out: Partial<TemplateFilter> = {}
  if (family?.spisim_template_vcc) out.vcc = String(family.spisim_template_vcc)
  const z = confirmed(kind === 'input' ? 'odt_default' : 'ron_default')
  out.z = z === null || z === undefined ? '' : String(z)
  return out
}
