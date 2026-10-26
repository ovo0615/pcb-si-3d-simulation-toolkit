/** 模擬輸入僅保留規範與最高頻率；設定檔只重用這兩項。 */
import type { Messages } from '../i18n/zh-TW'
interface Props {
  lang: string
  text: Messages['simulationSetup']
  specName: string
  maxFrequencyGHz: string
  specs: { name: string; label?: string; label_en?: string }[]
  profiles: string[]
  selectedProfile: string
  message: string
  error: string
  summary: string
  onSpec: (name: string) => void
  onMaximum: (value: string) => void
  onProfile: (name: string) => void
  onApply: () => void
  onSave: () => void
  onDelete: () => void
}

export default function SimulationSettings(p: Props) {
  const en = p.lang === 'en'
  const specLabel = p.text.spec
  const maxLabel = p.text.maximum
  const profileLabel = p.text.profile
  return <section data-testid="simulation-settings" style={{ fontFamily: 'Calibri, "Microsoft JhengHei", sans-serif' }}>
    <div className="field-label">{specLabel}</div>
    <select className="input" aria-label={specLabel} value={p.specName}
      onChange={e => p.onSpec(e.target.value)}>
      <option value="">{p.text.custom}</option>
      {p.specs.map(s => <option key={s.name} value={s.name}>{en ? s.label_en || s.label : s.label || s.name}</option>)}
    </select>
    <div className="field-label" style={{ marginTop: 8 }}>{maxLabel}</div>
    <input className="input" aria-label={maxLabel} type="number" min="0.100000001" step="any"
      value={p.maxFrequencyGHz} onChange={e => p.onMaximum(e.target.value)} />
    {p.error && <p role="alert" className="hint" style={{ color: 'var(--danger)' }}>{p.error}</p>}
    {p.summary && <p className="panel-hint">{p.summary}</p>}
    <div className="field-label" style={{ marginTop: 8 }}>{profileLabel}</div>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <select className="input" style={{ flex: 1 }} aria-label={profileLabel} value={p.selectedProfile}
        onChange={e => p.onProfile(e.target.value)}>
        <option value="">{p.text.selectProfile}</option>
        {p.profiles.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <button className="btn" disabled={!p.selectedProfile} onClick={p.onApply}>{p.text.apply}</button>
      <button className="btn" disabled={!!p.error} onClick={p.onSave}>{p.text.save}</button>
      <button className="btn" disabled={!p.selectedProfile} onClick={p.onDelete}>{p.text.delete}</button>
    </div>
    {p.message && <p role="status" className="panel-hint">{p.message}</p>}
  </section>
}
