import { useState } from 'react'
import { useT } from '../i18n'

/** 只在使用者選擇後打包；不自動上傳。AEDT 傾印含程序記憶體，預設不收、要另外勾選。 */
export default function SupportBundleDialog({ onCreate, onClose }: { onCreate: (plaintextReview: boolean, includeAedtDumps: boolean) => void; onClose: () => void }) {
  const { t } = useT()
  const p = t.publicUi.support
  const [includeDumps, setIncludeDumps] = useState(false)
  return <div style={{ position: 'fixed', inset: 0, zIndex: 10030, display: 'grid', placeItems: 'center', background: 'rgba(12,20,32,0.65)' }}>
    <section role="dialog" aria-modal="true" aria-label={p.title}
      style={{ width: 'min(640px, calc(100vw - 40px))', padding: 20, borderRadius: 8, background: 'var(--panel-solid, #1b2433)', color: 'var(--text, #e6edf3)', fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif' }}>
    <h2>{p.title}</h2>
    <p>{p.contents}</p>
    <p>{p.excludes}</p>
    <p>{p.localOnly}</p>
    <p>{p.reviewNotice}</p>
    <p>{p.reviewContents}</p>
    <label style={{ display: 'block', margin: '8px 0' }}>
      <input type="checkbox" checked={includeDumps} onChange={e => setIncludeDumps(e.target.checked)} /> {p.includeDumps}
    </label>
    <p style={{ fontSize: '0.9em', opacity: 0.85 }}>{p.dumpRisk}</p>
    <button className="btn btn--primary" onClick={() => onCreate(false, includeDumps)}>{p.encrypted}</button>
    <button className="btn" onClick={() => onCreate(true, includeDumps)}>{p.plaintext}</button>
    <button className="btn" onClick={onClose}>{p.cancel}</button>
  </section></div>
}
