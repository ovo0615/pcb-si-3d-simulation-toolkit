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
  originNote: string
  template: string
  templateKind: string
  aedtVersion: string
  ccomp: CcompView | null
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
