import { createContext, useContext, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { LengthFields, type LengthFieldSnapshot, type LengthFieldLimits } from './lengthFields'
import { convertLength, displayLengthPreference, formatLength, type DisplayLengthUnit, type LengthSourceUnit } from './lengthUnits'
import { useSessionState } from './useSessionState'
import { useT } from './i18n'

interface LengthContextValue {
  unit: DisplayLengthUnit
  fields: LengthFields
  refresh: () => void
  change: (unit: DisplayLengthUnit) => void
  error: string
  valid: () => boolean
  reset: (values: Record<string, string>) => void
}
const LengthContext = createContext<LengthContextValue | null>(null)

export function LengthUnitProvider({ children }: { children: ReactNode }) {
  const [savedUnit, saveUnit] = useSessionState('displayLengthUnit', 'mm')
  const unit = displayLengthPreference(savedUnit)
  const [savedDrafts, saveDrafts] = useSessionState<Record<string, LengthFieldSnapshot>>('lengthInputDrafts', {})
  const fieldsRef = useRef<LengthFields>()
  if (!fieldsRef.current) fieldsRef.current = new LengthFields(unit, savedDrafts)
  const fields = fieldsRef.current
  const [, redraw] = useState(0)
  const [error, setError] = useState('')
  const refresh = () => { saveDrafts(fields.snapshot()); redraw(v => v + 1) }
  const change = (next: DisplayLengthUnit) => {
    const invalid = fields.switchUnit(next)
    setError(invalid || '')
    if (!invalid) { saveUnit(next); refresh() }
  }
  useEffect(() => {
    if (unit !== fields.unit) {
      const invalid = fields.switchUnit(unit)
      if (invalid) { saveUnit(fields.unit); setError(invalid) }
      refresh()
    }
  }, [unit, fields])
  return <LengthContext.Provider value={{ unit: fields.unit, fields, refresh, change, error,
    reset: values => { fields.reset(values); setError(''); refresh() },
    valid: () => { const invalid = fields.invalid(); setError(invalid || ''); return !invalid } }}>
    {children}
  </LengthContext.Provider>
}

/** 收納工作明確覆蓋單位，不會訂閱產生途中改變的偏好。 */
export function LengthUnitScope({ unit, children }: { unit: DisplayLengthUnit; children: ReactNode }) {
  const fields = useRef(new LengthFields(unit)).current
  return <LengthContext.Provider value={{ unit, fields, refresh: () => {}, change: () => {}, error: '', valid: () => true, reset: () => {} }}>
    {children}
  </LengthContext.Provider>
}

export function useLengthUnit(explicit?: DisplayLengthUnit) {
  const context = useContext(LengthContext)
  const unit = explicit ?? context?.unit ?? 'mm'
  return { unit, length: (value: number, source: LengthSourceUnit = 'mm') => formatLength(value, source, unit),
    measure: (value: number, source: LengthSourceUnit = 'mm') => `${formatLength(value, source, unit)} ${unit}`,
    valid: context?.valid ?? (() => true), reset: context?.reset ?? (() => {}) }
}

/** App 擁有的來源欄位持續登錄；結果分頁尚未掛載時也要檢查草稿。 */
export function useLengthField(key: string, value: string, source: LengthSourceUnit, limits: LengthFieldLimits = {}) {
  const context = useContext(LengthContext)
  context?.fields.field(key, value, source, limits)
}

export function LengthUnitControl({ onSelect }: { onSelect?: () => void }) {
  const context = useContext(LengthContext)!
  const { t } = useT()
  return <>
    {(['mm', 'mil'] as const).map(unit => (
      <button key={unit}
        className={'menubar__entry' + (context.unit === unit ? ' menubar__entry--checked' : '')}
        role="menuitemradio" aria-checked={context.unit === unit}
        onClick={() => { context.change(unit); onSelect?.() }}>
        {unit === 'mm' ? t.lengthUi.menuMm : t.lengthUi.menuMil}
      </button>
    ))}
  </>
}

/** 選單關閉後仍顯示未完成欄位提示。 */
export function LengthUnitError() {
  const context = useContext(LengthContext)!
  const { t } = useT()
  const label = t.lengthUi.label
  const names: Record<string, string> = t.lengthUi.fields
  const field = names[context.error] ?? label
  return context.error ? <div role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>
    {t.lengthUi.invalidField(field)}
  </div> : null
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'step'> {
  fieldKey: string
  value: string
  source: LengthSourceUnit
  onValue: (value: string) => void
  min?: number
  max?: number
  step?: number
  showStepper?: boolean
  optional?: boolean
  positive?: boolean
}

/** text 避免 number input 把 '-'／'1e' 等未完成草稿先抹成空字串。 */
export function LengthInput({ fieldKey, value, source, onValue, min, max, step, showStepper, optional, positive, ...props }: Props) {
  const context = useContext(LengthContext)!
  const draft = context.fields.field(fieldKey, value, source, { min, max, optional, positive })
  const bound = (v: number | undefined) => v === undefined ? undefined : convertLength(v, source, context.unit)
  const accept = (text: string) => {
    context.fields.edit(fieldKey, text)
    const result = context.fields.commit(fieldKey)
    if (result.ok && result.value !== value) onValue(result.value)
    context.refresh()
  }
  const adjust = (direction: number) => {
    if (props.disabled || props.readOnly || step === undefined || context.fields.invalid()) return
    let next = Number(draft.value) + direction * step
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    accept(String(convertLength(next, source, context.unit)))
  }
  const input = <input {...props} type="text" inputMode="decimal" data-length-field={fieldKey}
    aria-invalid={context.fields.invalid() === fieldKey}
    data-length-unit={context.unit} min={bound(min)} max={bound(max)} step={bound(step)}
    value={draft.draft} onChange={event => accept(event.target.value)}
    onKeyDown={event => {
      props.onKeyDown?.(event)
      if (!props.disabled && step !== undefined && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        adjust(event.key === 'ArrowUp' ? 1 : -1)
      }
    }} />
  if (!showStepper || step === undefined) return input
  //  前此欄位使用原生 number spinner；保留文字草稿，以同位置的箭頭恢復微調。
  return <span className="length-input-stepper">
    {input}
    <span className="length-input-stepper__buttons">
      {([1, -1] as const).map(direction => {
        const label = `${props['aria-label'] ?? fieldKey} ${direction > 0 ? '+' : '-'}${step} ${source}`
        return <button key={direction} type="button" aria-label={label} title={label}
          disabled={props.disabled || props.readOnly || !!context.fields.invalid()}
          onClick={() => adjust(direction)}>{direction > 0 ? '▴' : '▾'}</button>
      })}
    </span>
  </span>
}
