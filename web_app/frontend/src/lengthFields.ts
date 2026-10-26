// 輸入登錄表：包含收起面板的草稿；整批準備成功後才更新任何欄位。
import { LengthDraft, type DisplayLengthUnit, type LengthLimits, type LengthSourceUnit } from './lengthUnits'

export interface LengthFieldLimits extends LengthLimits { positive?: boolean }

interface Field {
  draft: LengthDraft
  source: LengthSourceUnit
  limits: LengthFieldLimits
  dirty: boolean
}
export interface LengthFieldSnapshot {
  value: string
  text: string
  source: LengthSourceUnit
  unit: DisplayLengthUnit
  limits: LengthFieldLimits
  dirty: boolean
}

export class LengthFields {
  private fields = new Map<string, Field>()
  constructor(public unit: DisplayLengthUnit, snapshot: Record<string, LengthFieldSnapshot> = {}) {
    for (const [key, saved] of Object.entries(snapshot || {})) {
      if (!saved || saved.unit !== unit || typeof saved.value !== 'string' || typeof saved.text !== 'string'
          || !['m', 'mm', 'mil', 'um'].includes(saved.source)) continue
      const limits: LengthFieldLimits = { optional: saved.limits?.optional === true, positive: saved.limits?.positive === true }
      if (typeof saved.limits?.min === 'number' && Number.isFinite(saved.limits.min)) limits.min = saved.limits.min
      if (typeof saved.limits?.max === 'number' && Number.isFinite(saved.limits.max)) limits.max = saved.limits.max
      try {
        const draft = new LengthDraft(saved.value, saved.source, unit, limits)
        if (saved.dirty) draft.edit(saved.text)
        this.fields.set(key, { draft, source: saved.source, limits, dirty: saved.dirty === true })
      } catch { /* 損壞的展示草稿不改寫舊來源欄位。 */ }
    }
  }

  snapshot(): Record<string, LengthFieldSnapshot> {
    return Object.fromEntries([...this.fields].map(([key, field]) => [key, {
      value: field.draft.value, text: field.draft.draft, unit: this.unit,
      source: field.source, limits: field.limits, dirty: field.dirty,
    }]))
  }

  field(key: string, value: string, source: LengthSourceUnit, limits: LengthFieldLimits = {}): LengthDraft {
    const old = this.fields.get(key)
    // 外部 profile／session／預設更新仍以原來源單位解讀。
    if (!old || old.draft.value !== value || old.source !== source) {
      this.fields.set(key, { draft: new LengthDraft(value, source, this.unit, limits), source, limits, dirty: false })
    } else if (old.limits.min !== limits.min || old.limits.max !== limits.max
        || !!old.limits.optional !== !!limits.optional || !!old.limits.positive !== !!limits.positive) {
      const draft = new LengthDraft(value, source, this.unit, limits)
      if (old.dirty) draft.edit(old.draft.draft)
      this.fields.set(key, { ...old, draft, limits })
    }
    return this.get(key)
  }
  get(key: string): LengthDraft { return this.fields.get(key)!.draft }
  /** 僅供明確載入預設／profile；一般重繪與卸載不呼叫。 */
  reset(values: Record<string, string>): void {
    for (const [key, value] of Object.entries(values)) {
      const old = this.fields.get(key)
      if (!old) continue
      this.fields.set(key, { ...old, draft: new LengthDraft(value, old.source, this.unit, old.limits), dirty: false })
    }
  }
  edit(key: string, text: string): void {
    const field = this.fields.get(key)!
    field.draft.edit(text)
    field.dirty = true
  }
  commit(key: string) {
    const field = this.fields.get(key)!
    if (field.limits.positive && Number(field.draft.draft) <= 0) return { ok: false, reason: 'range' } as const
    const result = field.draft.commit()
    if (result.ok) field.dirty = false
    return result
  }
  switchUnit(unit: DisplayLengthUnit): string | null {
    const prepared = new Map<string, Field>()
    for (const [key, field] of this.fields) {
      const copy = new LengthDraft(field.draft.value, field.source, this.unit, field.limits)
      if (field.dirty) copy.edit(field.draft.draft)
      if (!copy.switchUnit(unit).ok) return key
      if (field.limits.positive && !(Number(copy.value) > 0)) return key
      prepared.set(key, { ...field, draft: copy, dirty: false })
    }
    this.fields = prepared
    this.unit = unit
    return null
  }
  /** 檢查目前草稿，不為送出或背景重繪重新換算 canonical 值。 */
  invalid(): string | null {
    for (const [key, field] of this.fields) {
      const copy = new LengthDraft(field.draft.value, field.source, this.unit, field.limits)
      if (field.dirty) copy.edit(field.draft.draft)
      if (!copy.commit().ok) return key
      if (field.limits.positive && !(Number(copy.value) > 0)) return key
    }
    return null
  }
}
