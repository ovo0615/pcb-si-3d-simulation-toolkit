import { confirmMessage } from '../messageDialog'
// IBIS 模型與眼圖分析：模型管理、通道綁定與眼圖求解整合介面。
import { useEffect, useMemo, useState } from 'react'
import EyeWizard from './EyeWizard'
import { useT, currentLang, messagesFor } from '../i18n'
import SpisimToolboxPanel from './SpisimToolboxPanel'
import SerdesCompliancePanel from './SerdesCompliancePanel'
import { LicenseTag, useLicenseBlock } from './LicenseTag'
import { healthStatusView } from '../healthcheckStatus'
import { pickText, pickList, errorText } from '../backendFields'
import { specModelInfo } from '../specModel'
import { restartHint } from '../installKind'
import type { Lang, Messages } from '../i18n'
import BetaBadge from './BetaBadge'
import { useBetaEnabled } from './BetaSwitch'
import { useSessionState } from '../useSessionState'

// 保存訊息所需資料，畫面切換語言時重新產生文字。
type LibraryNotice = (t: Messages, lang: Lang) => string

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
  /** 這台電腦會不會載入（Windows 上的 Linux .so 不會）。 */
  required_here?: boolean
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
    /** [Model Selector]：底下的變體（ 眼圖精靈的變體漏斗）。 */
    model_selectors?: { name: string; models: { name: string; description: string }[] }[]
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
  /** 來源分類（原廠／自建／範例）。SPISim 產生的另帶 generator、template、
   *  ccomp_check（後端 model_library.set_model_source）。 */
  source_classification?: Record<string, any>
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
  /** 匯入或遷移時的修復紀錄。`kind: 'needs_user_choice'` 是「工具不敢猜、要你決定」，
   *  不是已經修好的東西——渲染時必須跟自動修正分開，否則使用者會以為已經處理完了。 */
  source_defects?: { component: string; pin: string; signal: string; model: string;
    missing_models: string[]; blocked: boolean; checker_confirmed: boolean }[]
  repairs?: { rule: string; detail: string; impact: string; kind?: string }[]
  /** manifest 讀不出來時，後端會回一筆只有識別碼、`readable: false` 與 `error`
   *  的佔位資料（見 model_library.list_model_packages）——它沒有 `ami`、
   *  `native_libraries`、`compatibility.target` 這些欄位。詳細面板要先認得
   *  這個旗標，否則點到它就是 `undefined.length`，整頁白掉。 */
  readable?: boolean
  error?: string
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
    let detail_en = ''
    // 整份回應也掛上去：呼叫端可讀 code 等欄位。
    let body: unknown = null
    try {
      body = await response.json()
      message = pickText(body, 'detail', 'zh-TW') || message
      detail_en = pickText(body, 'detail', 'en')
    } catch {
      // 保留 HTTP 狀態文字。
    }
    throw Object.assign(new Error(message), { detail_en, body })
  }
  return response.json() as Promise<T>
}




function formatBytes(value = 0): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function apiErrorText(reason: unknown, lang: Lang = currentLang()): string {
  if (reason instanceof TypeError && /failed to fetch|fetch failed/i.test(reason.message)) {
    return messagesFor(lang).library.backendUnavailable(restartHint(lang))
  }
  return errorText(reason, lang)
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



export default function ModelLibrary() {
  // 模型庫＋三個分析面板。點對點標準 IBIS 面板已於 2026-08-19 移除；
  // AMI 通道之後重新放回。
  // ：眼圖精靈是預設分頁；多埠與 AMI 舊面板收進「進階」。
  const { t, lang } = useT()
  const statusText: Record<CompatibilityState, string> = {
    ready: t.library.ready, warning: t.library.pending, block: t.library.blocked,
  }

  const kindText: Record<ModelPackage['kind'], string> = {
    ibis: 'IBIS', ibis_ami: 'IBIS-AMI', ami_fragment: t.library.amiFragment,
  }

  const scanText: Record<string, string> = {
    pending: t.library.notScanned,
    clean: t.library.scanClean,
    unavailable: t.library.scannerUnavailable,
    error: t.library.scanFailed,
  }

  const trustText: Record<string, string> = {
    pending: t.library.notTrusted,
    trusted: t.library.trusted,
    // 後端在「模型檔換了、原本的信任不再成立」時回 revoked（見 model_library
    // `_decorate_trust`）。沒有這一條，畫面就直接把英文代碼印出來。
    revoked: t.library.trustRevoked,
  }

  const betaEnabled = useBetaEnabled()
  const [betaMounted, setBetaMounted] = useState(false)
  useEffect(() => { if (betaEnabled) setBetaMounted(true) }, [betaEnabled])
  const tabs = t.eyeWizard.tabs
  const [activePanel, setActivePanel] =
    useSessionState<'wizard' | 'library' | 'toolbox'>('ibis.activePanel', 'wizard')
  const [library, setLibrary] = useState<LibraryResponse | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [importPathText, setImportPathText] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  // 量測→IBIS 建模（B4，2026-08-30）：示波器／SMU 兩欄 CSV → 合規 .ibs
  // → 匯入模型庫。單 corner（typ），缺的 corner 以 NA 標示不假造。
  const [mb, setMb] = useState({
    model_name: '', model_type: 'Output', voltage_range_v: '1.2',
    c_comp_pf: '1.0', vinl_v: '', vinh_v: '',
    pulldown_csv: '', pullup_csv: '', gnd_clamp_csv: '', power_clamp_csv: '',
    rising_csv: '', rising_r: '50', rising_v: '0',
    falling_csv: '', falling_r: '50', falling_v: '',
  })
  const [mbBusy, setMbBusy] = useState(false)
  const [mbMsg, setMbMsg] = useState<LibraryNotice | null>(null)
  const [mbFolder, setMbFolder] = useState('')
  const [mbScanMsg, setMbScanMsg] = useState<LibraryNotice | null>(null)
  const setMbField = (key: string, value: string) =>
    setMb(prev => ({ ...prev, [key]: value }))

  const browseMbCsv = async (key: string, title: string) => {
    try {
      const data = await api<{ path: string }>(
        `/api/browse_csv?title=${encodeURIComponent(title)}`)
      if (data.path) setMbField(key, data.path)
    } catch (reason) {
      // 只寫 console 的話，對話框開不起來（例如主機沒有 tkinter）跟使用者按
      // 取消長得一模一樣：欄位空著、畫面沒動、沒有任何訊息。
      setMbMsg(() => (_t: Messages, _lang: Lang) => (_t.library.browseFileFailed(apiErrorText(reason, _lang))))
    }
  }

  const browseMbFolder = async () => {
    try {
      const data = await api<{ path: string }>(
        '/api/browse_folder?title=' + encodeURIComponent(t.library.measurementFolderTitle))
      if (data.path) { setMbFolder(data.path); await scanMbFolder(data.path) }
    } catch (reason) {
      setMbMsg(() => (_t: Messages, _lang: Lang) => (_t.library.browseFolderFailed(apiErrorText(reason, _lang))))
    }
  }

  /** 掃資料夾、依檔名特徵把 CSV 填進對應欄位。
   *
   *  **填完一定讓人看見填了什麼**——猜測會錯（不同量測設備的檔名差很多），
   *  所以不做「選了資料夾就直接建模」。沒認出來的檔案也列出來，
   *  不然使用者會以為工具沒看到那些檔案。 */
  const scanMbFolder = async (folder: string) => {
    setMbScanMsg(() => (_t: Messages, _lang: Lang) => (_t.library.scanning))
    try {
      const data = await api<{
        matched: Record<string, string>; unmatched: string[]; csv_count: number
      }>(`/api/scan_measurement_folder?folder=${encodeURIComponent(folder)}`)
      const entries = Object.entries(data.matched || {})
      if (!entries.length) {
        setMbScanMsg(() => (_t: Messages, _lang: Lang) => (_t.library.csvNotRecognized(data.csv_count)
          + _t.library.csvExpectedNames))
        return
      }
      setMb(prev => ({ ...prev, ...Object.fromEntries(entries) }))
      const labels: Record<string, string> = {
        pulldown_csv: 'Pulldown', pullup_csv: 'Pullup',
        gnd_clamp_csv: 'GND Clamp', power_clamp_csv: 'POWER Clamp',
        rising_csv: 'Rising', falling_csv: 'Falling',
      }
      setMbScanMsg(() => (_t: Messages, _lang: Lang) => (_t.library.csvAssigned(entries.length,
        entries.map(([key, path]) => _t.library.fileAssignment(
          labels[key] || key, path.split(/[\\/]/).pop() || '')).join(_t.library.listSeparator))
        + (data.unmatched.length
          ? _t.library.csvUnmatched(data.unmatched.length)
            + data.unmatched.map(p => p.split(/[\\/]/).pop()).join(_t.library.listSeparator)
          : '')
        + _t.library.verifyCsv))
    } catch (reason) {
      setMbScanMsg(() => (_t: Messages, _lang: Lang) => (apiErrorText(reason, _lang)))
    }
  }
  const buildFromMeasurement = async () => {
    setMbBusy(true); setMbMsg(null)
    try {
      const needsInput = mb.model_type !== 'Output'
      const data = await api<any>('/api/models/build-from-measurement', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_name: mb.model_name.trim(),
          model_type: mb.model_type,
          voltage_range_v: Number(mb.voltage_range_v),
          c_comp_pf: Number(mb.c_comp_pf) || 0,
          vinl_v: needsInput && mb.vinl_v.trim() ? Number(mb.vinl_v) : null,
          vinh_v: needsInput && mb.vinh_v.trim() ? Number(mb.vinh_v) : null,
          pulldown_csv: mb.pulldown_csv.trim(),
          pullup_csv: mb.pullup_csv.trim(),
          gnd_clamp_csv: mb.gnd_clamp_csv.trim(),
          power_clamp_csv: mb.power_clamp_csv.trim(),
          rising: mb.rising_csv.trim() ? [{
            csv: mb.rising_csv.trim(),
            r_fixture_ohm: Number(mb.rising_r) || 50,
            v_fixture_v: Number(mb.rising_v) || 0,
          }] : [],
          falling: mb.falling_csv.trim() ? [{
            csv: mb.falling_csv.trim(),
            r_fixture_ohm: Number(mb.falling_r) || 50,
            v_fixture_v: mb.falling_v.trim()
              ? Number(mb.falling_v) : Number(mb.voltage_range_v),
          }] : [],
        }),
      })
      setMbMsg(() => (_t: Messages, _lang: Lang) => {
        const warnings = pickList(data, 'warnings', _lang).join(_t.library.warningSeparator)
        return _t.library.builtImported(data.imported?.display_name || '')
          + pickText(data, 'note', _lang)
          + (warnings ? _t.library.conditioningNotes(warnings) : '')
      })
      await refresh()
    } catch (e) {
      setMbMsg(() => (_t: Messages, _lang: Lang) => (_t.library.buildFailed + apiErrorText(e, _lang)))
    } finally { setMbBusy(false) }
  }
  // 健檢：{applicable, blocker, record}。選到哪個套件就抓哪個的快取。
  const [health, setHealth] = useState<{
    applicable: boolean; blocker: string
    record: null | { status: string; seconds?: number; reason?: string; at?: string }
  } | null>(null)
  const [healthRunning, setHealthRunning] = useState(false)
  // 健檢會開 Circuit 求解：沒有空位就變灰並寫原因。
  const healthBlock = useLicenseBlock(['model_check'])
  const [message, setMessage] = useState<LibraryNotice | null>(null)
  const [error, setError] = useState<LibraryNotice | null>(null)

  const selected = useMemo(
    () => library?.packages.find(item => item.package_id === selectedId)
      || library?.packages[0] || null,
    [library, selectedId],
  )
  const selectedSpec = selected ? specModelInfo(selected, lang) : null
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
      setError(() => (_t: Messages, _lang: Lang) => (_t.library.loadFailed(apiErrorText(reason, _lang))))
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
    setError(null)
    try {
      await api(`/api/models/${encodeURIComponent(selected.package_id)}/healthcheck`,
        { method: 'POST' })
      setHealthRunning(true)
      setMessage(() => (_t: Messages, _lang: Lang) => (_t.library.healthStarted))
    } catch (reason) {
      setError(() => (_t: Messages, _lang: Lang) => (_t.library.healthStartFailed(apiErrorText(reason, _lang))))
    }
  }


  const browse = async () => {
    setError(null)
    try {
      const result = await api<{ path: string; paths?: string[] }>('/api/models/browse')
      const paths = result.paths?.length ? result.paths : (result.path ? [result.path] : [])
      if (paths.length) setImportPathText(paths.join('\n'))
    } catch (reason) {
      setError(() => (_t: Messages, _lang: Lang) => (_t.library.browseModelFailed(apiErrorText(reason, _lang))))
    }
  }

  const importModel = async () => {
    if (!importPaths.length) return
    setBusy(true)
    setError(null)
    setMessage(() => (_t: Messages, _lang: Lang) => (_t.library.importingFiles(importPaths.length)))
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
        () => (_t: Messages, _lang: Lang) => (_t.library.importSummary(result.succeeded_count, result.failed_count)
        + _t.library.importVersions(result.model_count)
        + (blocked ? _t.library.importBlocked(blocked) : '')),
      )
      const failed = result.items.filter(item => !item.ok)
      setError(failed.length ? () => (_t: Messages, _lang: Lang) =>
        _t.library.failedFiles(failed.length, failed.map(item => _t.library.fileError(
          item.path, pickText(item, 'error', _lang) || _t.library.unknownError)).join('\n'))
        : null)
      setImportPathText(failed.map(item => item.path).join('\n'))
    } catch (reason) {
      setError(() => (_t: Messages, _lang: Lang) => (_t.library.importFailed(apiErrorText(reason, _lang))))
      setMessage(null)
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
    setError(null)
    setMessage(() => (_t: Messages, _lang: Lang) => (_t.library.nativeScanning))
    try {
      const result = await api<{ ok: boolean; model: ModelPackage }>(
        `/api/models/${encodeURIComponent(selected.package_id)}/scan`,
        { method: 'POST' },
      )
      await applyUpdatedModel(result.model)
      const unavailable = result.model.native_libraries.some(item => item.scan_status === 'unavailable')
      const failed = result.model.native_libraries.some(item => item.scan_status === 'error')
      setMessage(() => (_t: Messages, _lang: Lang) => (failed
        ? _t.library.nativeScanBlocked
        : unavailable
          ? _t.library.defenderUnavailable
          : _t.library.nativeScanComplete))
    } catch (reason) {
      setError(() => (_t: Messages, _lang: Lang) => (_t.library.nativeScanFailed(apiErrorText(reason, _lang))))
      setMessage(null)
    } finally {
      setActionBusy('')
    }
  }

  /** 執行第三方原生程式庫的使用條款，第一次建立信任前要看過一次。
   *  快取由 persistentPreferences 同步至程式外的使用者資料；換包或埠號沿用。
   *  換電腦或條款鍵改版時仍須重新確認。 */
  const TERMS_KEY = 'pcbsi.native-library-terms.v1'
  const TERMS_TEXT = [
    t.library.termsTitle,
    '',
    t.library.termsExecution,
    t.library.termsResponsibility,
    t.library.termsChecks,
    t.library.termsNoGuarantee,
    t.library.termsLocal,
    t.library.termsDistribution,
    '',
    t.library.termsAccept,
  ].join('\n')

  const acceptNativeTerms = async (): Promise<boolean> => {
    try {
      if (window.localStorage.getItem(TERMS_KEY) === 'accepted') return true
    } catch { /* 隱私模式讀不到就每次都問，不影響功能 */ }
    if (!await confirmMessage(TERMS_TEXT)) return false
    try { window.localStorage.setItem(TERMS_KEY, 'accepted') } catch { /* 記不住就下次再問 */ }
    return true
  }

  const trustNative = async (item: NativeLibrary) => {
    if (!selected) return
    if (!await acceptNativeTerms()) return
    const unavailable = item.scan_status === 'unavailable'
    const warning = unavailable
      ? t.library.trustScanWarning
      : ''
    const confirmed = await confirmMessage(
      t.library.trustConfirm(item.file, item.sha256, warning),
    )
    if (!confirmed) return
    setActionBusy(item.sha256)
    setError(null)
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
      setMessage(() => (_t: Messages, _lang: Lang) => (_t.library.trustEstablished(item.file)))
    } catch (reason) {
      setError(() => (_t: Messages, _lang: Lang) => (_t.library.trustFailed(apiErrorText(reason, _lang))))
    } finally {
      setActionBusy('')
    }
  }

  return (
    <div className="model-library">
      <header className="model-library__header">
        <div>
          <h2>{t.library.title}</h2>
          <p>{t.library.subtitle}</p>
        </div>
        <div className="model-library__header-actions">
          <div className="model-library__tabs">
            {(['wizard', 'library', 'toolbox'] as const).filter(key => betaEnabled || key === 'library').map(key => (
              <button key={key} className={activePanel === key ? 'is-active' : ''}
                onClick={() => setActivePanel(key)}>{tabs[key]}{key === 'toolbox' && t.featureTier.betaSuffix}</button>
            ))}
          </div>
          <div className="model-library__count">
            <strong>{library?.count ?? 0}</strong><span>{t.library.modelVersions}</span>
          </div>
        </div>
      </header>

      {(activePanel === 'library' || !betaEnabled) ? <>
      <section className="model-library__import">
        <div className="model-library__import-selection">
          <textarea
            className="input model-library__import-paths"
            value={importPathText}
            onChange={event => setImportPathText(event.target.value)}
            rows={Math.min(4, Math.max(2, importPaths.length))}
            placeholder={t.library.importPlaceholder}
            aria-label={t.library.importLabel}
          />
          <small>
            {importPaths.length
              ? t.library.selectedFiles(importPaths.length)
              : t.library.multiSelectHint}
          </small>
        </div>
        <button className="btn" onClick={browse} disabled={busy}>{t.library.browseModels}</button>
        <button className="btn btn--primary model-library__import-btn"
          onClick={importModel} disabled={busy || !importPaths.length}>
          {busy ? t.library.importBusy : t.library.importButton(importPaths.length > 1 ? t.library.importCount(importPaths.length) : '')}
        </button>
      </section>

      {/* 量測→IBIS 建模（B4）：客戶只有示波器／SMU 量測時的路。 */}
      <details hidden={!betaEnabled} className="model-library__import" style={{ padding: '8px 12px' }}>
        <summary hidden={!betaEnabled}>{t.library.measurementBuilder}<BetaBadge feature="B14" /></summary>
        <p className="model-library__hint" style={{ marginTop: 4 }}>
          {t.library.measurementUnits}</p>
        <p className="model-library__hint">
          {t.library.vccConversion}</p>
        <p className="model-library__hint">
          {t.library.singleCornerHint}</p>
        {/* 快速帶入：選一個資料夾，依檔名特徵認出哪個 CSV 是哪一條。
            六個路徑一個一個貼太痛苦，而量測輸出通常本來就在同一個資料夾。 */}
        <div className="field-row" style={{ marginTop: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="field-label">{t.library.measurementFolder}</div>
            <input className="input" value={mbFolder}
              onChange={e => setMbFolder(e.target.value)}
              placeholder={t.library.measurementFolderPlaceholder} />
          </div>
          <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
            onClick={() => void browseMbFolder()}>{t.library.browse}</button>
          <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
            disabled={!mbFolder.trim()}
            onClick={() => void scanMbFolder(mbFolder)}>{t.library.autoFill}</button>
        </div>
        {mbScanMsg && <div className="model-library__notice">{mbScanMsg(t, lang)}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginTop: 8 }}>
          <label>
            <div className="field-label">{t.library.modelName}</div>
            <input className="input" placeholder={t.library.modelNamePlaceholder} value={mb.model_name}
              onChange={e => setMbField('model_name', e.target.value)} />
          </label>
          <label>
            <div className="field-label">{t.library.modelType}</div>
            <select className="input" value={mb.model_type}
              onChange={e => setMbField('model_type', e.target.value)}>
              <option value="Output">{t.library.outputType}</option>
              <option value="Input">{t.library.inputType}</option>
              <option value="I/O">{t.library.ioType}</option>
            </select>
          </label>
          <label title={t.library.vccHint}>
            <div className="field-label">{t.library.vccLabel}</div>
            <input className="input" placeholder={t.library.vccExample} value={mb.voltage_range_v}
              onChange={e => setMbField('voltage_range_v', e.target.value)} />
          </label>
          <label title={t.library.capacitanceHint}>
            <div className="field-label">{t.library.capacitanceLabel}</div>
            <input className="input" placeholder={t.library.capacitanceExample} value={mb.c_comp_pf}
              onChange={e => setMbField('c_comp_pf', e.target.value)} />
          </label>
        </div>
        {mb.model_type !== 'Output' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
            <label title={t.library.vinlHint}>
              <div className="field-label">{t.library.vinlLabel}</div>
              <input className="input" placeholder={t.library.thresholdSource} value={mb.vinl_v}
                onChange={e => setMbField('vinl_v', e.target.value)} />
            </label>
            <label title={t.library.vinhHint}>
              <div className="field-label">{t.library.vinhLabel}</div>
              <input className="input" placeholder={t.library.thresholdSource} value={mb.vinh_v}
                onChange={e => setMbField('vinh_v', e.target.value)} />
            </label>
          </div>
        )}

        <div className="field-label" style={{ marginTop: 10 }}>
          {t.library.ivHeading}</div>
        {([
          ['pulldown_csv', 'Pulldown IV CSV', t.library.pulldownHint, false],
          ['pullup_csv', 'Pullup IV CSV', t.library.pullupHint, false],
          ['gnd_clamp_csv', 'GND Clamp IV CSV', t.library.groundClampHint, true],
          ['power_clamp_csv', 'POWER Clamp IV CSV', t.library.powerClampHint, true],
        ] as [string, string, string, boolean][]).map(([key, label, hint, optional]) => (
          <div className="field-row" key={key} style={{ marginTop: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }} title={hint}>
              <div className="field-label">{label}{optional ? t.library.optional : ''}</div>
              <input className="input" value={(mb as Record<string, string>)[key]}
                onChange={e => setMbField(key, e.target.value)} placeholder={hint} />
            </div>
            <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
              onClick={() => void browseMbCsv(key, t.library.selectCurve(label))}>{t.library.browse}</button>
          </div>
        ))}

        <div className="field-label" style={{ marginTop: 10 }}>
          {t.library.vtHeading}</div>
        <p className="model-library__hint" style={{ marginTop: 2 }}
          title={t.library.fixtureHint1
            + t.library.fixtureHint2
            + t.library.fixtureHint3
            + t.library.fixtureHint4}>
          {t.library.fixtureWarning}</p>
        {([
          ['rising_csv', 'rising_r', 'rising_v', 'Rising VT CSV', t.library.risingWaveform, t.library.groundExample],
          ['falling_csv', 'falling_r', 'falling_v', 'Falling VT CSV', t.library.fallingWaveform, t.library.vccBlank],
        ] as [string, string, string, string, string, string][]).map(
          ([csvKey, rKey, vKey, label, hint, vHint]) => (
          <div className="field-row" key={csvKey} style={{ marginTop: 4 }}>
            <div style={{ flex: 2, minWidth: 0 }} title={hint}>
              <div className="field-label">{label}</div>
              <input className="input" value={(mb as Record<string, string>)[csvKey]}
                onChange={e => setMbField(csvKey, e.target.value)} placeholder={hint} />
            </div>
            <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
              onClick={() => void browseMbCsv(csvKey, t.library.selectCurve(label))}>{t.library.browse}</button>
            <div style={{ flex: 1, minWidth: 0 }} title={t.library.fixtureResistanceHint}>
              <div className="field-label">{t.library.fixtureResistance}</div>
              <input className="input" value={(mb as Record<string, string>)[rKey]}
                onChange={e => setMbField(rKey, e.target.value)} placeholder={t.library.resistanceExample} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }} title={t.library.fixtureVoltageHint}>
              <div className="field-label">{t.library.fixtureVoltage}</div>
              <input className="input" value={(mb as Record<string, string>)[vKey]}
                onChange={e => setMbField(vKey, e.target.value)} placeholder={vHint} />
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <button className="btn btn--primary"
            disabled={mbBusy || !mb.model_name.trim() || !Number(mb.voltage_range_v)}
            onClick={() => void buildFromMeasurement()}>
            {mbBusy ? t.library.building : t.library.buildImport}
          </button>
        </div>
        {mbMsg && <div className="model-library__notice">{mbMsg(t, lang)}</div>}
      </details>

      {message && <div className="model-library__notice">{message(t, lang)}</div>}
      {error && <div className="model-library__notice model-library__notice--error">{error(t, lang)}</div>}

      <div className="model-library__body">
        <aside className="model-library__list">
          <div className="model-library__path" title={library?.library_path || ''}>
            {t.library.localPath}{library?.library_path || t.library.loading}
          </div>
          {!library?.packages.length && (
            <div className="model-library__empty">
              {t.library.emptyLibrary}</div>
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
                {kindText[item.kind]} {t.library.spacer}{item.ibis?.ibis_version ? `IBIS ${item.ibis.ibis_version}` : ''}
              </span>

              {(() => {
                // ：SPISim 產生的規格模型 [Manufacturer] 寫 ANSYS，清單上就要看得出不是原廠。
                // ：本工具合成的另一種顏色、另一句話，和 SPISim 產生的分得開。
                const info = specModelInfo(item, lang)
                if (!info?.spisim && !info?.synth) return null
                return <span className="model-library__source-badges">
                  <span className={'model-library__source-badge' + (info.synth ? ' is-synth' : '')}>
                    {info.synth ? t.library.synthBadgeShort : t.library.spisimBadgeShort}</span>
                  {info.ccomp && <span className={`model-library__ccomp is-${info.ccomp.level}`}>
                    C_comp {t.library.ccompLevel[info.ccomp.level]}</span>}
                </span>
              })()}
            </button>
          ))}
        </aside>

        <main className="model-library__detail">
          {!selected ? (
            <div className="model-library__empty">{t.library.selectModelHint}</div>
          ) : selected.readable === false ? (
            // 壞掉的那一筆照樣列得出來（後端刻意如此），但它沒有解析結果可看，
            // 只能把讀不出來的原因原樣交代清楚——別假裝它是一份正常的模型。
            <div className="model-library__detail-title">
              <div>
                <h3>{selected.display_name}</h3>
                <div className="model-library__issue is-error">
                  {t.library.unreadable}{pickText(selected, 'error', lang) || t.library.unknownReason}
                </div>
                <p className="hint">{t.library.manifestHint}</p>
              </div>
            </div>
          ) : <>
            <div className="model-library__detail-title">
              <div>
                <h3>{selected.display_name}</h3>
                <div>{kindText[selected.kind]} {t.library.sourceFile}{selected.source_file}</div>
              </div>
              <span className={`model-library__state model-library__state--${selected.compatibility.status}`}>
                {statusText[selected.compatibility.status]}
              </span>
            </div>

            {/* ：SPISim 產生的規格模型，非原廠；C_comp 是佔位值，τ/UI 用產生時的資料率算。 */}
            {/* ：本工具合成的規格模型，非原廠、非 SPISim；參數逐項附出處。 */}
            {(selectedSpec?.spisim || selectedSpec?.synth) && (
              <div className={'model-library__spisim' + (selectedSpec.synth ? ' is-synth' : '')}>
                <strong>{selectedSpec.synth ? t.library.synthBadge : t.library.spisimBadge}</strong>
                {selectedSpec.originNote && <span>{selectedSpec.originNote}</span>}
                <span>{selectedSpec.synth
                  ? t.library.synthMeta(selectedSpec.familyLabel, selectedSpec.role.toUpperCase(),
                    String(selected?.source_classification?.spec_table_version || ''))
                  : t.library.spisimMeta(selectedSpec.template, selectedSpec.aedtVersion)}</span>
                {selectedSpec.noDfe && <span className="is-warning">{t.library.synthNoDfe}</span>}
                {selectedSpec.noEq && <span className="is-warning">{t.library.synthNoEq}</span>}
                {selectedSpec.synth && selectedSpec.parameters.length > 0 && (
                  <details className="model-library__synth-params">
                    <summary>{t.library.synthParamsTitle}</summary>
                    <table className="model-library__table">
                      <thead><tr><th>{t.library.synthColParam}</th><th>{t.library.synthColValue}</th>
                        <th>{t.library.synthColSource}</th></tr></thead>
                      <tbody>{selectedSpec.parameters.map(row => (
                        <tr key={row.key}>
                          <td>{(selectedSpec.noEq && t.library.synthParamNames[`${row.key}_serdes`])
                            || t.library.synthParamNames[row.key] || row.key}</td>
                          <td>{row.value}</td>
                          <td>{row.status === 'user' ? t.library.synthUser : row.source || t.library.synthUnconfirmed}</td>
                        </tr>))}
                      </tbody>
                    </table>
                  </details>
                )}
                {selectedSpec.ccomp && (
                  <div className={`model-library__ccomp is-${selectedSpec.ccomp.level}`}>
                    <strong>{t.library.ccompTitle}{t.apiError.fieldSep}{t.library.ccompLevel[selectedSpec.ccomp.level]}</strong>
                    <span>{selectedSpec.ccomp.level === 'unknown'
                      ? (selectedSpec.ccomp.unknownReason === 'placeholder'
                        ? t.library.ccompZero(selectedSpec.ccomp.cpf || '0')
                        : selectedSpec.ccomp.unknownReason === 'no_ccomp'
                          ? t.library.ccompMissing
                          : t.library.ccompUnknown)
                      : t.library.ccompSummary(selectedSpec.ccomp.cpf, selectedSpec.ccomp.tau,
                        selectedSpec.ccomp.ratio, selectedSpec.ccomp.rate)}</span>
                    {selectedSpec.ccomp.note && <span>{selectedSpec.ccomp.note}</span>}
                    <span>{selectedSpec.synth ? t.library.synthCcompNote : t.library.ccompPlaceholder}</span>
                  </div>
                )}
              </div>
            )}

            {/* IBIS-AMI 的分析路徑在眼圖精靈（ 收掉舊 AMI 頁籤）；多埠分支
                只吃一般 IBIS，所以要指路，不能讓人去那裡找。 */}
            {selected.kind !== 'ibis' && (
              <div className="model-library__notice">
                {t.library.amiRouteHint}</div>
            )}

            <div className="model-library__metrics">
              <div><span>{t.library.ibisVersion}</span><strong>{selected.ibis?.ibis_version || '—'}</strong></div>
              <div><span>{t.library.amiVersion}</span><strong>{Object.values(selected.ami)[0]?.ami_version || '—'}</strong></div>
              <div><span>Component</span><strong>{selected.ibis?.components.length ?? 0}</strong></div>
              <div><span>Model</span><strong>{selected.ibis?.models.length ?? 0}</strong></div>
              <div><span>Pin</span><strong>{selected.ibis?.pins.length ?? 0}</strong></div>
              {/* 純文字模型沒有原生程式庫，就不要在摘要列提示它的存在——
                  一般電路模擬本來就不該看到這套機制。 */}
              {selected.native_libraries.length > 0 && (
                <div><span>{t.library.nativeLibraries}</span><strong>{selected.native_libraries.length}</strong></div>
              )}
            </div>

            {/* 健檢：唯二靜態檢查抓不到的失敗（AMI_Init 拒絕、步階響應算不出）
                只有真的開 AEDT 才現形。一顆按鈕、零設定，結果以 SHA-256 快取。 */}
            <section className="model-library__section">
              <h4>{t.library.healthCheck}</h4>
              <div className="model-library__health">
                {healthRunning ? <span>{t.library.healthMinute}</span>
                  : health?.record ? (() => {
                    // 授權不足、結果無效都不是模型的問題：黃字，不用紅字「失敗」。
                    const view = healthStatusView(health.record, lang)
                    return (
                      <span className={view.tone === 'pass' ? 'is-pass' : view.tone === 'fail' ? 'is-fail' : undefined}
                        style={view.tone === 'warn' ? { color: '#ffd28a' } : undefined}
                        title={view.title}>
                        {view.text}
                      </span>
                    )
                  })() : <span>{t.library.healthNotRun}</span>}
                <button className="btn" onClick={() => void startHealthcheck()}
                  disabled={healthRunning || Boolean(health && !health.applicable) || Boolean(healthBlock)}
                  title={healthBlock || pickText(health, 'blocker', lang) || t.library.healthSolveHint}>
                  {healthRunning ? t.library.healthBusy : t.library.healthReference}
                </button>
                <LicenseTag functions={['model_check']} />
              </div>
              <p className="hint">{t.library.healthInterpretation}</p>
            </section>

            {(selected.source_defects?.length ?? 0) > 0 && (
              <section className="model-library__section">
                <h4>{t.library.sourceDefectsTitle}</h4>
                <p className="hint">{t.library.sourceDefectsHint}</p>
                {selected.source_defects!.map((item, index) => (
                  <div className="model-library__issue is-warning" key={index}>
                    <strong>{t.library.sourceDefectPinLabel(item.component, item.pin, item.signal, item.model)}</strong>
                    <div>{item.missing_models.join(', ')}</div>
                    <div>{item.blocked ? t.library.sourceDefectsUnavailableHint : t.library.sourceDefectsPartialHint}</div>
                    {item.checker_confirmed && <div>{t.library.sourceDefectsCheckerHint}</div>}
                  </div>
                ))}
              </section>
            )}

            {(selected.compatibility.errors.length > 0 || selected.compatibility.warnings.length > 0) && (
              <section className="model-library__section">
                <h4>{t.library.compatibilityPreflight}</h4>
                {/* 一般格式錯誤保留原話；未定義引用另由實際使用的腳位／模型判定。 */}
                {pickList(selected.compatibility, 'errors', lang).map(item => (
                  <div className="model-library__issue is-error" key={item}>{t.library.errorPrefix}{item}</div>
                ))}
                {selected.compatibility.errors.length > 0 && (
                  <p className="hint">
                    {t.library.acceptedErrorsHint}</p>
                )}
                {pickList(selected.compatibility, 'warnings', lang).map(item => (
                  <div className="model-library__issue is-warning" key={item}>{t.library.warningPrefix}{item}</div>
                ))}
              </section>
            )}

            {(() => {
              const all = selected.repairs ?? []
              const auto = all.filter(item => item.kind !== 'needs_user_choice')
              const choices = all.filter(item => item.kind === 'needs_user_choice')
              return (<>
                {auto.length > 0 && (
                  <section className="model-library__section">
                    <h4>{t.library.autoRepairsPrefix}{auto.length} {t.library.itemsSuffix}</h4>
                    <p className="hint">{t.library.autoRepairsHint}</p>
                    {auto.map((item, index) => (
                      <div className="model-library__issue is-warning" key={index}>
                        <strong>{pickText(item, 'detail', lang)}</strong>
                        <div>{pickText(item, 'impact', lang)}</div>
                      </div>
                    ))}
                  </section>
                )}
                {choices.length > 0 && (
                  <section className="model-library__section">
                    <h4>{t.library.userChoicesPrefix}{choices.length} {t.library.itemsSuffix}</h4>
                    <p className="hint">{t.library.userChoicesHint}</p>
                    {choices.map((item, index) => (
                      <div className="model-library__issue is-error" key={index}>
                        <strong>{pickText(item, 'detail', lang)}</strong>
                        <div>{pickText(item, 'impact', lang)}</div>
                      </div>
                    ))}
                  </section>
                )}
              </>)
            })()}

            <section className="model-library__section">
              <h4>{t.library.modelsPins}</h4>
              <div className="model-library__table-wrap">
                <table className="model-library__table">
                  <thead><tr><th>{t.library.roleCandidate}</th><th>Model</th><th>Model Type</th><th>{t.library.pinCount}</th></tr></thead>
                  <tbody>
                    {(selected.ibis?.models || []).map(model => {
                      const type = model.model_type.toLowerCase()
                      const role = /output|3-state|i\/o/.test(type) ? 'Tx' : /input/.test(type) ? 'Rx' : t.library.pending
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
                    ? t.library.nativePending(selected.native_libraries.filter(
                        item => item.trust_status !== 'trusted').length)
                    : t.library.nativeConfirmed(selected.native_libraries.length)}
                </summary>
                <div className="model-library__section-heading">
                  <div>
                    <p>{t.library.nativeTrustHint}</p>
                  </div>
                  <button className="btn" onClick={scanPackage} disabled={Boolean(actionBusy)}>
                    {actionBusy === 'scan' ? t.library.scanning : t.library.scanAll}
                  </button>
                </div>
                <div className="model-library__table-wrap">
                  <table className="model-library__table">
                    <thead><tr><th>{t.library.file}</th><th>{t.library.format}</th><th>{t.library.architecture}</th><th>{t.library.size}</th><th>{t.library.scan}</th><th>{t.library.trust}</th><th>SHA-256</th><th>{t.library.action}</th></tr></thead>
                    <tbody>{selected.native_libraries.map(item => (
                      <tr key={item.sha256}>
                        <td>{item.file}</td><td>{item.format}</td><td>{item.architecture}</td>
                        <td>{formatBytes(item.size_bytes)}</td>
                        <td title={pickText(item, 'message', lang) || item.scanner || ''}>
                          <span className={`model-library__native-state is-${item.scan_status}`}>
                            {scanText[item.scan_status] || item.scan_status}
                          </span>
                        </td>
                        <td>
                          {/* revoked 借用 is-error 的紅色樣式：那是「本來信任、
                              現在不算數」的狀態，視覺上不該和「尚未信任」一樣淡。
                              樣式表另有專屬 class 之前，先對應到現有的紅色。 */}
                          <span className={'model-library__native-state is-'
                            + (item.trust_status === 'revoked' ? 'error' : item.trust_status)}>
                            {trustText[item.trust_status] || item.trust_status}
                          </span>
                        </td>
                        <td>{item.trust_status}</td>
                        <td>{item.trust_status === 'trusted' ? '—' : (
                          <button className="btn model-library__trust-btn"
                            disabled={Boolean(actionBusy) || !['clean', 'unavailable'].includes(item.scan_status)}
                            onClick={() => void trustNative(item)}>
                            {actionBusy === item.sha256 ? t.library.processing : t.library.confirmTrust}
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
              <summary>{t.library.reproducibility}</summary>
              <div><span>IBIS Checker</span><code>{selected.ibis_checker.available
                ? t.library.checkerStatus(selected.ibis_checker.version, selected.ibis_checker.status) : t.library.notFound}</code></div>
            </details>
          </>}
        </main>
      </div>
      </> : null}
      {/* 分析面板切走時只隱藏、不卸載：AMI 要回「模型庫」信任 DLL，
          卸載會把已填的模型、Touchstone 與預檢結果整份清掉（走查）。
          display: contents 讓面板仍是 .model-library 這個 flex 容器的直接子項。
          多埠與 AMI 的舊進階頁籤已收進精靈。 */}
      <div style={{ display: betaEnabled && activePanel === 'wizard' ? 'contents' : 'none' }}>
        {betaMounted && <EyeWizard packages={library?.packages || []} onLibraryChanged={refresh} />}
      </div>
      <div style={{ display: betaEnabled && activePanel === 'toolbox' ? 'contents' : 'none' }}>
        {betaMounted && <><SpisimToolboxPanel /><SerdesCompliancePanel /></>}
      </div>
    </div>
  )
}
