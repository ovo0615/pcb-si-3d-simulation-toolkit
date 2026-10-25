import { useEffect, useState } from 'react'
import { backendAvailable, backendUnavailableText, BACKEND_CONNECTION_EVENT } from '../backendConnection'
import { useT } from '../i18n'

/** 常駐提示，讓已停掉後端的瀏覽器分頁仍能說明如何重新開啟。 */
export default function BackendConnectionBanner() {
  const { lang } = useT()
  const [available, setAvailable] = useState(backendAvailable)
  useEffect(() => {
    const update = () => setAvailable(backendAvailable())
    window.addEventListener(BACKEND_CONNECTION_EVENT, update)
    update()
    return () => window.removeEventListener(BACKEND_CONNECTION_EVENT, update)
  }, [])
  if (available) return null
  return <div role="alert" className="status status--err" style={{
    position: 'sticky', top: 0, zIndex: 1000, margin: 8, padding: '10px 14px',
    fontFamily: 'Calibri, "Microsoft JhengHei", sans-serif',
  }}>{backendUnavailableText(lang)}</div>
}
