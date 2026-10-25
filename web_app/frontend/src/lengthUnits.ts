// 長度顯示與既有 API 單位的邊界。幾何與求解輸入不因切換顯示而改變。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

export type LengthSourceUnit = 'm' | 'mm' | 'mil' | 'um'
export type DisplayLengthUnit = 'mm' | 'mil'

const mmPerUnit: Record<LengthSourceUnit, number> = { m: 1000, mm: 1, mil: 0.0254, um: 0.001 }

/** 僅在邊界換算；既有 *_mm、*_mil、*_um 的數字意義不變。 */
export function convertLength(value: number, from: LengthSourceUnit, to: LengthSourceUnit): number {
  if (!Number.isFinite(value) || !Object.prototype.hasOwnProperty.call(mmPerUnit, from)
      || !Object.prototype.hasOwnProperty.call(mmPerUnit, to)) {
    throw new RangeError('length.invalid')
  }
  const result = value * (mmPerUnit[from] / mmPerUnit[to])
  if (!Number.isFinite(result) || (value !== 0 && result === 0)) {
    throw new RangeError('length.range')
  }
  return result
}

/** 舊快照缺欄位或含未支援值時回到 mm，不重新解讀任何既有欄位。 */
export function displayLengthPreference(value: unknown): DisplayLengthUnit {
  return value === 'mil' ? 'mil' : 'mm'
}

/** 僅供文字呈現；不可拿此結果寫回模型或 API。 */
export function formatLength(value: number, from: LengthSourceUnit, to: DisplayLengthUnit): string {
  const converted = convertLength(value, from, to)
  const rounded = Number(converted.toFixed(to === 'mm' ? 4 : 3))
  return String(rounded === 0 && converted !== 0 ? Number(converted.toPrecision(6)) : rounded)
}

export type LengthCommit = { ok: true; value: string } | { ok: false; reason: 'invalid' | 'range' }
export interface LengthLimits {
  /** 界限沿用原欄位的來源單位；不因畫面單位改變。 */
  min?: number
  max?: number
  optional?: boolean
}

function parseDecimal(text: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) return null
  const value = Number(text)
  if (value === 0 && /[1-9]/.test(text.trim().split(/e/i)[0])) return null
  return Number.isFinite(value) ? value : null
}

/** 原始欄位單位與編輯草稿分離。元件需在 change／blur／切換前呼叫本介面。 */
export class LengthDraft {
  private accepted: string
  private text: string
  private display: DisplayLengthUnit
  private dirty = false

  constructor(value: string, readonly sourceUnit: LengthSourceUnit, unit: DisplayLengthUnit,
              private readonly limits: LengthLimits = {}) {
    this.accepted = value
    this.display = unit
    this.text = this.present()
  }

  get value(): string { return this.accepted }
  get draft(): string { return this.text }
  get unit(): DisplayLengthUnit { return this.display }

  edit(text: string): void {
    this.text = text
    this.dirty = true
  }

  commit(): LengthCommit {
    const result = this.validate()
    if (result.ok) {
      this.accepted = result.value
      this.dirty = false
    }
    return result
  }

  private validate(): LengthCommit {
    const text = this.dirty ? this.text : this.accepted
    if (text.trim() === '' && this.limits.optional) {
      return { ok: true, value: '' }
    }
    const value = parseDecimal(text)
    if (value === null) return { ok: false, reason: 'invalid' }
    let sourceValue: number
    try {
      sourceValue = convertLength(value, this.dirty ? this.display : this.sourceUnit, this.sourceUnit)
    } catch {
      return { ok: false, reason: 'invalid' }
    }
    for (const [bound, below] of [[this.limits.min, true], [this.limits.max, false]] as const) {
      if (bound === undefined || (below ? sourceValue >= bound : sourceValue <= bound)) continue
      // 只吸收換算產生的浮點尾差，不以固定絕對容差吞掉接近零的越界量。
      const tolerance = this.dirty && this.display !== this.sourceUnit
        ? 4 * Number.EPSILON * Math.max(Math.abs(sourceValue), Math.abs(bound)) : 0
      if (Math.abs(sourceValue - bound) > tolerance) return { ok: false, reason: 'range' }
      sourceValue = bound
    }
    return { ok: true, value: this.dirty ? String(sourceValue) : this.accepted }
  }

  private present(text = this.accepted, unit = this.display): string {
    const value = parseDecimal(text)
    if (value === null) return text
    return this.sourceUnit === unit ? text : String(convertLength(value, this.sourceUnit, unit))
  }

  switchUnit(unit: DisplayLengthUnit): LengthCommit {
    const result = this.validate()
    if (!result.ok) return result
    let text: string
    try {
      text = this.present(result.value, unit)
    } catch {
      return { ok: false, reason: 'invalid' }
    }
    // 先完成提交與目標單位的驗證；任一失敗都不改動原草稿、值或單位。
    this.accepted = result.value
    this.dirty = false
    this.display = unit
    this.text = text
    return { ok: true, value: this.accepted }
  }
}
