// 「說明 → Ansys 授權對照」：全部功能需要哪些 Ansys 授權、目前可用幾個（ADR-0062）。
import { LICENSE_COLORS, refreshLicenseStatus, useAnsysLicense, type LicenseState } from '../ansysLicense'

const STATE_TEXT: Record<LicenseState, string> = {
  available: '可用',
  unavailable: '目前沒有可用的',
  unknown: '無法確認',
}

export function AnsysLicensePanel({ onClose }: { onClose: () => void }) {
  const { status, error, loading } = useAnsysLicense()
  const checked = status ? new Date(status.query.checked_at * 1000).toLocaleTimeString() : ''
  const cell: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                                      verticalAlign: 'top', fontSize: 12 }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10020, background: 'rgba(12,20,32,0.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Ansys 授權對照"
        onClick={event => event.stopPropagation()}
        style={{ width: 'min(980px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 60px)', overflow: 'auto',
                 background: 'var(--panel-solid, #1b2433)', border: '1px solid rgba(255,255,255,0.15)',
                 borderRadius: 8, padding: 16, color: 'var(--text, #e6edf3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>Ansys 授權對照與目前可用數量</h3>
          <button className="btn" disabled={loading} onClick={() => void refreshLicenseStatus(true)}>
            {loading ? '查詢中…' : '重新查詢'}
          </button>
          <button className="btn" onClick={onClose}>關閉</button>
        </div>
        <div className="panel-hint" style={{ fontSize: 11.5, marginBottom: 8, lineHeight: 1.5 }}>
          看 S 參數、畫圖、匯出 Excel、看以前的結果、報告屬於<b>檢視模式</b>，不需要 Ansys 授權。
          <br />下表的功能會占 Ansys 授權；開工前先查，沒有空位的按鈕會變灰。
        </div>
        {error && <div className="status status--warn" style={{ fontSize: 12 }}>{error}</div>}
        {status && (
          <div style={{ fontSize: 11.5, marginBottom: 8, color: status.query.status === 'ok'
            ? LICENSE_COLORS.available : LICENSE_COLORS.unknown }}>
            {status.query.status === 'ok'
              ? `授權伺服器查詢時間 ${checked}（結果保留 ${status.cache_seconds} 秒）`
              : `無法確認授權：${status.query.reason}`}
            {status.query.servers.map(server => (
              <div key={server.server} style={{ color: server.up ? LICENSE_COLORS.available : LICENSE_COLORS.unknown }}>
                {server.server}：{server.up ? '可連線' : `連不上（${server.error}）`}
              </div>
            ))}
          </div>
        )}
        {status && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['功能', 'Ansys 產品', '需要的授權 feature（可用／總數）', '狀態'].map(head => (
                  <th key={head} style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(status.functions).map(item => (
                <tr key={item.function}>
                  <td style={cell}>{item.label}</td>
                  <td style={cell}>{item.product}</td>
                  <td style={cell}>
                    {item.features.map(row => (
                      <div key={row.feature} style={{ color: LICENSE_COLORS[row.state] }}>
                        {row.feature}
                        {row.free !== null && row.issued !== null ? `（${row.free}／${row.issued}）` : ''}
                      </div>
                    ))}
                    {item.optional.length > 0 && (
                      <div style={{ opacity: 0.7, marginTop: 2 }}>
                        選用（沒有也能跑）：{item.optional.map(row =>
                          `${row.feature}${row.free !== null && row.issued !== null ? `（${row.free}／${row.issued}）` : ''}`).join('、')}
                      </div>
                    )}
                  </td>
                  <td style={{ ...cell, color: LICENSE_COLORS[item.state] }}>
                    {STATE_TEXT[item.state]}
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
