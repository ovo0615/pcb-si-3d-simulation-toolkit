// 「求解核心數」輸入：HFSS／SIwave 排程與遠端求解包共用。
// 上限取後端回報的本機核心數；超過時照實說明本機會怎麼下修，不默默改值。
import type { Messages } from '../i18n/zh-TW'
import { parseSolverCores } from '../solverCores'

export function SolverCoresField({ value, onChange, availableCores, text, disabled }: {
  value: string
  onChange: (next: string) => void
  /** /api/system/solver_resources 的 available_cores；還沒拿到時不設上限。 */
  availableCores?: number | null
  text: Messages['solverCores']
  disabled?: boolean
}) {
  const cores = parseSolverCores(value)
  const limit = availableCores && availableCores > 0 ? availableCores : undefined
  return (
    <div style={{ marginTop: 6 }}>
      <div className="field-row" style={{ alignItems: 'center', gap: 6 }}>
        <label className="field-label" htmlFor="solver-cores" style={{ margin: 0 }}>{text.label}</label>
        <input id="solver-cores" aria-label={text.label} className="input" type="number"
          min={1} max={limit} step={1} inputMode="numeric" style={{ width: 80 }}
          value={value} disabled={disabled}
          aria-invalid={cores === null}
          onChange={e => onChange(e.target.value)} />
      </div>
      <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>{text.hint}</div>
      {cores === null && (
        <div className="status status--err" role="alert" style={{ marginTop: 3, fontSize: 11 }}>{text.invalid}</div>
      )}
      {cores !== null && limit !== undefined && cores > limit && (
        <div className="panel-hint" style={{ marginTop: 3, fontSize: 11, color: 'var(--warn)' }}>{text.aboveMachine(limit)}</div>
      )}
    </div>
  )
}
