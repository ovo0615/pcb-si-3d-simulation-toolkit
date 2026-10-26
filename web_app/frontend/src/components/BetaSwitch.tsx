import { useEffect, useState, useSyncExternalStore } from 'react'
import { betaEnabled, subscribeBeta, syncBeta, updateBeta } from '../betaSession'
import { useT } from '../i18n'

export function useBetaEnabled(): boolean {
  return useSyncExternalStore(subscribeBeta, betaEnabled)
}

export default function BetaSwitch() {
  const { t } = useT()
  const enabled = useBetaEnabled()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void syncBeta()
    const timer = window.setInterval(() => { void syncBeta() }, 2000)
    return () => window.clearInterval(timer)
  }, [])
  const toggle = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/feature-tiers/beta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      })
      if (!response.ok) throw new Error(t.featureTier.stateError)
      updateBeta((await response.json()).beta_enabled === true)
    } catch {
      setError(t.featureTier.stateError)
      await syncBeta()
    } finally { setBusy(false) }
  }
  return <div style={{ fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif' }}>
    <label><input type="checkbox" checked={enabled} disabled={busy} onChange={() => { void toggle() }} />
      {t.featureTier.enable}</label>
    <span style={{ marginLeft: 8, fontSize: 12 }}>{t.featureTier.sessionOnly}</span>
    {error && <span role="alert">{error}</span>}
  </div>
}
