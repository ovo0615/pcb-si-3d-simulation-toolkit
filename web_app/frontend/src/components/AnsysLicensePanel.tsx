// 「說明 → Ansys 授權對照」：全部功能需要哪些 Ansys 授權、目前可用幾個。
import { LICENSE_COLORS, licenseText, refreshLicenseStatus, useAnsysLicense } from '../ansysLicense'
import { useT } from '../i18n'
import { ProductLicenseSection } from './ProductLicenseSection'

export function AnsysLicensePanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useT()
  const p = t.licensePanel
  const { status, error, loading } = useAnsysLicense()
  const checked = status
    ? new Date(status.query.checked_at * 1000).toLocaleTimeString(lang) : ''
  const cell: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                                      verticalAlign: 'top', fontSize: 12 }
  const count = (free: number | null, issued: number | null) =>
    free !== null && issued !== null ? p.count(free, issued) : ''
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10020, background: 'rgba(12,20,32,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={p.dialogLabel}
        onClick={event => event.stopPropagation()}
        style={{ width: 'min(980px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 60px)', overflow: 'auto',
                 background: 'var(--panel-solid, #1b2433)', border: '1px solid rgba(255,255,255,0.15)',
                 borderRadius: 8, padding: 16, color: 'var(--text, #e6edf3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>{p.title}</h3>
          <button className="btn" disabled={loading} onClick={() => void refreshLicenseStatus(true)}>
            {loading ? p.querying : p.requery}
          </button>
          <button className="btn" onClick={onClose}>{p.close}</button>
        </div>
        <ProductLicenseSection labels={t.productLicense} lang={lang} />
        <div className="panel-hint" style={{ fontSize: 11.5, marginBottom: 8, lineHeight: 1.5 }}>
          {p.viewModeLead}<b>{p.viewMode}</b>{p.viewModeTail}
          <br />{p.usesLicense}
        </div>
        {error && (
          <div className="status status--warn" style={{ fontSize: 12 }}>
            {t.license.statusUnreadable(error)}
          </div>
        )}
        {status && (
          <div style={{ fontSize: 11.5, marginBottom: 8, color: status.query.status === 'ok'
            ? LICENSE_COLORS.available : LICENSE_COLORS.unknown }}>
            {status.query.status === 'ok'
              ? p.checkedAt(checked, status.cache_seconds)
              : p.unknown(licenseText(status.query, 'reason', lang))}
            {status.query.servers.map(server => (
              <div key={server.server} style={{ color: server.up ? LICENSE_COLORS.available : LICENSE_COLORS.unknown }}>
                {server.server}{p.fieldSep}
                {server.up ? p.reachable : p.unreachable(licenseText(server, 'error', lang))}
              </div>
            ))}
          </div>
        )}
        {status && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[p.colFunction, p.colProduct, p.colFeatures, p.colState].map(head => (
                  <th key={head} style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(status.functions).map(item => (
                <tr key={item.function}>
                  <td style={cell}>{licenseText(item, 'label', lang)}</td>
                  <td style={cell}>{licenseText(item, 'product', lang)}</td>
                  <td style={cell}>
                    {item.features.map(row => (
                      <div key={row.feature} style={{ color: LICENSE_COLORS[row.state] }}>
                        {row.feature}
                        {count(row.free, row.issued)}
                      </div>
                    ))}
                    {item.optional.length > 0 && (
                      <div style={{ opacity: 0.7, marginTop: 2 }}>
                        {p.optional}{item.optional.map(row =>
                          `${row.feature}${count(row.free, row.issued)}`).join(t.license.featureSep)}
                      </div>
                    )}
                  </td>
                  <td style={{ ...cell, color: LICENSE_COLORS[item.state] }}>
                    {item.state === 'available' ? p.stateAvailable
                      : item.state === 'unavailable' ? p.stateUnavailable : p.stateUnknown}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
