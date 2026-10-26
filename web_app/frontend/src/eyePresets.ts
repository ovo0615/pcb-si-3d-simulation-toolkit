// 眼圖精靈「常見規範預設」的純函式。不碰 React，Node 直接測
// （tests/test_eye_presets_frontend_0104.py）。
//
// 資料在後端 protocol_presets.py（GET /api/eye-presets），這裡不另存一份資料率。
// 只帶資料率、調變、bit 數下限三項。ODT、驅動強度、Corner、Port 是使用者的
// 設計選擇，分析引擎由兩端模型決定，眼罩門檻不內建——
// 這幾項這裡一律不碰。

export interface EyePreset {
  id: string
  family: string
  label: string
  label_en?: string
  note?: string
  note_en?: string
  /** 位元率 Gb/s（DDR 也是 Gb/s，例如 3.2）。停用列可能是 null。 */
  rate_gbps: number | null
  baud_gbd?: number | null
  ui_ps?: number | null
  modulation: 'NRZ' | 'PAM4' | null
  encoding?: string
  signaling?: 'single' | 'diff' | null
  /** AMI 路徑的 bit 數下限；標準 IBIS 列是 null（用工具預設）。 */
  min_bits: number | null
  needs_ami: boolean
  supported: boolean
  unsupported_reason?: string
  unsupported_reason_en?: string
  compliance_hint?: string | null
  compliance_note?: string
  compliance_note_en?: string
  analysis_note?: string
  analysis_note_en?: string
  source?: string
}

export interface PresetResponse {
  presets: EyePreset[]
  /** 多埠變體漏斗認得的世代（後端 multi_lane.TECHNOLOGIES）。 */
  technologies?: string[]
  min_bits_basis?: string
  min_bits_basis_en?: string
}

/** 精靈第 2 步受預設影響的三個欄位。 */
export interface PresetFields {
  dataRate: string
  modulation: string
  bitCount: number
}

export interface PresetOverride {
  field: 'data_rate_gbps' | 'modulation' | 'bit_count'
  preset_value: number | string
  value: number | string | null
}

/** 選了某個規範之後三個欄位的值。bit 數只往上拉到下限，使用者已設更多就不動。 */
export function applyPreset(preset: EyePreset | null, current: PresetFields): PresetFields {
  if (!preset || !preset.supported) return { ...current }
  return {
    dataRate: preset.rate_gbps !== null && preset.rate_gbps !== undefined
      ? String(preset.rate_gbps) : current.dataRate,
    modulation: preset.modulation || current.modulation,
    bitCount: preset.min_bits ? Math.max(Number(current.bitCount) || 0, preset.min_bits)
      : current.bitCount,
  }
}

const sameRate = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))

/** 使用者改過、和規範值不同的欄位。bit 數高於下限不算（下限本來就只是下限）。 */
export function presetOverrides(preset: EyePreset | null, current: PresetFields): PresetOverride[] {
  if (!preset || !preset.supported) return []
  const out: PresetOverride[] = []
  if (preset.rate_gbps !== null && preset.rate_gbps !== undefined) {
    const value = String(current.dataRate).trim() === '' ? null : Number(current.dataRate)
    if (value === null || !Number.isFinite(value) || !sameRate(value, preset.rate_gbps)) {
      out.push({ field: 'data_rate_gbps', preset_value: preset.rate_gbps,
        value: value !== null && Number.isFinite(value) ? value : null })
    }
  }
  if (preset.modulation && current.modulation !== preset.modulation) {
    out.push({ field: 'modulation', preset_value: preset.modulation, value: current.modulation })
  }
  if (preset.min_bits && Number(current.bitCount) < preset.min_bits) {
    out.push({ field: 'bit_count', preset_value: preset.min_bits, value: Number(current.bitCount) })
  }
  return out
}

/** 寫進 selection_basis.preset：用了哪個規範、哪些欄位被改掉（報告可追溯）。 */
export function presetBasis(preset: EyePreset | null, current: PresetFields):
  { id: string; label: string; source: string; overrides: PresetOverride[] } | null {
  if (!preset) return null
  return { id: preset.id, label: preset.label, source: preset.source || '',
    overrides: presetOverrides(preset, current) }
}

/** 規範與兩端模型種類不一致時要警告，但不改引擎（引擎由模型決定）。 */
export function presetEngineWarning(preset: EyePreset | null, engine: string | null):
  'needsAmi' | 'needsIbis' | null {
  if (!preset || !preset.supported) return null
  if (preset.needs_ami && engine === 'ibis') return 'needsAmi'
  if (!preset.needs_ami && engine === 'ami') return 'needsIbis'
  return null
}

/** 依 family 分組，組與組內都保持後端給的順序。 */
export function groupPresets(presets: EyePreset[]): { family: string; items: EyePreset[] }[] {
  const groups: { family: string; items: EyePreset[] }[] = []
  for (const item of presets || []) {
    let group = groups.find(g => g.family === item.family)
    if (!group) { group = { family: item.family, items: [] }; groups.push(group) }
    group.items.push(item)
  }
  return groups
}

export function findPreset(response: PresetResponse | null | undefined, id: string): EyePreset | null {
  return (response?.presets || []).find(item => item.id === id) || null
}
