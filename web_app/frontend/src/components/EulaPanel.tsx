import { useEffect, useState } from 'react'
import { LANG_NAMES, LANGS, useT } from '../i18n'
import type { Lang } from '../i18n'
import { describeApiError } from '../apiError'

type Terms = { version: string; sha256: string; copyright: string; texts: Record<Lang, string> }
type Acceptance = { eula_version: string; eula_sha256: string; accepted_at_utc: string }

/** 本機條款檢視與明確同意；不代表公司代表簽署，也不啟動授權。 */
export default function EulaPanel() {
  const { t, lang } = useT()
  const p = t.eula
  const [terms, setTerms] = useState<Terms | null>(null)
  const [records, setRecords] = useState<Acceptance[]>([])
  const [language, setLanguage] = useState<Lang>(lang)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState({ representative: '', customer_display: '', license_id: '', order_reference: '' })
  async function request(url: string, body?: unknown) {
    const response = await fetch(url, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { throw new Error(p.httpFailure(response.status)) }
    if (!response.ok) throw new Error(describeApiError(data, response, lang))
    return data
  }
  useEffect(() => {
    let active = true
    void Promise.all([request('/api/eula'), request('/api/eula/acceptance')]).then(([document, history]) => {
      if (active) { setTerms(document); setRecords(history.records) }
    }).catch(e => { if (active) setError(String(e.message || e)) })
    return () => { active = false }
  }, [])
  const accepted = terms && records.find(r => r.eula_version === terms.version && r.eula_sha256 === terms.sha256)
  async function accept() {
    if (!checked || !terms || busy) return
    setBusy(true)
    setError('')
    try {
      await request('/api/eula/acceptance', { accepted: true, version: terms.version, sha256: terms.sha256, language,
        ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])) })
      const history = await request('/api/eula/acceptance')
      setRecords(history.records)
      setChecked(false)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section aria-label={p.title} style={{ fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif' }}>
    <h2>{p.title}</h2>
    <p>{p.signatureNotice}</p>
    {error && <p role="alert">{error}</p>}
    {!terms && !error && <p>{p.loading}</p>}
    {terms && <>
      <p>{terms.copyright}</p>
      <p>{p.version}{p.separator}{terms.version}</p>
      <p style={{ overflowWrap: 'anywhere' }}>SHA-256{p.separator}<code>{terms.sha256}</code></p>
      <a href="/api/eula/document" download>{p.download}</a>
      <label style={{ display: 'block', marginTop: 12 }}>{p.language} <select aria-label={p.language} value={language}
        onChange={e => { setLanguage(e.target.value as Lang); setChecked(false) }}>
        {LANGS.map(key => <option key={key} value={key}>{LANG_NAMES[key]}</option>)}
      </select></label>
      <pre lang={language} style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', fontFamily: 'inherit', border: '1px solid #617080', padding: 12 }}>{terms.texts[language]}</pre>
      <p>{p.optionalNotice}</p>
      {(Object.keys(fields) as (keyof typeof fields)[]).map(key => <label key={key} style={{ display: 'block', margin: '8px 0' }}>
        {p[key]} <input aria-label={p[key]} value={fields[key]} onChange={e => setFields({ ...fields, [key]: e.target.value })} />
      </label>)}
      <label style={{ display: 'block', margin: '12px 0' }}><input type="checkbox" checked={checked} disabled={busy}
        onChange={e => setChecked(e.target.checked)} /> {p.consent}</label>
      <button type="button" disabled={!checked || busy} onClick={() => void accept()}>{busy ? p.saving : p.save}</button>
      <p role="status">{accepted ? `${p.recorded}${p.separator}${accepted.accepted_at_utc}` : p.notRecorded}</p>
    </>}
  </section>
}
