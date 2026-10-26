import { useEffect, useState } from 'react'
import { zhTW, type Messages } from '../i18n/zh-TW'
import { describeApiError } from '../apiError'

type LicenseStatus = {
  mode: string
  valid: boolean
  message?: string
  message_en?: string
  customer_display?: string
  license_id?: string
  expires?: string
  warnings?: string[]
  warnings_en?: string[]
}

export function ProductLicenseSection({ labels = zhTW.productLicense, lang = 'zh-TW' }: {
  labels?: Messages['productLicense'], lang?: string,
}) {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [unlockBusy, setUnlockBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const refresh = async () => {
    const response = await fetch('/api/product-license/status')
    if (!response.ok) throw new Error(labels.loadError)
    setStatus(await response.json())
  }
  useEffect(() => {
    setError('')
    void refresh().catch(reason => setError(String(reason.message || reason)))
  }, [lang])

  // 授權檔與  時鐘解鎖檔共用同一套上傳流程，但送到不同端點，後端也會互相拒收。
  const upload = (endpoint: string, setRunning: (running: boolean) => void,
    done?: (answer: { high_water?: string }) => string) =>
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      setRunning(true)
      setError('')
      setNotice('')
      try {
        if (file.size > 24576) throw new Error(labels.oversized)
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await file.text(),
        })
        const answer = await response.json()
        if (!response.ok) throw new Error(describeApiError(answer, response, lang === 'en' ? 'en' : 'zh-TW'))
        if (done) setNotice(done(answer))
        await refresh()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setRunning(false)
      }
    }
  const importFile = upload('/api/product-license/import', setBusy)
  const importUnlock = upload('/api/product-license/unlock', setUnlockBusy,
    answer => labels.unlockDone(answer.high_water || ''))

  return <section aria-label={labels.title} style={{ marginBottom: 16, padding: 12,
    border: '1px solid var(--border, #536174)', borderRadius: 6,
    fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif' }}>
    <h4 style={{ margin: '0 0 8px' }}>{labels.title}</h4>
    <p>{status?.customer_display
      ? labels.identity(status.customer_display, status.license_id || '', status.expires || '')
      : (lang === 'en' ? status?.message_en : status?.message) || labels.loading}</p>
    <p>{labels.continuity}</p>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <a className="btn" href="/api/product-license/request" download="pcbsi-license-request.json">{labels.exportRequest}</a>
      <label className="btn">{busy ? labels.importing : labels.browseImport}
        <input aria-label={labels.browse} type="file" accept=".json,application/json"
          disabled={busy} onChange={importFile} style={{ display: 'block', maxWidth: 270 }} />
      </label>
    </div>
    <p>{labels.unlockHint}</p>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <a className="btn" href="/api/product-license/unlock-request" download="pcbsi-clock-unlock-request.json">{labels.exportUnlockRequest}</a>
      <label className="btn">{unlockBusy ? labels.unlocking : labels.unlockImport}
        <input aria-label={labels.browseUnlock} type="file" accept=".json,application/json"
          disabled={unlockBusy} onChange={importUnlock} style={{ display: 'block', maxWidth: 270 }} />
      </label>
    </div>
    {(lang === 'en' ? status?.warnings_en : status?.warnings)?.map(warning => <p key={warning}>{warning}</p>)}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" style={{ color: 'var(--warn, #ffca80)' }}>{error}</p>}
  </section>
}
