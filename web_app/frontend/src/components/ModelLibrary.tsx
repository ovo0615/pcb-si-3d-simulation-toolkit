// IBIS 模型與眼圖分析：模型管理、通道綁定與眼圖求解整合介面。
import { useEffect, useMemo, useState } from 'react'
import AmiChannelPanel from './AmiChannelPanel'
import MultiLaneWizard from './MultiLaneWizard'

type CompatibilityState = 'ready' | 'warning' | 'block'

interface NativeLibrary {
  file: string
  path: string
  format: string
  architecture: string
  sha256: string
  size_bytes: number
  scan_status: string
  trust_status: string
  scanned_at?: string
  trusted_at?: string
  scanner?: string
  message?: string
}

interface IbisModel {
  name: string
  model_type: string
}

export interface ModelPackage {
  package_id: string
  package_sha256: string
  display_name: string
  kind: 'ibis' | 'ibis_ami' | 'ami_fragment'
  created_at: string
  source_file: string
  managed_path: string
  files: { path: string; kind: string; sha256?: string; size_bytes?: number }[]
  ibis: null | {
    ibis_version: string
    file_revision: string
    manufacturer: string
    components: string[]
    models: IbisModel[]
    pins: { pin: string; signal: string; model: string }[]
    diff_pins: { pin: string; inverse_pin: string }[]
    algorithmic_models: {
      model: string
      platform: string
      library: string
      parameter_file: string
    }[]
  }
  ami: Record<string, {
    ami_version: string
    root_name: string
    getwave_exists: boolean
    init_returns_impulse: boolean
    parameter_count: number
    parameter_schema: AmiParameter[]
    editable_parameters: AmiParameter[]
    capabilities: AmiCapabilities
  }>
  native_libraries: NativeLibrary[]
  /** 後端讀取時計算：可當 Tx／Rx 的模型各有幾個。配對判定的依據。 */
  capabilities?: { tx_models: number; rx_models: number }
  ibis_checker: {
    available: boolean
    status: string
    version: string
    messages: string[]
  }
  compatibility: {
    status: CompatibilityState
    errors: string[]
    warnings: string[]
    target: string
    qualification: string
  }
  /** 匯入或遷移時自動修掉的機械性缺陷；修的是受管副本，來源檔不動。 */
  repairs?: { rule: string; detail: string; impact: string }[]
}

export interface AmiParameter {
  name: string
  path: string
  section: string
  usage: string
  type: string
  default: string
  values: string[]
  format: string
  choices: string[]
  minimum: string
  maximum: string
  description: string
  editable: boolean
  read_only: boolean
}

export interface AmiCapabilities {
  statistical: boolean
  getwave: boolean
  modulations: string[]
  pam4_declared: boolean
  pam4_evidence: string[]
  adaptive_behavior_evidence: string[]
}

interface LibraryResponse {
  library_path: string
  count: number
  packages: ModelPackage[]
}

interface BatchImportItem {
  path: string
  ok: boolean
  package_id?: string
  display_name?: string
  deduplicated?: boolean
  error?: string
}

interface BatchImportResponse {
  ok: boolean
  requested_count: number
  succeeded_count: number
  failed_count: number
  model_count: number
  models: ModelPackage[]
  items: BatchImportItem[]
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      message = body.detail || message
    } catch {
      // 保留 HTTP 狀態文字。
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

const statusText: Record<CompatibilityState, string> = {
  ready: '可使用', warning: '待確認', block: '已阻止',
}

const kindText: Record<ModelPackage['kind'], string> = {
  ibis: 'IBIS', ibis_ami: 'IBIS-AMI', ami_fragment: 'AMI 片段',
}

function shortHash(value: string): string {
  return value ? value.slice(0, 12) : '—'
}

function formatBytes(value = 0): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function apiErrorText(reason: unknown): string {
  if (reason instanceof TypeError && /failed to fetch|fetch failed/i.test(reason.message)) {
    return '無法連線到本機後端。請重新執行 web_app\\start.bat，並保持啟動視窗開啟。'
  }
  return reason instanceof Error ? reason.message : String(reason)
}

function parseImportPaths(value: string): string[] {
  const seen = new Set<string>()
  return value.split(/\r?\n/).map(item => item.trim()).filter(item => {
    const key = item.toLocaleLowerCase()
    if (!item || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const scanText: Record<string, string> = {
  pending: '尚未掃描',
  clean: '掃描正常',
  unavailable: '掃描器不可用',
  error: '掃描失敗',
}

const trustText: Record<string, string> = {
  pending: '尚未信任',
  trusted: '已信任',
}

export default function ModelLibrary() {
  // 只剩兩個面板。點對點與 AMI 兩條路徑（各自只吃 2／4 埠）已於 2026-08-19
  // 移除，理由見 ADR-0055。
  const [activePanel, setActivePanel] = useState<'library' | 'multilane' | 'ami'>('library')
  const [library, setLibrary] = useState<LibraryResponse | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [importPathText, setImportPathText] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  // 健檢：{applicable, blocker, record}。選到哪個套件就抓哪個的快取。
  const [health, setHealth] = useState<{
    applicable: boolean; blocker: string
    record: null | { status: string; seconds?: number; reason?: string; at?: string }
  } | null>(null)
  const [healthRunning, setHealthRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const selected = useMemo(
    () => library?.packages.find(item => item.package_id === selectedId)
      || library?.packages[0] || null,
    [library, selectedId],
  )
  const importPaths = useMemo(() => parseImportPaths(importPathText), [importPathText])
  // 只有還有 DLL 沒完成掃描或信任時才需要使用者介入；其餘時候把整區收起來。
  const nativeNeedsAttention = useMemo(
    () => (selected?.native_libraries || []).some(
      item => item.trust_status !== 'trusted'
        || !['clean', 'unavailable'].includes(item.scan_status),
    ),
    [selected],
  )

  const refresh = async () => {
    try {
      const result = await api<LibraryResponse>('/api/models')
      setLibrary(result)
      setSelectedId(current => (
        result.packages.some(item => item.package_id === current)
          ? current : result.packages[0]?.package_id || ''
      ))
    } catch (reason) {
      setError(`讀取模型庫失敗：${apiErrorText(reason)}`)
    }
  }

  useEffect(() => { void refresh() }, [])

  // 健檢結果跟著選取的套件走；執行中每 3 秒看一次狀態。
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!selected) { setHealth(null); return }
      try {
        const data = await api<typeof health>(
          `/api/models/${encodeURIComponent(selected.package_id)}/healthcheck`)
        if (!cancelled) setHealth(data)
      } catch { if (!cancelled) setHealth(null) }
    }
    void load()
    if (!healthRunning) return () => { cancelled = true }
    const timer = window.setInterval(async () => {
      try {
        const s = await api<{ running: boolean }>('/api/models/healthcheck/status')
        if (!s.running) { setHealthRunning(false); void load() }
      } catch { /* 下一輪再試 */ }
    }, 3000)
    return () => { cancelled = true; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.package_id, healthRunning])

  const startHealthcheck = async () => {
    if (!selected) return
    setError('')
    try {
      await api(`/api/models/${encodeURIComponent(selected.package_id)}/healthcheck`,
        { method: 'POST' })
      setHealthRunning(true)
      setMessage('健檢中：用參考通道實際求解一次，約一分鐘…')
    } catch (reason) {
      setError(`健檢啟動失敗：${apiErrorText(reason)}`)
    }
  }


  const browse = async () => {
    setError('')
    try {
      const result = await api<{ path: string; paths?: string[] }>('/api/models/browse')
      const paths = result.paths?.length ? result.paths : (result.path ? [result.path] : [])
      if (paths.length) setImportPathText(paths.join('\n'))
    } catch (reason) {
      setError(`選擇模型失敗：${apiErrorText(reason)}`)
    }
  }

  const importModel = async () => {
    if (!importPaths.length) return
    setBusy(true)
    setError('')
    setMessage(`正在解析 ${importPaths.length} 個檔案並建立受管模型副本…`)
    try {
      const result = await api<BatchImportResponse>('/api/models/import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: importPaths }),
      })
      await refresh()
      if (result.models.length) setSelectedId(result.models[result.models.length - 1].package_id)
      const blocked = result.models.filter(item => item.compatibility.status === 'block').length
      setMessage(
        `批次匯入完成：成功 ${result.succeeded_count}、失敗 ${result.failed_count}；`
        + `對應 ${result.model_count} 個受管模型版本。原始檔均未被修改。`
        + (blocked ? ` 其中 ${blocked} 個版本未通過相容性預檢。` : ''),
      )
      const failed = result.items.filter(item => !item.ok)
      setError(failed.length
        ? `以下 ${failed.length} 個檔案匯入失敗：\n${failed.map(item => `${item.path}：${item.error || '未知錯誤'}`).join('\n')}`
        : '')
      setImportPathText(failed.map(item => item.path).join('\n'))
    } catch (reason) {
      setError(`模型批次匯入失敗：${apiErrorText(reason)}`)
      setMessage('')
    } finally {
      setBusy(false)
    }
  }

  const applyUpdatedModel = async (model: ModelPackage) => {
    await refresh()
    setSelectedId(model.package_id)
  }

  const scanPackage = async () => {
    if (!selected) return
    setActionBusy('scan')
    setError('')
    setMessage('正在以系統防毒掃描受管副本中的 DLL／SO；模型不會被載入或執行…')
    try {
      const result = await api<{ ok: boolean; model: ModelPackage }>(
        `/api/models/${encodeURIComponent(selected.package_id)}/scan`,
        { method: 'POST' },
      )
      await applyUpdatedModel(result.model)
      const unavailable = result.model.native_libraries.some(item => item.scan_status === 'unavailable')
      const failed = result.model.native_libraries.some(item => item.scan_status === 'error')
      setMessage(failed
        ? '掃描未通過，已禁止建立信任。請查看原生程式庫狀態。'
        : unavailable
          ? '找不到可用的 Windows Defender 命令列掃描器；仍可由使用者明確確認風險後建立信任。'
          : '防毒掃描完成。請逐一確認雜湊值後再建立信任。')
    } catch (reason) {
      setError(`原生模型掃描失敗：${apiErrorText(reason)}`)
      setMessage('')
    } finally {
      setActionBusy('')
    }
  }

  const trustNative = async (item: NativeLibrary) => {
    if (!selected) return
    const unavailable = item.scan_status === 'unavailable'
    const warning = unavailable
      ? '\n\n注意：本機未能執行防毒掃描。確認後仍會以此 SHA-256 建立信任。'
      : ''
    const confirmed = window.confirm(
      `是否信任此原生模型程式庫？\n\n檔案：${item.file}\nSHA-256：${item.sha256}${warning}\n\n模型內容一旦變更，雜湊會改變，必須重新掃描與信任。`,
    )
    if (!confirmed) return
    setActionBusy(item.sha256)
    setError('')
    try {
      const result = await api<{ ok: boolean; model: ModelPackage }>(
        `/api/models/${encodeURIComponent(selected.package_id)}/trust`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha256: item.sha256, confirmed: true }),
        },
      )
      await applyUpdatedModel(result.model)
      setMessage(`已信任 ${item.file}；信任紀錄綁定 SHA-256，不會套用到變更後的檔案。`)
    } catch (reason) {
      setError(`建立模型信任失敗：${apiErrorText(reason)}`)
    } finally {
      setActionBusy('')
    }
  }

  return (
    <div className="model-library">
      <header className="model-library__header">
        <div>
          <h2>IBIS 模型與眼圖分析</h2>
          <p>管理 IBIS／IBIS-AMI 受管副本，並在同一頁完成通道綁定、Preflight、求解與眼圖檢視。</p>
        </div>
        <div className="model-library__header-actions">
          <div className="model-library__tabs">
            <button className={activePanel === 'library' ? 'is-active' : ''}
              onClick={() => setActivePanel('library')}>模型庫</button>
            <button className={activePanel === 'multilane' ? 'is-active' : ''}
              onClick={() => setActivePanel('multilane')}>多埠通道</button>
            <button className={activePanel === 'ami' ? 'is-active' : ''}
              onClick={() => setActivePanel('ami')}>AMI 通道</button>
          </div>
          <div className="model-library__count">
            <strong>{library?.count ?? 0}</strong><span>個模型版本</span>
          </div>
        </div>
      </header>

      {activePanel === 'library' ? <>
      <section className="model-library__import">
        <div className="model-library__import-selection">
          <textarea
            className="input model-library__import-paths"
            value={importPathText}
            onChange={event => setImportPathText(event.target.value)}
            rows={Math.min(4, Math.max(2, importPaths.length))}
            placeholder="選擇一個或多個 .ibs／.ami；也可每行貼上一個模型路徑"
            aria-label="IBIS 或 IBIS-AMI 模型路徑清單"
          />
          <small>
            {importPaths.length
              ? `已選擇 ${importPaths.length} 個檔案；同一套 IBIS／AMI 相依檔會合併為單一模型版本。`
              : '可按住 Ctrl 或 Shift 一次選取多個模型檔。'}
          </small>
        </div>
        <button className="btn" onClick={browse} disabled={busy}>瀏覽多個檔案…</button>
        <button className="btn btn--primary model-library__import-btn"
          onClick={importModel} disabled={busy || !importPaths.length}>
          {busy ? '批次匯入中…' : `匯入${importPaths.length > 1 ? ` ${importPaths.length} 個` : ''}模型`}
        </button>
      </section>

      {message && <div className="model-library__notice">{message}</div>}
      {error && <div className="model-library__notice model-library__notice--error">{error}</div>}

      <div className="model-library__body">
        <aside className="model-library__list">
          <div className="model-library__path" title={library?.library_path || ''}>
            本機位置：{library?.library_path || '讀取中…'}
          </div>
          {!library?.packages.length && (
            <div className="model-library__empty">
              尚未匯入模型。可先使用 Ansys Signal Integrity Example 的 `.ibs` 測試。
            </div>
          )}
          {library?.packages.map(item => (
            <button key={item.package_id}
              className={'model-library__card' + (selected?.package_id === item.package_id ? ' is-active' : '')}
              onClick={() => setSelectedId(item.package_id)}>
              <span className={`model-library__state model-library__state--${item.compatibility.status}`}>
                {statusText[item.compatibility.status]}
              </span>
              <span className="model-library__card-title">{item.display_name}</span>
              <span className="model-library__card-meta">
                {kindText[item.kind]}　{item.ibis?.ibis_version ? `IBIS ${item.ibis.ibis_version}` : ''}
              </span>
              <span className="model-library__card-hash">SHA-256：{shortHash(item.package_sha256)}</span>
            </button>
          ))}
        </aside>

        <main className="model-library__detail">
          {!selected ? (
            <div className="model-library__empty">選擇或匯入模型後，這裡會顯示解析結果。</div>
          ) : <>
            <div className="model-library__detail-title">
              <div>
                <h3>{selected.display_name}</h3>
                <div>{kindText[selected.kind]}　·　來源檔 {selected.source_file}</div>
              </div>
              <span className={`model-library__state model-library__state--${selected.compatibility.status}`}>
                {statusText[selected.compatibility.status]}
              </span>
            </div>

            {/* AMI 面板 2026-08-28 重建：IBIS-AMI 的分析路徑在「AMI 通道」
                分頁。多埠通道仍只吃一般 IBIS，所以要指路，不能讓人去那裡找。 */}
            {selected.kind !== 'ibis' && (
              <div className="model-library__notice">
                IBIS-AMI 的分析走「AMI 通道」分頁；DLL 要先在下方掃描並信任。
              </div>
            )}

            <div className="model-library__metrics">
              <div><span>IBIS 版本</span><strong>{selected.ibis?.ibis_version || '—'}</strong></div>
              <div><span>AMI 版本</span><strong>{Object.values(selected.ami)[0]?.ami_version || '—'}</strong></div>
              <div><span>Component</span><strong>{selected.ibis?.components.length ?? 0}</strong></div>
              <div><span>Model</span><strong>{selected.ibis?.models.length ?? 0}</strong></div>
              <div><span>Pin</span><strong>{selected.ibis?.pins.length ?? 0}</strong></div>
              {/* 純文字模型沒有原生程式庫，就不要在摘要列提示它的存在——
                  一般電路模擬本來就不該看到這套機制。 */}
              {selected.native_libraries.length > 0 && (
                <div><span>原生程式庫</span><strong>{selected.native_libraries.length}</strong></div>
              )}
            </div>

            {/* 健檢：唯二靜態檢查抓不到的失敗（AMI_Init 拒絕、步階響應算不出）
                只有真的開 AEDT 才現形。一顆按鈕、零設定，結果以 SHA-256 快取。 */}
            <section className="model-library__section">
              <h4>健檢</h4>
              <div className="model-library__health">
                {healthRunning ? <span>健檢中…（約一分鐘）</span>
                  : health?.record ? (
                    health.record.status === 'passed'
                      ? <span className="is-pass">通過（{health.record.seconds} 秒，{health.record.at}）</span>
                      : health.record.status === 'not_applicable'
                        ? <span>{health.record.reason}</span>
                        : <span className="is-fail" title={health.record.reason}>
                            失敗：{(health.record.reason || '').slice(0, 80)}
                          </span>
                  ) : <span>尚未健檢。</span>}
                <button className="btn" onClick={() => void startHealthcheck()}
                  disabled={healthRunning || Boolean(health && !health.applicable)}
                  title={health?.blocker || '用參考通道實際求解一次'}>
                  {healthRunning ? '健檢中…' : '用參考通道健檢'}
                </button>
              </div>
              <p className="hint">健檢過、真通道失敗＝通道問題；健檢不過＝模型問題。</p>
            </section>

            {(selected.compatibility.errors.length > 0 || selected.compatibility.warnings.length > 0) && (
              <section className="model-library__section">
                <h4>相容性預檢</h4>
                {/* 錯誤不再擋分析（帶錯誤放行，AEDT 是最終裁判），所以字眼
                    不能再寫「阻止」——那會讓人以為這份模型選不下去。 */}
                {selected.compatibility.errors.map(item => (
                  <div className="model-library__issue is-error" key={item}>錯誤：{item}</div>
                ))}
                {selected.compatibility.errors.length > 0 && (
                  <p className="hint">
                    分析不會被這些錯誤擋下（帶錯誤放行）；AEDT 若拒收會如實回報。
                  </p>
                )}
                {selected.compatibility.warnings.map(item => (
                  <div className="model-library__issue is-warning" key={item}>注意：{item}</div>
                ))}
              </section>
            )}

            {(selected.repairs?.length ?? 0) > 0 && (
              <section className="model-library__section">
                <h4>自動修正（{selected.repairs!.length} 處）</h4>
                <p className="hint">修的是模型庫裡的受管副本；你的來源檔一個位元都沒動。</p>
                {selected.repairs!.map((item, index) => (
                  <div className="model-library__issue is-warning" key={index}>
                    <strong>{item.detail}</strong>
                    <div>{item.impact}</div>
                  </div>
                ))}
              </section>
            )}

            <section className="model-library__section">
              <h4>模型與 Pin</h4>
              <div className="model-library__table-wrap">
                <table className="model-library__table">
                  <thead><tr><th>角色候選</th><th>Model</th><th>Model Type</th><th>Pin 數</th></tr></thead>
                  <tbody>
                    {(selected.ibis?.models || []).map(model => {
                      const type = model.model_type.toLowerCase()
                      const role = /output|3-state|i\/o/.test(type) ? 'Tx' : /input/.test(type) ? 'Rx' : '待確認'
                      const pins = selected.ibis?.pins.filter(pin => pin.model === model.name).length || 0
                      return <tr key={model.name}><td>{role}</td><td>{model.name}</td><td>{model.model_type || '—'}</td><td>{pins}</td></tr>
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {selected.native_libraries.length > 0 && (
              // 全部確認完就收起來：這套機制只在「首次遇到某個 DLL」時需要使用者
              // 介入，之後每次開啟模型都攤開整張表只是噪音。needsAttention 為 true
              // 時預設展開，讓待處理的情況仍然顯眼。
              <details className="model-library__section" open={nativeNeedsAttention}>
                <summary>
                  {nativeNeedsAttention
                    ? `原生程式庫需要確認（${selected.native_libraries.filter(
                        item => item.trust_status !== 'trusted').length} 個待確認）`
                    : `原生程式庫已確認（${selected.native_libraries.length} 個）`}
                </summary>
                <div className="model-library__section-heading">
                  <div>
                    <p>原生 DLL 會實際執行，首次使用需確認一次。信任綁定 SHA-256，模型一變就要重新確認。</p>
                  </div>
                  <button className="btn" onClick={scanPackage} disabled={Boolean(actionBusy)}>
                    {actionBusy === 'scan' ? '掃描中…' : '掃描全部 DLL／SO'}
                  </button>
                </div>
                <div className="model-library__table-wrap">
                  <table className="model-library__table">
                    <thead><tr><th>檔案</th><th>格式</th><th>架構</th><th>大小</th><th>掃描</th><th>信任</th><th>SHA-256</th><th>操作</th></tr></thead>
                    <tbody>{selected.native_libraries.map(item => (
                      <tr key={item.sha256}>
                        <td>{item.file}</td><td>{item.format}</td><td>{item.architecture}</td>
                        <td>{formatBytes(item.size_bytes)}</td>
                        <td title={item.message || item.scanner || ''}>
                          <span className={`model-library__native-state is-${item.scan_status}`}>
                            {scanText[item.scan_status] || item.scan_status}
                          </span>
                        </td>
                        <td>
                          <span className={`model-library__native-state is-${item.trust_status}`}>
                            {trustText[item.trust_status] || item.trust_status}
                          </span>
                        </td>
                        <td title={item.sha256}>{shortHash(item.sha256)}</td>
                        <td>{item.trust_status === 'trusted' ? '—' : (
                          <button className="btn model-library__trust-btn"
                            disabled={Boolean(actionBusy) || !['clean', 'unavailable'].includes(item.scan_status)}
                            onClick={() => void trustNative(item)}>
                            {actionBusy === item.sha256 ? '處理中…' : '確認信任'}
                          </button>
                        )}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </details>
            )}

            {/* 雜湊值平常不必看，但要重現某次分析或核對模型是否被改過時必須查得到，
                因此收進摺疊區而不是移除。 */}
            <details className="model-library__section model-library__manifest">
              <summary>可重現性資訊（受管位置、SHA-256）</summary>
              <div><span>套件 SHA-256</span><code>{selected.package_sha256}</code></div>
              <div><span>受管位置</span><code>{selected.managed_path}</code></div>
              <div><span>IBIS Checker</span><code>{selected.ibis_checker.available
                ? `${selected.ibis_checker.version}／${selected.ibis_checker.status}` : '未找到'}</code></div>
            </details>
          </>}
        </main>
      </div>
      </> : activePanel === 'multilane'
        ? <MultiLaneWizard packages={library?.packages || []}
            onLibraryChanged={refresh} />
        : <AmiChannelPanel packages={library?.packages || []}
            onLibraryChanged={refresh} />}
    </div>
  )
}
