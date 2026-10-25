// S 參數工具箱（2026-08-29）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 工具箱（重正規化／換埠序／重取樣／DC 外插／去嵌入）走 skrf 原生實作，立即可用。
import { useEffect, useRef, useState } from 'react'
import { revealPath } from '../revealPath'
import { useT } from '../i18n'
import { errorText } from '../backendFields'
import BetaBadge from './BetaBadge'

interface ToolboxOperation { name: string; description: string; description_en?: string }

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    let detailEn: string | undefined
    try {
      const body = await response.json()
      message = body?.detail || message
      if (typeof body?.detail_en === 'string' && body.detail_en) detailEn = body.detail_en
    } catch { /* 保留 */ }
    // 英文介面要的 detail_en 掛在 Error 上，顯示時用 errorText 挑。
    throw Object.assign(new Error(message), { detail_en: detailEn })
  }
  return response.json() as Promise<T>
}

export default function SpisimToolboxPanel() {
  const { t: messages, lang } = useT()
  const t = messages.spisim
  /** 操作選單的顯示名稱。中文介面照舊用後端的 description；英文介面優先用
   *  後端的 description_en，沒有就依操作代號（name，穩定識別字）取語言檔。 */
  const operationLabel = (item: ToolboxOperation) => {
    if (lang !== 'en') return item.description
    return item.description_en
      || (t.operations as Record<string, string>)[item.name] || item.description
  }
  const [operations, setOperations] = useState<ToolboxOperation[]>([])
  const [operationsLoading, setOperationsLoading] = useState(true)
  const [operationsError, setOperationsError] = useState<unknown>(null)
  const operationsRequestId = useRef(0)
  const [operation, setOperation] = useState('renormalize')
  const [source, setSource] = useState('')
  const [impedance, setImpedance] = useState('42.5')
  const [portOrder, setPortOrder] = useState('')
  const [points, setPoints] = useState('1001')
  const [leftFixture, setLeftFixture] = useState('')
  const [rightFixture, setRightFixture] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  /** 「開啟結果資料夾」要開哪裡（sparam_processed）。 */
  const [outputFolder, setOutputFolder] = useState('')

  const loadOperations = async () => {
    const requestId = ++operationsRequestId.current
    setOperationsLoading(true)
    setOperationsError(null)
      try {
        const ops = await api<{ operations: ToolboxOperation[] }>(
          '/api/sparam/toolbox/operations')
        if (requestId !== operationsRequestId.current) return
        if (!Array.isArray(ops.operations) || !ops.operations.length) throw new Error(t.operationsEmpty)
        setOperations(ops.operations)
        setOperation(previous => ops.operations.some(item => item.name === previous)
          ? previous : ops.operations[0].name)
      } catch (reason) {
        if (requestId !== operationsRequestId.current) return
        setOperations([])
        setOperationsError(reason)
      } finally {
        if (requestId === operationsRequestId.current) setOperationsLoading(false)
      }
  }
  useEffect(() => {
    void loadOperations()
    return () => { operationsRequestId.current += 1 }
  }, [])
  const operationReady = !operationsLoading && !operationsError
    && operations.some(item => item.name === operation)

  const browseInto = async (setter: (value: string) => void) => {
    try {
      // `/api/browse_touchstone` 回的是 **`paths` 陣列**（它是多選對話框）。
      // 這裡原本讀單數的 `picked.path`，永遠是 undefined，於是
      // **選完檔案、對話框關掉、欄位一個字都沒填、也沒有任何錯誤**。
      // 其餘三個呼叫點（串接、AMI、多道）都讀對了，只有這裡漏掉。
      const picked = await api<{ paths?: string[] }>('/api/browse_touchstone')
      const first = picked?.paths?.[0] || ''
      if (first) setter(first)
      else setError(t.noFilePicked)
    } catch (reason) { setError(errorText(reason, lang)) }
  }

  const runToolbox = async () => {
    if (busy || !operationReady || !source) return
    setBusy(true); setError(''); setMessage('')
    try {
      const options: Record<string, unknown> = {}
      if (operation === 'renormalize') options.impedance_ohm = Number(impedance)
      if (operation === 'reorder') {
        // \uFF0C 是全形逗號：中文輸入法打出來的「，」也要當分隔符號。
        options.port_order = portOrder.split(/[\uFF0C,\s]+/).filter(Boolean).map(Number)
      }
      if (operation === 'resample') options.points = Number(points)
      if (operation === 'deembed') {
        options.left_fixture = leftFixture
        options.right_fixture = rightFixture
      }
      const out = await api<{ output_path: string; ports: number; points: number }>(
        '/api/sparam/toolbox/process', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation, touchstone_path: source, options }),
        })
      setOutputFolder(out.output_path)
      setMessage(t.toolboxDone(out.output_path, out.ports, out.points))
    } catch (reason) {
      setError(errorText(reason, lang))
    } finally { setBusy(false) }
  }

  const openFolder = async (path: string) => {
    const failure = await revealPath(path, lang)
    if (failure) setError(failure)
  }

  return (
    <div className="ibis-wizard">
      <section>
        <h3>{t.toolboxTitle}<BetaBadge feature="B15" /></h3>
        <p className="hint">{t.toolboxHint}</p>
        <label>{t.sourceLabel}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input is-wide" value={source}
              placeholder="path\to\channel.s4p"
              onChange={event => setSource(event.target.value)} />
            <button className="btn" onClick={() => void browseInto(setSource)}>{t.browse}</button>
          </div>
        </label>
        <label>{t.operationLabel}
          <select className="input" value={operation} disabled={!operationReady || busy}
            onChange={event => setOperation(event.target.value)}>
            {operations.map(item => (
              <option key={item.name} value={item.name}>{operationLabel(item)}</option>
            ))}
          </select>
        </label>
        {operationsLoading && <p className="hint" role="status">{t.operationsLoading}</p>}
        {!!operationsError && <div role="alert">
          <p className="error">{t.operationsFailed(errorText(operationsError, lang))}</p>
          <button className="btn" type="button" onClick={() => void loadOperations()}>{t.operationsRetry}</button>
        </div>}
        <p className="hint">{(t.optionHints as Record<string, string>)[operation] || ''}</p>
        {operation === 'renormalize' && (
          <label>{t.impedanceLabel}
            <input className="input" value={impedance}
              onChange={event => setImpedance(event.target.value)} />
          </label>
        )}
        {operation === 'reorder' && (
          <label>{t.portOrderLabel}
            <input className="input" value={portOrder} placeholder="1,3,2,4"
              onChange={event => setPortOrder(event.target.value)} />
          </label>
        )}
        {operation === 'resample' && (
          <label>{t.pointsLabel}
            <input className="input" value={points}
              onChange={event => setPoints(event.target.value)} />
          </label>
        )}
        {operation === 'deembed' && <>
          <label>{t.leftFixture}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input is-wide" value={leftFixture}
                onChange={event => setLeftFixture(event.target.value)} />
              <button className="btn" onClick={() => void browseInto(setLeftFixture)}>{t.browse}</button>
            </div>
          </label>
          <label>{t.rightFixture}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input is-wide" value={rightFixture}
                onChange={event => setRightFixture(event.target.value)} />
              <button className="btn" onClick={() => void browseInto(setRightFixture)}>{t.browse}</button>
            </div>
          </label>
        </>}
        <button className="btn btn--primary" disabled={busy || !source || !operationReady}
          onClick={() => void runToolbox()}>
          {busy ? t.processing : t.run}
        </button>
        {message && <div className="model-library__notice">{message}</div>}
        {outputFolder && (
          <div className="field-row" style={{ marginTop: 6 }}>
            <button className="btn" onClick={() => void openFolder(outputFolder)}>
              {t.openFolder}
            </button>
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}
    </div>
  )
}
