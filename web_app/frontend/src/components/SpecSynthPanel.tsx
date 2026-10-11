// 「產生規格模型」的第二種方法：本工具合成（#0116，ADR-0069）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 和左邊的「SPISim 產生」並列，使用者自己選方法。參數全部來自後端的規範表
// （每個值附出處）；待確認的欄位標紅、要使用者自己填，不替他猜。
// 合成不用 Ansys 授權，所以這裡沒有授權探測。
import { useEffect, useMemo, useState } from 'react'
import { useT } from '../i18n'
import type { Lang, Messages } from '../i18n'
import { pickList, pickText } from '../backendFields'
import { generateSynthBody, specModelInfo, synthMissingInputs } from '../specModel'
import type { SynthForm, SynthRoleChoice } from '../specModel'

type AnyRecord = Record<string, any>
type Notice = (t: Messages, lang: Lang) => string

interface Props {
  request: <T>(path: string, options?: RequestInit) => Promise<T>
  errorOf: (reason: unknown, lang: Lang) => string
  disabled: boolean
  onImported: () => Promise<void> | void
}

const listText = (value: unknown): string =>
  Array.isArray(value) ? value.map(v => String(v)).join(' / ') : value == null ? '' : String(value)

export default function SpecSynthPanel({ request, errorOf, disabled, onImported }: Props) {
  const { t: all, lang } = useT()
  const t = all.library
  const [specs, setSpecs] = useState<AnyRecord | null>(null)
  const [form, setForm] = useState<SynthForm>({ family: '', roles: 'both', rate: '', ccomp: '', slewMin: '', slewMax: '', overrides: {} })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: Notice; error: boolean } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const data = await request<AnyRecord>('/api/models/synth-specs')
        setSpecs(data)
        const first = data.families?.find((item: AnyRecord) => item.id === 'ddr5') || data.families?.[0]
        if (first) setForm(prev => ({ ...prev, family: first.id }))
      } catch { /* 舊後端沒有這個端點：整塊不顯示 */ }
    })()
  }, [request])

  const family = useMemo(() => specs?.families?.find((item: AnyRecord) => item.id === form.family) || null,
    [specs, form.family])
  const missing = synthMissingInputs(family, form)
  const paramName = (key: string) => t.synthParamNames[key] || key

  if (!specs?.families?.length) return null

  const generate = async () => {
    const body = generateSynthBody(form)
    if (!body) return
    setBusy(true); setNotice(null)
    try {
      const data = await request<AnyRecord>('/api/models/generate-synth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const packages: AnyRecord[] = data.packages || []
      setNotice({ error: false, text: (_t, _lang) => [
        _t.library.generatedImported(packages.map(p => p.display_name).join(_t.library.listSeparator),
          pickList(data, 'notes', _lang).join(' ')),
        ...packages.map(p => {
          const info = specModelInfo(p, _lang)
          return info?.ccomp ? _t.library.spisimGeneratedCcomp(p.display_name, _t.library.ccompLevel[info.ccomp.level]) : ''
        }),
      ].filter(Boolean).join('\n') })
      await onImported()
    } catch (exc) {
      setNotice({ error: true, text: (_t, _lang) => _t.library.generateFailed + errorOf(exc, _lang) })
    } finally { setBusy(false) }
  }

  const params: AnyRecord = family?.params || {}
  const set = (key: keyof SynthForm) => (event: { target: { value: string } }) =>
    setForm(prev => ({ ...prev, [key]: event.target.value }))
  const placeholder = (key: string) => {
    const item = params[key]
    return item?.status === 'confirmed' ? listText(item.value) : t.synthUnconfirmed
  }

  return (
    <div className="model-library__gen-card model-library__gen-card--synth">
      <strong className="model-library__gen-title">{t.specMethodSynth}</strong>
      <p className="model-library__hint">{t.specMethodSynthHint}</p>
      <div className="model-library__spec-filter">
        <label>{t.synthFamily}
          <select className="input" value={form.family} onChange={e => setForm(prev => ({ ...prev, family: e.target.value, overrides: {} }))}>
            {specs.families.map((item: AnyRecord) => (
              <option key={item.id} value={item.id}>
                {t.synthFamilyOption(lang === 'en' ? item.label_en : item.label, item.io_standard || '')}
              </option>
            ))}
          </select>
        </label>
        <label>{t.synthRoles}
          <select className="input" value={form.roles}
            onChange={e => setForm(prev => ({ ...prev, roles: e.target.value as SynthRoleChoice }))}>
            {(['both', 'tx', 'rx'] as const).map(role => <option key={role} value={role}>{t.synthRoleNames[role]}</option>)}
          </select>
        </label>
        <label>{t.synthRate}
          <input className="input" type="number" min="0" step="0.1" value={form.rate}
            placeholder={family?.preset_rate_gbps ? String(family.preset_rate_gbps) : ''} onChange={set('rate')} />
        </label>
        <label className={missing.includes('c_io_pf') ? 'is-missing' : ''}>{t.synthCcomp}
          <input className="input" type="number" min="0" step="0.05" value={form.ccomp}
            placeholder={placeholder('c_io_pf')} onChange={set('ccomp')} />
        </label>
        {form.roles !== 'rx' && <>
          <label className={missing.includes('slew_v_per_ns') ? 'is-missing' : ''}>{t.synthSlewMin}
            <input className="input" type="number" min="0" step="0.5" value={form.slewMin}
              placeholder={placeholder('slew_v_per_ns')} onChange={set('slewMin')} />
          </label>
          <label className={missing.includes('slew_v_per_ns') ? 'is-missing' : ''}>{t.synthSlewMax}
            <input className="input" type="number" min="0" step="0.5" value={form.slewMax}
              placeholder={placeholder('slew_v_per_ns')} onChange={set('slewMax')} />
          </label>
        </>}
      </div>
      {family && <p className="model-library__hint">
        {t.synthModels(listText(params.ron_options?.value), listText(params.odt_options?.value))}</p>}
      {family?.no_dfe_rx && form.roles !== 'tx' && <p className="model-library__hint is-warning">{t.synthNoDfe}</p>}
      {family?.spisim_template_vcc && <p className="model-library__hint">
        {t.synthAlsoSpisim(String(family.spisim_template_vcc))}</p>}
      {missing.length > 0 && <p className="model-library__hint is-warning">
        {t.synthMissing(missing.map(paramName).join(t.listSeparator))}</p>}
      {family && <details className="model-library__synth-params" open={missing.length > 0}>
        <summary>{family.jedec_doc ? t.synthParamsTitleDoc(family.jedec_doc) : t.synthParamsTitle}</summary>
        <table className="model-library__table">
          <thead><tr><th>{t.synthColParam}</th><th>{t.synthColValue}</th><th>{t.synthColSource}</th></tr></thead>
          <tbody>{Object.entries(params).map(([key, item]: [string, AnyRecord]) => (
            <tr key={key} className={item.status === 'confirmed' ? '' : 'is-unconfirmed'}>
              <td>{paramName(key)}</td>
              <td>{item.status === 'confirmed' ? listText(item.value) : (
                <input className={'input' + (missing.includes(key) ? ' is-missing' : '')}
                  aria-label={paramName(key)} placeholder={t.synthUnconfirmed}
                  value={form.overrides[key] || ''}
                  onChange={e => setForm(prev => ({ ...prev, overrides: { ...prev.overrides, [key]: e.target.value } }))} />)}</td>
              <td>{item.status === 'confirmed'
                ? [pickText(item, 'source', lang), pickText(item, 'note', lang)].filter(Boolean).join(' — ')
                : [t.synthUnconfirmed, pickText(item, 'note', lang)].filter(Boolean).join(' — ')}</td>
            </tr>))}
          </tbody>
        </table>
      </details>}
      <div className="model-library__spec-actions">
        <button className="btn btn--primary" disabled={disabled || busy || !family || missing.length > 0}
          onClick={() => void generate()}>{busy ? t.generating : t.synthGenerate}</button>
      </div>
      {pickText(specs, 'route_note', lang) && <p className="model-library__hint">{pickText(specs, 'route_note', lang)}</p>}
      {notice && <p className={'model-library__hint' + (notice.error ? ' is-warning' : '')}
        style={{ whiteSpace: 'pre-line' }}>{notice.text(all, lang)}</p>}
    </div>
  )
}
