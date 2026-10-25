// 模型庫裡 SPISim／本工具合成之模型的來源判讀純函式。
// 不碰 React，Node 直接測。
//
// 來源不能從檔案內容推測：SPISim 產生的模型 [Manufacturer] 寫 ANSYS Inc，看起來
// 像原廠。後端在產生時標 source_classification（self_built＋generator: spisim），
// 這裡只讀那個標記。

import { pickText } from './backendFields'
import type { Lang } from './i18n/lang'

type AnyRecord = Record<string, any>

export type CcompLevel = 'ok' | 'warn' | 'error' | 'unknown'

/** 未判定的原因：C_comp ≤ 0 佔位值／模型沒寫 C_comp／沒有資料率。 */
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
  /** 本工具合成的規格模型（非原廠、非 SPISim）。 */
  synth: boolean
  /** manifest 的 generator：spisim／toolkit_synth；其他自建模型是空字串。 */
  generator: ModelGenerator
  /** 合成模型：規範代號、角色、各參數的值與出處；DDR5 Rx 未含 DFE。 */
  family: string
  /** 規範的顯示名稱（DDR5、LPDDR4X）；family 是小寫代號。 */
  familyLabel: string
  role: string
  noDfe: boolean
  /** 合成的 SerDes：只有 IBIS、沒有 AMI 等化。 */
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
  // 合成的 SerDes 沒有 AMI 等化：Tx、Rx 都列。
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
