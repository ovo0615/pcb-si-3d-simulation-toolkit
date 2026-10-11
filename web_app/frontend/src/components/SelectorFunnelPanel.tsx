// 多埠第三步的變體漏斗。物理方向仍由完整匯流排判定，不拆獨立單道。
import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { errorText } from '../backendFields'
import { currentFunnel, funnelRows } from '../eyeWizard'
import type { Funnel } from '../eyeWizard'
import { selectorSelection, selectorSignature } from '../selectorFunnelSelection'
import type { SelectorChange, SelectorInput } from '../selectorFunnelSelection'

export interface SelectorChoice {
  side: number
  selector: string
  component: string
  role: 'driver' | 'receiver' | 'unknown'
  variants: { name: string; description: string }[]
  direct_model?: string
  tx?: { selected: string }
  rx?: { selected: string }
}

export interface SelectorFunnelPanelProps {
  choice: SelectorChoice
  packageId: string
  dataRateGbps: number
  driving: boolean | null
  odtOhm: number | null
  driveOhm: number | null
  technology?: string
  onChange: (change: SelectorChange) => void
}

export default function SelectorFunnelPanel(props: SelectorFunnelPanelProps) {
  const { t: all, lang } = useT()
  const t = all.eyeWizard
  const input: SelectorInput = {
    packageId: props.packageId, selector: props.choice.selector, side: props.choice.side,
    dataRateGbps: props.dataRateGbps, driving: props.driving,
    odtOhm: props.odtOhm, driveOhm: props.driveOhm,
    technology: props.technology,
    directModel: props.choice.direct_model || '',
  }
  const signature = selectorSignature(input)
  const [check, setCheck] = useState<{ signature: string; data: Funnel } | null>(null)
  const [error, setError] = useState('')
  const [override, setOverride] = useState(false)
  const [model, setModel] = useState('')
  const [reason, setReason] = useState('')
  const [pick, setPick] = useState('')
  const callback = useRef(props.onChange)
  callback.current = props.onChange
  const lastEmission = useRef('')
  const funnel = currentFunnel(check, signature)
  // 直接模型完全沿用後端 Model_type 的角色判定，不用 selector 名字猜模型。
  const directModel = props.choice.direct_model
    ? (props.driving === true ? props.choice.tx?.selected : props.driving === false ? props.choice.rx?.selected : '') || ''
    : undefined
  const selection = selectorSelection(input, check, { enabled: override, model, reason, pick }, directModel)
  const selectedSignature = JSON.stringify(selection)

  useEffect(() => {
    if (lastEmission.current !== selectedSignature) {
      lastEmission.current = selectedSignature
      callback.current(selection)
    }
  }, [selectedSignature])

  useEffect(() => {
    setCheck(null); setError(''); setPick('')
    if (props.choice.direct_model || !input.packageId || input.driving === null || !(input.dataRateGbps > 0)) return
    let alive = true
    fetch(`/api/models/${encodeURIComponent(input.packageId)}/selector-funnel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: input.selector, data_rate_gbps: input.dataRateGbps,
        driving: input.driving, odt_ohm: input.odtOhm, drive_ohm: input.driveOhm,
        technology: input.technology || null }),
    }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw Object.assign(new Error(data?.detail || t.funnelFailed), { detail_en: data?.detail_en })
      if (alive) setCheck({ signature, data })
    }).catch(exc => { if (alive) setError(errorText(exc, lang)) })
    return () => { alive = false }
  }, [signature, props.choice.direct_model])

  // 換套件或 selector 後不能保留另一份模型的覆寫。
  useEffect(() => { setOverride(false); setModel(''); setReason(''); setPick('') },
    [props.packageId, props.choice.selector])

  const answer = (field: 'odtOhm' | 'driveOhm', value: string) => {
    const changed = { ...input, [field]: value === '' ? null : Number(value) }
    callback.current(selectorSelection(changed, null, { enabled: override, model, reason, pick: '' }))
  }
  return <div className="eye-wizard__funnel">
    <h4>{props.choice.selector}{props.choice.component ? ` · ${props.choice.component}` : ''}</h4>
    {error && <p className="error">{error}</p>}
    {props.driving === null && <p className="hint">{t.needDirectionStep4}</p>}
    {funnel && <>
      <strong>{t.funnelTitle(funnel.total)}</strong>
      <ol>{funnelRows(funnel, t).map(row => <li key={row.key} className={row.ask ? 'is-user' : 'is-tool'}>
        <span>{row.label}</span><span>{row.decidedBy}</span>
        {row.ask ? <select className="input" aria-label={row.label} value={row.value ?? ''}
          onChange={e => answer(row.key === 'odt_ohm' ? 'odtOhm' : 'driveOhm', e.target.value)}>
          <option value="">{t.notAnswered}</option>
          {row.options.map(value => <option key={value} value={value}>{t.ohmValue(value)}</option>)}
        </select> : <span>{row.valueText}</span>}
        <span>{t.remaining(row.count)}</span>{row.note && <em className="hint">{row.note}</em>}
      </li>)}</ol>
      {funnel.remaining.length === 0 && <p className="warning">{t.noneLeft}</p>}
      {!funnel.selected && funnel.remaining.length > 1 && <>
        <p>{t.pickOne(funnel.remaining.length)}</p>
        {funnel.remaining.map(candidate => <button className="btn" key={candidate.name}
          title={candidate.description} onClick={() => setPick(candidate.name)}>{candidate.name}</button>)}
      </>}
    </>}
    {selection.model && <p><strong>{t.selected(selection.model)}</strong></p>}
    {!props.choice.direct_model && (!override ? <button className="btn--mini" onClick={() => setOverride(true)}>{t.override}</button>
      : <div className="eye-wizard__override">
        <label>{t.model}<select className="input" value={model} onChange={e => setModel(e.target.value)}>
          <option value="">{t.pleaseSelect}</option>
          {props.choice.variants.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
        </select></label>
        <label>{t.overrideReason}<input className="input" value={reason} onChange={e => setReason(e.target.value)} /></label>
        {!reason.trim() && <p className="warning">{t.missing.overrideReason}</p>}
        <button className="btn" onClick={() => { setOverride(false); setModel(''); setReason('') }}>{t.overrideCancel}</button>
      </div>)}
  </div>
}
