import { confirmMessage, promptMessage } from '../messageDialog'
import { useLengthUnit } from '../lengthContext'
import type { DisplayLengthUnit } from '../lengthUnits'
// 一鍵 HTML 報告中心：快照、品牌、章節、規格、浮水印與輸出。
import { useEffect, useMemo, useRef, useState } from 'react'

import { errorText } from '../backendFields'
import { useT } from '../i18n'
import { messagesFor } from '../i18n/catalog'
import { captureNode } from '../reportCapture'
import { planSourceFields } from '../reportWorkSources'
import {
  COLLECT_STATUSES,
  currentFingerprint,
  currentNetFields,
  formatBytes,
  layoutSources,
  withTimeout,
  crossSectionTables,
  tdrTables,
  supplementalNotices,
  quickEyeTables,
  restoreCollection,
  retryItemIds,
  preprocessingSources,
  resolveItemRenderSource,
  type CollectInputs,
  type CollectPlanItem,
  type CollectStatus,
  type ReportView,
  type CollectionOutcome,
  type SourceEvidence,
  type WorkSource,
} from '../reportCollect'
import { useSessionRef, useSessionState } from '../useSessionState'
import { restoredFieldValue } from '../uiSession'
import { brandAfterSave, resolveReportSessionDraft } from '../reportSessionDraft'
import {
  activateReportSnapshot,
  collectReportItem,
  createReportSnapshot,
  fetchSegmentPreview,
  deleteWatermarkTemplate,
  fileToDataUrl,
  finishReportCollection,
  generateHtmlReport,
  planReportCollection,
  importLegacyWatermarkTemplates,
  listWatermarkTemplates,
  loadReportWorkspace,
  loadReportCollectionState,
  openLatestReport,
  openReportWorkspace,
  saveReportBrand,
  saveReportSettings,
  saveWatermarkTemplate,
  snapshotImageUrl,
  updateReportSnapshot,
} from '../reportApi'
import {
  deleteOutcome,
  isTemplateInUse,
  overwritesTemplate,
  isDeletable,
  LEGACY_TEMPLATE_KEY,
  legacyTemplatesFrom,
  markLegacyMigrated,
  templateLabel,
  templateTime,
  watermarkFromTemplate,
  type WatermarkTemplate,
} from '../watermarkTemplates'
import { fetchLicenseWatermark, licenseWatermarkFrom, LICENSE_WATERMARK_PREVIEW } from '../reportLicenseWatermark'
import {
  chosenReportLocale,
  effectiveReportLocale,
  localeMismatchCount,
  rememberReportLocale,
} from '../reportLocale'
import {
  DEFAULT_REPORT_SETTINGS,
  DEFAULT_WATERMARK,
  REPORT_SECTION_ORDER,
  reportSectionLabel,
  type ReportBrand,
  type ReportManifest,
  type ReportSettings,
  type ReportSnapshot,
  type SnapshotStatus,
  type WatermarkSettings,
} from '../reportTypes'
import '../report.css'
import type { CascadeGraph } from './CascadeSchematic'
import type { PreviewData } from './Preview2D'
import ReportCollectStage, { STAGE_SCALE, type StageJob } from './ReportCollectStage'
import CrossSectionView from './CrossSectionView'
import CrossSectionComparison from './CrossSectionComparison'

/** 報告容器等「畫完」的上限；逾時列失敗並保留重試入口。 */
const STAGE_TIMEOUT_MS = 45000

/** 一鍵收納要用的來源：App 手上的畫面與結果。 */
export interface ReportCollectSources {
  /** 實際來源、分析條件與載入世代；任一改變即停止舊計畫。 */
  contextKey?: string
  /** segments.json；空字串＝沒有分段。 */
  metadataPath: string
  cascadeTouchstone: string
  signalNets: string[]
  refNets: string[]
  /** 目前載入的板子（.aedb）：疊構卡與整板畫面的工作身分。 */
  boardPath: string
  board: PreviewData | null
  cutout: PreviewData | null
  cleanupBefore: PreviewData | null
  cleanup: PreviewData | null
  schematic: CascadeGraph | null
  /** 第 i 段在 `[i - 1]`；只給屬於 `metadataPath` 那一份分段的預覽。 */
  segmentPreviews: (PreviewData | null)[]
  tdrProfiles: { label: string; distance_mm: number[]; impedance_ohm: number[]; source_evidence?: SourceEvidence }[]
  eyeImages: { label: string; path: string; source_evidence?: SourceEvidence }[]
  /** 截面阻抗的切線結果（xsJob.result.cuts）與 TDR 結果：只在記憶體裡，畫成文字表。 */
  crossSectionCuts: any[]
  tdrResult: any
  eyeResult?: any
  views?: ReportView[]
  evidence?: { xs?: SourceEvidence; tdr?: SourceEvidence; eye?: SourceEvidence }
  preprocessing?: Parameters<typeof preprocessingSources>[0]
  /** 有明確目前分析選擇時，僅允許已證實的 run；{} 不採歷史条件。 */
  selectedRuns?: Record<string, string[]> | null
  workSources?: WorkSource[]
  projectBoard?: string
}

interface Props {
  basePath: string
  projectName: string
  onWorkspaceChange?: (workspace: string) => void
  /** 這份報告所依據的通道 Touchstone。給了報告才會有「模型品質與判定依據」
   *  一節；沒有串接結果時是空字串，那一節就不會出現。 */
  channelTouchstone?: string
  collect?: ReportCollectSources
}

type ReportTab = 'snapshots' | 'brand' | 'content' | 'watermark' | 'export'

const EMPTY_BRAND: ReportBrand = {
  company_name: '', department: '', project_name: '', customer_name: '',
  report_number: '', logo_file: '',
}

const STATUS_ORDER: SnapshotStatus[] = ['pass', 'attention', 'fail', 'display']
const REPORT_TABS: ReportTab[] = ['snapshots', 'brand', 'content', 'watermark', 'export']

function normalizedSettings(value: Partial<ReportSettings> | undefined): ReportSettings {
  return {
    ...DEFAULT_REPORT_SETTINGS,
    ...(value || {}),
    // `null`／缺欄位＝沒設定過，塞回預設清單；`[]`＝使用者明確一節都不要。
    // 後端（reporting.py，manifest schema 2）對新工作區寫 `"sections": null`，
    // 舊工作區的 `[]` 會在讀取時翻成 `null`，而明確的 `[]` 產出的報告就是
    // 沒有選配章節——所以這裡必須用 `??`，不能用長度判斷，否則「全部取消」
    // 會被塞回全選。
    sections: value?.sections ?? REPORT_SECTION_ORDER,
    acceptance_criteria: value?.acceptance_criteria || {},
    watermark: { ...DEFAULT_WATERMARK, ...(value?.watermark || {}) },
  }
}

export default function ReportCenter({ basePath, projectName, onWorkspaceChange, channelTouchstone, collect }: Props) {
  const { t, lang } = useT()
  const { unit } = useLengthUnit()
  const r = t.report
  const why = (error: unknown) => errorText(error, lang)
  const [tab, setTab] = useSessionState<ReportTab>('report.tab', 'snapshots')
  const [workspaceInput, setWorkspaceInput] = useSessionState('report.workspaceInput', basePath)
  const [workspace, setWorkspace] = useState('')
  const workspaceRequest = useRef(0)
  const latestWorkspace = useRef('')
  latestWorkspace.current = workspace
  const [manifest, setManifest] = useState<ReportManifest | null>(null)
  const [brand, setBrand] = useSessionState<ReportBrand>('report.brand', { ...EMPTY_BRAND, project_name: projectName })
  const [settings, setSettings] = useSessionState<ReportSettings>('report.settings',
    () => ({ ...DEFAULT_REPORT_SETTINGS, locale: effectiveReportLocale(lang) }))
  const [logoDataUrl, setLogoDataUrl] = useSessionState('report.logoDataUrl', '')
  const [watermarkDataUrl, setWatermarkDataUrl] = useSessionState('report.watermarkDataUrl', '')
  const draftWorkspace = useSessionRef('report.draftWorkspace', '')
  // 僅初次接回工作區採用快照。手動換案仍載入該案自己的品牌／設定。
  const restoredDraft = useRef({
    brand: restoredFieldValue<ReportBrand | undefined>('report.brand', undefined),
    settings: restoredFieldValue<ReportSettings | undefined>('report.settings', undefined),
    logoDataUrl: restoredFieldValue<string | undefined>('report.logoDataUrl', undefined),
    watermarkDataUrl: restoredFieldValue<string | undefined>('report.watermarkDataUrl', undefined),
  })
  // 匯出目的地以後端回傳的工作區為索引；舊版共用欄位無法證實歸屬，不自動沿用。
  const [outputPaths, setOutputPaths] = useSessionState<Record<string, string>>('report.outputPaths', {})
  const outputPath = outputPaths[workspace] || ''
  const setOutputPath = (value: string) => {
    if (workspace) setOutputPaths(current => ({ ...current, [workspace]: value }))
  }
  const [busy, setBusy] = useState(false)
  const [message, setMessageState] = useState<{ text: string; error: boolean }>({ text: '', error: false })
  // 紅字由呼叫端表明（setFailure），不再看訊息裡有沒有「失敗」——切到英文後那個字就不在了。
  const setMessage = (text: string) => setMessageState({ text, error: false })
  const setFailure = (text: string) => setMessageState({ text, error: true })
  const [lastOutput, setLastOutput] = useState('')
  const [watermarkTemplates, setWatermarkTemplates] = useState<WatermarkTemplate[]>([])
  // licensed 包由後端固定加授權身分標示（／LS02）；畫面照實顯示、停用被忽略的控制。
  const [licenseMark, setLicenseMark] = useState(() => licenseWatermarkFrom(null))
  useEffect(() => {
    void fetchLicenseWatermark().then(mark => { if (mark) setLicenseMark(mark) })
  }, [])
  const [templateStore, setTemplateStore] = useState('')
  const defaultProject = projectName || r.defaultProject

  /** 工作區存的設定；報告語言不取 manifest 的（分不出是選的還是出廠預設），
   *  一律「選過就照選的，否則跟介面語言」。 */
  const applySettings = (value: Partial<ReportSettings> | undefined) =>
    setSettings({ ...normalizedSettings(value), locale: effectiveReportLocale(lang) })

  // 沒選過報告語言時，切換介面語言就跟著換。
  useEffect(() => {
    if (!chosenReportLocale()) setSettings(current => ({ ...current, locale: lang }))
  }, [lang])

  const refresh = async (target = workspace) => {
    if (!target || target !== latestWorkspace.current) return
    const requestId = ++workspaceRequest.current
    const result = await loadReportWorkspace(target)
    if (requestId !== workspaceRequest.current || target !== latestWorkspace.current) return
    setWorkspace(result.workspace)
    setManifest(result.manifest)
    setCollectOutcome(restoreCollection(result.manifest.collection))
    // 更新截圖／圖說只重新讀 manifest，不洗掉尚未按儲存的品牌與設定。
    onWorkspaceChange?.(result.workspace)
    return result
  }

  /** 手動切換到別的工作區。留空＝回到預設目錄。 */
  const openWorkspace = async () => {
    const requestId = ++workspaceRequest.current
    stopRequested.current = true
    collectionAbort.current?.abort()
    setCollectOutcome(null)
    setShowCollectList(false)
    setCollectProgress(null)
    setBusy(true)
    try {
      const result = await openReportWorkspace(workspaceInput, defaultProject)
      if (requestId !== workspaceRequest.current) return
      setLastOutput('')
      setWorkspace(result.workspace)
      draftWorkspace.current = result.workspace
      setManifest(result.manifest)
      setCollectOutcome(restoreCollection(result.manifest.collection))
      setBrand({ ...EMPTY_BRAND, ...result.brand_profile, ...result.manifest.brand })
      setLogoDataUrl(!result.manifest.brand.logo_file ? result.brand_profile.logo_data_url || '' : '')
      setWatermarkDataUrl('')
      applySettings(result.manifest.settings)
      setMessage(r.workspaceOpened(result.workspace))
      onWorkspaceChange?.(result.workspace)
    } catch (error) {
      if (requestId === workspaceRequest.current) setFailure(r.openWorkspaceFailed(why(error)))
    } finally {
      if (requestId === workspaceRequest.current) setBusy(false)
    }
  }

  useEffect(() => {
    let disposed = false
    if (!workspace) {
      // basePath 為空也要開：只載入一個外部 .sNp 來看曲線時，分段輸出、裁切
      // 輸出、輸入檔全都是空的，但那時候一樣會想存快照。後端收到空字串會退到
      // 預設目錄（Documents/PCB_SI_報告），使用者不必自己指定。
      const hasDraft = Object.values(restoredDraft.current).some(value => value !== undefined)
      const target = hasDraft ? draftWorkspace.current || basePath : basePath
      if (basePath && !hasDraft) setWorkspaceInput(basePath)
      const requestId = ++workspaceRequest.current
      void openReportWorkspace(target, defaultProject).then(result => {
        if (disposed || requestId !== workspaceRequest.current) return
        setWorkspace(result.workspace)
        draftWorkspace.current = result.workspace
        setManifest(result.manifest)
        setCollectOutcome(restoreCollection(result.manifest.collection))
        const draft = resolveReportSessionDraft({
          brand: { ...EMPTY_BRAND, ...result.brand_profile, ...result.manifest.brand },
          settings: { ...normalizedSettings(result.manifest.settings), locale: effectiveReportLocale(lang) },
          logoDataUrl: !result.manifest.brand.logo_file ? result.brand_profile.logo_data_url || '' : '',
          watermarkDataUrl: '',
        }, restoredDraft.current)
        setBrand(draft.brand)
        setSettings(draft.settings)
        setLogoDataUrl(draft.logoDataUrl)
        setWatermarkDataUrl(draft.watermarkDataUrl)
        if (!hasDraft) setWorkspaceInput(result.workspace)
        onWorkspaceChange?.(result.workspace)
      }).catch(error => {
        // 吞掉的話畫面只會寫「工作區：尚未開啟」，一個字都不說為什麼；
        // 而且 `workspace` 一直是空的，App 每次重繪都會再 POST 一次。
        if (!disposed && requestId === workspaceRequest.current) setFailure(r.openWorkspaceFailed(why(error)))
      })
    }
    return () => { disposed = true }
    // `onWorkspaceChange` 在 App 那邊每次 render 都是新的函式（沒有包
    // useCallback，見 Handoff），列進相依會讓這個 effect 一直重跑。開工作區
    // 只跟 basePath／projectName／是否已開有關。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, projectName, workspace])

  /** 浮水印範本：先把舊版 localStorage 的搬到後端，再讀清單。 */
  const reloadTemplates = async () => {
    const result = await listWatermarkTemplates()
    setWatermarkTemplates(result.templates)
    setTemplateStore(result.store_path)
  }

  useEffect(() => {
    void (async () => {
      try {
        const legacy = legacyTemplatesFrom(window.localStorage.getItem(LEGACY_TEMPLATE_KEY))
        if (legacy.length) {
          const result = await importLegacyWatermarkTemplates(legacy)
          // 尚有未搬入項目時保留原 key，騰出容量後重新開報告中心可再試。
          if (!result.skipped) markLegacyMigrated(window.localStorage)
          if (result.skipped) setFailure(r.templateImportSkipped(result.imported, result.skipped))
          else if (result.imported) setMessage(r.templateImported(result.imported))
        }
        await reloadTemplates()
      } catch (error) {
        setFailure(r.templateLoadFailed(why(error)))
      }
    })()
    // 只在開啟報告中心時做一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ workspace?: string }>
      if (custom.detail?.workspace === latestWorkspace.current) void refresh(custom.detail.workspace)
    }
    window.addEventListener('pcbsi-report-snapshot-saved', listener)
    return () => window.removeEventListener('pcbsi-report-snapshot-saved', listener)
  })

  const groups = useMemo(() => {
    const result = new Map<string, ReportSnapshot[]>()
    for (const snapshot of manifest?.snapshots || []) {
      const rows = result.get(snapshot.kind) || []
      rows.push(snapshot)
      result.set(snapshot.kind, rows.sort((a, b) => b.version - a.version))
    }
    return [...result.entries()]
  }, [manifest])

  const activeSnapshots = useMemo(
    () => (manifest?.snapshots || []).filter(item => item.active && item.selected),
    [manifest],
  )
  const staleCount = activeSnapshots.filter(item => item.stale).length
  // 截圖拍的是當下介面語言：和報告語言不同時，產生前就先提醒（後端產生時也會再算一次）。
  const mismatchCount = localeMismatchCount(activeSnapshots, settings.locale)

  const patchSnapshot = async (
    snapshot: ReportSnapshot,
    changes: Partial<Pick<ReportSnapshot, 'caption' | 'engineering_status' | 'section' | 'selected'>>,
  ) => {
    if (!workspace) return
    try {
      await updateReportSnapshot(workspace, snapshot.id, changes)
      await refresh()
    } catch (error) {
      setFailure(r.updateSnapshotFailed(why(error)))
    }
  }

  const openLatest = async () => {
    if (!workspace) return
    try {
      const result = await openLatestReport(workspace)
      setMessage(r.openedReport(result.opened))
    } catch (error) {
      setFailure(r.openLatestFailed(why(error)))
    }
  }

  // 這兩個都是 `void …(…)` 叫的，沒有 catch 就等於「按了什麼都沒發生」：
  // 12 MB 的截圖被後端以 400 擋掉、manifest 讀不到、版本數滿了回 409——
  // 使用者只會看到對話框關掉、畫面沒變，錯誤躺在主控台裡。與 patchSnapshot
  // 同一套 try/catch → setMessage。
  const useVersion = async (snapshot: ReportSnapshot) => {
    if (!workspace) return
    try {
      await activateReportSnapshot(workspace, snapshot.id)
      await refresh()
    } catch (error) {
      setFailure(r.activateFailed(why(error)))
    }
  }

  const uploadExternal = async (file: File | undefined) => {
    if (!file || !workspace) return
    try {
      // 工具輸入框有「取消」：取消／Esc 就不上傳（AB，取消不執行）；空白圖說仍可按確定上傳。
      const caption = await promptMessage(r.externalCaptionPrompt, file.name)
      if (caption === null) return
      const dataUrl = await fileToDataUrl(file)
      const payload = {
        workspace, kind: `external-${Date.now()}`, title: file.name,
        image_data_url: dataUrl, caption, engineering_status: 'display' as const,
        section: 'external', external: true,
      }
      try {
        await createReportSnapshot(payload)
      } catch (error) {
        // 409＝版本數已滿。與快照按鈕一樣，問過使用者才刪最舊的那一版。
        const typed = error as Error & { status?: number }
        if (typed.status !== 409
          || !await confirmMessage(r.pruneConfirm(why(error)))) throw error
        await createReportSnapshot({ ...payload, prune_confirmed: true })
      }
      await refresh()
      setMessage(r.externalAdded(file.name))
    } catch (error) {
      setFailure(r.externalFailed(why(error)))
    }
  }

  const saveBrand = async () => {
    if (!workspace) return
    setBusy(true)
    try {
      await saveReportBrand(workspace, brand, logoDataUrl, true)
      const result = await refresh()
      setBrand(current => brandAfterSave(current, result?.manifest.brand))
      setLogoDataUrl('')
      setMessage(r.brandSaved)
    } catch (error) {
      setFailure(r.saveBrandFailed(why(error)))
    } finally {
      setBusy(false)
    }
  }

  const saveAllSettings = async (): Promise<ReportSettings> => {
    if (!workspace) throw new Error(r.openWorkspaceFirst)
    const next = {
      ...settings,
      length_unit: unit,
      watermark: {
        ...settings.watermark,
        ...(watermarkDataUrl ? { image_data_url: watermarkDataUrl } : {}),
      },
    }
    const response = await saveReportSettings(workspace, next)
    const saved = normalizedSettings(response.settings)
    setSettings(saved)
    setWatermarkDataUrl('')
    return saved
  }

  const generate = async (overwriteConfirmed = false, frozenUnit = unit) => {
    if (!workspace) return
    if (activeSnapshots.length === 0 && !await confirmMessage(r.noActiveConfirm)) return
    if (staleCount && !await confirmMessage(r.staleConfirm(staleCount))) return
    setBusy(true)
    setMessage(r.generating)
    try {
      await saveReportBrand(workspace, brand, logoDataUrl, false)
      const savedSettings = await saveAllSettings()
      const result = await generateHtmlReport(
        workspace, { ...savedSettings, length_unit: frozenUnit }, outputPath, overwriteConfirmed, channelTouchstone || '', frozenUnit)
      setLastOutput(result.output_path)
      const mismatch = result.locale_mismatch_count || 0
      setMessage(r.generated(result.output_path, result.snapshot_count)
        + (mismatch ? `\n${r.localeMismatch(mismatch)}` : ''))
      await refresh()
    } catch (error) {
      const typed = error as Error & { status?: number }
      if (typed.status === 409 && !overwriteConfirmed && await confirmMessage(r.overwriteConfirm(why(error)))) {
        setBusy(false)
        await generate(true, frozenUnit)
        return
      }
      setFailure(r.generateFailed(why(error)))
    } finally {
      setBusy(false)
    }
  }

  // ── 一鍵收納所有快照─────────────────────────────────────
  const [collecting, setCollecting] = useState(false)
  const [collectProgress, setCollectProgress] = useState<{ done: number; total: number; title: string } | null>(null)
  const [collectOutcome, setCollectOutcome] = useState<CollectionOutcome | null>(null)
  const [showCollectList, setShowCollectList] = useState(false)
  const [stageJob, setStageJob] = useState<StageJob | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stageWaiters = useRef(new Map<string, { resolve: () => void; reject: (error: unknown) => void }>())
  const stopRequested = useRef(false)
  const collectionAbort = useRef<AbortController | null>(null)
  const stageSequence = useRef(0)

  const collectInputs = (lengthUnit: DisplayLengthUnit = unit): CollectInputs => ({
    metadataPath: collect?.metadataPath, boardPath: collect?.boardPath,
    projectBoard: collect?.projectBoard || collect?.boardPath,
    signalNets: collect?.signalNets, refNets: collect?.refNets,
    board: collect?.board, cutout: collect?.cutout,
    cleanupBefore: collect?.cleanupBefore, cleanup: collect?.cleanup,
    schematic: collect?.schematic, segmentPreviews: collect?.segmentPreviews || [],
    views: [...(collect?.views || []), ...preprocessingSources(collect?.preprocessing || {
      hasCutout: false, hasCleanup: false, hasSegments: false }, settings.locale, lengthUnit).views],
  })
  const latestCollectInputs = useRef<CollectInputs>({})
  latestCollectInputs.current = collectInputs()
  const collectContext = JSON.stringify([workspace, settings.locale, channelTouchstone,
    collect?.contextKey, collect?.boardPath, collect?.metadataPath, collect?.cascadeTouchstone,
    collect?.signalNets, collect?.refNets, collect?.tdrProfiles, collect?.eyeImages,
    collect?.crossSectionCuts, collect?.tdrResult, collect?.eyeResult, collect?.views,
    collect?.evidence, collect?.preprocessing, collect?.selectedRuns, collect?.workSources, collect?.projectBoard])
  const latestCollectContext = useRef('')
  latestCollectContext.current = collectContext
  useEffect(() => {
    if (collecting) { stopRequested.current = true; collectionAbort.current?.abort() }
  }, [collectContext])
  useEffect(() => () => {
    stopRequested.current = true
    collectionAbort.current?.abort()
  }, [])

  /** 掛到報告專用容器、等畫好、拍下來。一次只畫一張（記憶體）。 */
  const renderOnStage = async (job: StageJob): Promise<string> => {
    const ready = new Promise<void>((resolve, reject) => stageWaiters.current.set(job.id, { resolve, reject }))
    setStageJob(job)
    try {
      // 元件一直沒回報畫完（空資料、容器量到 0）就讓這一項失敗，整批繼續。
      await withTimeout(ready, STAGE_TIMEOUT_MS, r.collectRenderTimeout, collectionAbort.current?.signal)
    } finally {
      stageWaiters.current.delete(job.id)
    }
    const node = stageRef.current
    if (!node || node.dataset.collectJob !== job.id) throw new Error('stage not ready')
    return withTimeout(captureNode(node, STAGE_SCALE), STAGE_TIMEOUT_MS,
      r.collectRenderTimeout, collectionAbort.current?.signal)
  }

  const renderItem = async (item: CollectPlanItem, lengthUnit: DisplayLengthUnit): Promise<string> => {
    if (!collect) throw new Error('no sources')
    const source = await resolveItemRenderSource(item, collectInputs(lengthUnit),
      (metadataPath, index) => withTimeout(fetchSegmentPreview(metadataPath, index, lengthUnit), STAGE_TIMEOUT_MS,
        r.collectRenderTimeout, collectionAbort.current?.signal), settings.locale)
    const base = { id: `${item.item_id}-${++stageSequence.current}`, title: item.title, lengthUnit,
      signalNets: source.signalNets, refNets: source.refNets }
    if (item.target === 'extra_view') {
      const view = source.view
      if (!view) throw new Error(r.collectStatus.missing)
      if (view.type === 'tdr_location') return renderOnStage({ ...base,
        scene: view.data.scene, tdrMarkers: view.data.markers })
      if (view.type === 'cutout_range') return renderOnStage({ ...base,
        scene: view.data.before, cutoutBoundary: view.data.boundary, cutoutExtent: view.data.extent_type })
      if (view.type === 'crosssection') return renderOnStage({ ...base,
        content: <CrossSectionView scan={view.data} roleOverrides={{}} onRoleOverride={() => {}} busy reportMode /> })
      const { result, tdr } = view.data
      const analysis = tdr.analyses[0]
      return renderOnStage({ ...base, content: <CrossSectionComparison result={result}
        tdrDistanceMm={analysis.distance_mm} tdrImpedanceOhm={tdr.impedance_ohm}
        pathLengthMm={tdr.path_length_mm} xMaxMm={analysis.display_cap_mm} /> })
    }
    if (item.target === 'schematic') return renderOnStage({ ...base, graph: source.graph as CascadeGraph })
    return renderOnStage({ ...base, scene: source.scene as PreviewData })
  }

  const countsText = (counts: Record<CollectStatus, number>) => COLLECT_STATUSES
    .filter(status => counts[status])
    .map(status => `${r.collectStatus[status]} ${counts[status]}`)
    .join(' · ')

  const runCollect = async (retry = false) => {
    let frozenUnit = unit
    if (!workspace || !collect || collecting) return
    const c = messagesFor(settings.locale === 'en' ? 'en' : 'zh-TW').report
    stopRequested.current = false
    collectionAbort.current = new AbortController()
    setCollecting(true)
    const prior = retry ? collectOutcome : null
    if (!retry) setCollectOutcome(null)
    setMessage(r.collectPlanning)
    const started = performance.now()
    let planId = ''
    try {
      const requestedIds = retry ? retryItemIds(prior) : []
      let savedRequest: Parameters<typeof planReportCollection>[0] | undefined
      if (retry) {
        if (!prior?.plan_id || !requestedIds.length) throw new Error(r.collectStatus.missing)
        const saved = await loadReportCollectionState(workspace)
        frozenUnit = saved.request?.length_unit ?? 'mm'
        if (saved.plan_id !== prior.plan_id) throw new Error(r.collectStatus.source_changed)
        const currentSources = collect.boardPath || collect.metadataPath || collect.cascadeTouchstone
          || collect.board || collect.cutout || collect.cleanup || collect.schematic
          || collect.tdrResult || collect.eyeResult || collect.crossSectionCuts.length
          || collect.selectedRuns != null || collect.preprocessing?.cutout || collect.preprocessing?.cleanup
        if (!currentSources) {
          if (!saved.request) throw new Error(c.collectRetrySourcesMissing)
          savedRequest = saved.request
        }
      }
      const preprocessing = preprocessingSources(collect.preprocessing || {
        hasCutout: false, hasCleanup: false, hasSegments: false }, settings.locale, frozenUnit)
      const missingEvidence = (key: string, section: string, label: string) => ({ key, section, label,
        status: 'missing' as const, reason: c.collectSourceReceiptMissing })
      const plan = await planReportCollection({
        workspace, locale: settings.locale, length_unit: frozenUnit,
        selected_runs: collect.selectedRuns ?? null,
        ...planSourceFields({ boardPath: collect.boardPath, projectBoard: collect.projectBoard,
          metadataPath: collect.metadataPath, cascadeTouchstone: collect.cascadeTouchstone,
          channelTouchstone: channelTouchstone || '', signalNets: collect.signalNets,
          refNets: collect.refNets, workSources: collect.workSources }),
        layouts: layoutSources(collectInputs(frozenUnit)),
        tdr_profiles: collect.tdrProfiles, eye_images: collect.eyeImages,
        tables: [
          ...(collect.evidence?.xs ? crossSectionTables(collect.crossSectionCuts, settings.locale, frozenUnit).map(table => ({ ...table, source_evidence: collect.evidence!.xs })) : []),
          ...(collect.evidence?.tdr ? tdrTables(collect.tdrResult, settings.locale, frozenUnit).map(table => ({ ...table, source_evidence: collect.evidence!.tdr })) : []),
          ...(collect.evidence?.eye ? quickEyeTables(collect.eyeResult, settings.locale).map(table => ({ ...table, source_evidence: collect.evidence!.eye })) : []),
          ...preprocessing.tables,
        ],
        frontend_views: collectInputs(frozenUnit).views?.map(({ key, section, label, fingerprint, source_evidence }) => ({ key, section, label, fingerprint, source_evidence })),
        missing_sources: [
          ...supplementalNotices(collect.crossSectionCuts, collect.tdrResult, collect.views || [], settings.locale),
          ...preprocessing.notices,
          ...(!collect.evidence?.xs ? collect.crossSectionCuts.map(cut => missingEvidence(`xs-receipt-${cut.name}`, 'crosssection', c.collectQ2dTitle(cut.name))) : []),
          ...(collect.tdrResult && !collect.evidence?.tdr ? [missingEvidence('tdr-receipt', 'tdr', 'TDR')] : []),
          ...(collect.eyeResult && !collect.evidence?.eye ? [missingEvidence('eye-receipt', 'eye', 'QuickEye')] : []),
        ],
        ...savedRequest,
        ...(retry ? { retry_plan_id: prior!.plan_id, retry_item_ids: requestedIds } : {}),
      })
      if (retry && (plan.plan_id !== prior!.plan_id
        || plan.items.some(item => !requestedIds.includes(item.item_id)))) {
        // 舊後端忽略 retry 入參或把成功項重新排入時，拒絕執行，避免重拍。
        throw new Error(r.collectStatus.source_changed)
      }
      planId = plan.plan_id
      const runnable = plan.items.filter(item => item.status === 'pending')
      // 逐項串行：同時拍好幾張高解析圖會把記憶體吃光（研究草稿第 5 節）。
      for (let index = 0; index < runnable.length; index += 1) {
        if (latestCollectContext.current !== collectContext) stopRequested.current = true
        if (stopRequested.current) break
        const item = runnable[index]
        setCollectProgress({ done: index, total: runnable.length, title: item.title })
        const payload: Parameters<typeof collectReportItem>[0] = {
          workspace, plan_id: planId, item_id: item.item_id, length_unit: frozenUnit,
        }
        if (item.renderer === 'frontend') {
          payload.fingerprint = currentFingerprint(item, latestCollectInputs.current)
          // net 和分段紀錄不同時 renderItem 會丟錯，所以在畫圖之前就帶上。
          Object.assign(payload, currentNetFields(latestCollectInputs.current))
          if (!item.reusable) {
            try {
              payload.image_data_url = await renderItem(item, frozenUnit)
              payload.fingerprint = currentFingerprint(item, latestCollectInputs.current)
              if (latestCollectContext.current !== collectContext) {
                payload.fingerprint = 'source-context-changed'
                stopRequested.current = true
              }
            } catch (error) {
              payload.error = why(error)
            }
          }
        }
        // 停止發生在等待字型／Canvas／圖片期間，不把未完成項當擷取失敗寫入。
        if (stopRequested.current || latestCollectContext.current !== collectContext) break
        await collectReportItem(payload)
      }
      const cancelled = stopRequested.current
      const summary = await finishReportCollection(workspace, planId, cancelled)
      const seconds = Math.round((performance.now() - started) / 1000)
      if (latestCollectContext.current === collectContext) {
        setCollectOutcome({ ...summary, plan_id: planId, seconds, cancelled })
        await refresh()
      }
      if (latestWorkspace.current === workspace) setMessage(cancelled ? r.collectStopped(countsText(summary.counts))
        : r.collectSummary(countsText(summary.counts), seconds))
    } catch (error) {
      if (latestWorkspace.current === workspace) setFailure(r.collectFailed(why(error)))
      // 收尾也失敗（後端已停）時把原因接在後面，不靜默吞掉。
      if (planId) {
        try {
          await finishReportCollection(workspace, planId, true)
        } catch (finishError) {
          if (latestWorkspace.current === workspace) setFailure(r.collectFinishFailed(why(error), why(finishError)))
        }
      }
    } finally {
      setCollecting(false)
      setCollectProgress(null)
      setStageJob(null)
    }
  }

  const stopCollect = () => { stopRequested.current = true; collectionAbort.current?.abort() }
  const collectRetryable = retryItemIds(collectOutcome).length

  const setCriteria = (key: string, value: string) => setSettings(current => ({
    ...current,
    acceptance_criteria: { ...current.acceptance_criteria, [key]: value },
  }))

  const insertWatermarkVariable = (variable: string) => setSettings(current => ({
    ...current,
    watermark: { ...current.watermark, text: `${current.watermark.text}${variable}` },
  }))

  const saveAsTemplate = async () => {
    const name = (await promptMessage(r.templateNamePrompt, r.templateDefaultName))?.trim()
    if (!name) return
    if (overwritesTemplate(watermarkTemplates, name) && !await confirmMessage(r.templateOverwriteConfirm(name))) return
    try {
      const { template } = await saveWatermarkTemplate(name, settings.watermark, watermarkDataUrl, workspace)
      await reloadTemplates()
      setSettings(current => ({ ...current, watermark: { ...current.watermark, template_id: template.id } }))
      setMessage(r.templateSaved(template.name))
    } catch (error) {
      setFailure(r.templateSaveFailed(why(error)))
    }
  }

  const applyWatermarkTemplate = (template: WatermarkTemplate) => {
    setSettings(current => ({ ...current, watermark: watermarkFromTemplate(current.watermark, template) }))
    setWatermarkDataUrl(template.image_data_url || '')
    setMessage(r.templateApplied(templateLabel(template, lang)))
  }

  const removeWatermarkTemplate = async (template: WatermarkTemplate) => {
    const outcome = deleteOutcome(template, settings.watermark, watermarkDataUrl)
    if (!outcome.allowed) return
    const name = templateLabel(template, lang)
    if (!await confirmMessage(r.templateDeleteConfirm(name, outcome.resetToDefault))) return
    try {
      await deleteWatermarkTemplate(template.id)
      // DELETE 已成功，直接同步本地清單；後續 GET 失敗不應被報成刪除失敗。
      setWatermarkTemplates(current => current.filter(item => item.id !== template.id))
      if (outcome.resetToDefault) {
        // 回預設但「啟用」不動：刪範本不該順手把浮水印關掉或打開。
        setSettings(current => ({
          ...current, watermark: { ...DEFAULT_WATERMARK, enabled: current.watermark.enabled },
        }))
        setWatermarkDataUrl('')
        setMessage(r.templateDeletedInUse(name))
      } else {
        setMessage(r.templateDeleted(name))
      }
    } catch (error) {
      setFailure(r.templateDeleteFailed(why(error)))
    }
  }

  const textFields: [keyof ReportSettings, string][] = [
    ['purpose', r.purpose], ['summary', r.summary],
    ['conclusion', r.conclusion], ['recommendations', r.recommendations],
  ]
  const vars = r.watermarkVars
  const watermarkVariables = [vars.company, vars.customer, vars.project,
    vars.reportNumber, vars.date, vars.confidentiality]

  return (
    <div className="report-center">
      <div className="report-center__header">
        <div><h2>{r.title}</h2><div>{r.subtitle}</div></div>
        <div className="report-workspace-open">
          <input aria-label={r.workspaceAria}
            value={workspaceInput} onChange={event => setWorkspaceInput(event.target.value)}
            placeholder={r.workspacePlaceholder} />
          <button className="btn" disabled={busy} onClick={openWorkspace}>{r.switchWorkspace}</button>
        </div>
      </div>
      <div className="report-summary-strip">
        <span>{r.workspaceIs(workspace || r.notOpened)}</span>
        <span>{r.activeCount(activeSnapshots.length)}</span>
        <span className={staleCount ? 'warn' : ''}>{r.staleCount(staleCount)}</span>
        <span>{r.exportCount(manifest?.exports?.length || 0)}</span>
      </div>
      <div className="report-tabs">
        {REPORT_TABS.map(key => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{r.tabs[key]}</button>
        ))}
      </div>

      <div className="report-center__body">
        {tab === 'snapshots' && (
          <div>
            <div className="report-toolbar-row">
              <strong>{r.snapshotsHint}</strong>
              {collect && (
                <button className="btn btn--primary" disabled={!workspace || busy || collecting}
                  title={r.collectTip} onClick={() => void runCollect()}>{r.collectAll}</button>
              )}
              <label className="btn report-file-button">{r.addExternal}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml"
                  onChange={event => { void uploadExternal(event.target.files?.[0]); event.currentTarget.value = '' }} />
              </label>
            </div>
            {collect && (collecting || collectOutcome) && (
              <div className="report-collect" data-report-ignore="true">
                {collecting && (
                  <div className="report-collect__row">
                    <span>{collectProgress
                      ? r.collectProgress(collectProgress.done + 1, collectProgress.total, collectProgress.title)
                      : r.collectPlanning}</span>
                    <button className="btn" onClick={stopCollect}>{r.collectStop}</button>
                  </div>
                )}
                {!collecting && collectOutcome && (
                  <>
                    <div className="report-collect__row">
                      <span>{collectOutcome.cancelled
                        ? r.collectStopped(countsText(collectOutcome.counts))
                        : collectOutcome.seconds == null ? countsText(collectOutcome.counts)
                          : r.collectSummary(countsText(collectOutcome.counts), collectOutcome.seconds)}</span>
                    </div>
                    {collectOutcome.image_bytes != null && collectOutcome.embedded_estimate_bytes != null
                      && collectOutcome.limit_bytes != null && <div className={collectOutcome.over_limit ? 'report-collect__row warn' : 'report-collect__row'}>
                      <span>{r.collectSize(formatBytes(collectOutcome.image_bytes),
                        formatBytes(collectOutcome.embedded_estimate_bytes), formatBytes(collectOutcome.limit_bytes))}</span>
                      {collectOutcome.over_limit && <b>{r.collectOverLimit}</b>}
                    </div>}
                    <div className="report-collect__row">
                      <button className="btn" onClick={() => setShowCollectList(value => !value)}>
                        {showCollectList ? r.collectHideList : r.collectList}</button>
                      {collectRetryable > 0 && (
                          <button className="btn" onClick={() => void runCollect(true)}>{r.collectRetry}</button>
                      )}
                    </div>
                    {showCollectList && (
                      <table className="report-collect__list">
                        <tbody>
                          {collectOutcome.items.map(row => (
                            <tr key={row.item_id} className={`collect-${row.status}`}>
                              <td>{row.title}</td>
                              <td>{r.collectStatus[row.status] || row.status}</td>
                              <td>{row.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </div>
            )}
            {groups.length === 0 && <div className="report-empty">{r.noSnapshots}</div>}
            {groups.map(([kind, versions]) => (
              <div className="report-snapshot-group" key={kind}>
                <h3>{versions[0]?.title || kind}<small>{kind}</small></h3>
                <div className="report-snapshot-grid">
                  {versions.map(snapshot => (
                    <article key={snapshot.id} className={`report-snapshot-card ${snapshot.active ? 'active' : ''}`}>
                      <div className="report-thumb-wrap">
                        <img src={snapshotImageUrl(workspace, snapshot.id)} alt={snapshot.title} />
                        <span>v{snapshot.version}</span>
                        {snapshot.stale && <b>{r.staleBadge}</b>}
                      </div>
                      <div className="report-snapshot-fields">
                        <small>{snapshot.length_unit ?? t.lengthUi.legacyUnit}</small>
                        <select aria-label={r.statusAria(snapshot.title)} value={snapshot.engineering_status}
                          onChange={event => void patchSnapshot(snapshot, { engineering_status: event.target.value as SnapshotStatus })}>
                          {STATUS_ORDER.map(value => <option key={value} value={value}>{r.status[value]}</option>)}
                        </select>
                        <select aria-label={r.sectionAria(snapshot.title)} value={snapshot.section}
                          onChange={event => void patchSnapshot(snapshot, { section: event.target.value })}>
                          {REPORT_SECTION_ORDER.map(section => <option key={section} value={section}>{reportSectionLabel(t, section)}</option>)}
                        </select>
                        <textarea aria-label={r.captionAria(snapshot.title)} value={snapshot.caption} rows={3}
                          onChange={event => setManifest(current => current ? {
                            ...current,
                            snapshots: current.snapshots.map(item => item.id === snapshot.id ? { ...item, caption: event.target.value } : item),
                          } : current)}
                          onBlur={event => void patchSnapshot(snapshot, { caption: event.target.value })} />
                        <label><input type="checkbox" checked={snapshot.selected}
                          onChange={event => void patchSnapshot(snapshot, { selected: event.target.checked })} /> {r.includeInReport}</label>
                        {!snapshot.active && <button className="btn" onClick={() => void useVersion(snapshot)}>{r.useThisVersion}</button>}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'brand' && (
          <div className="report-form-grid">
            <label>{r.companyName}<input value={brand.company_name} onChange={event => setBrand({ ...brand, company_name: event.target.value })} /></label>
            <label>{r.department}<input value={brand.department} onChange={event => setBrand({ ...brand, department: event.target.value })} /></label>
            <label>{r.projectName}<input value={brand.project_name} onChange={event => setBrand({ ...brand, project_name: event.target.value })} /></label>
            <label>{r.customerName}<input value={brand.customer_name} onChange={event => setBrand({ ...brand, customer_name: event.target.value })} /></label>
            <label>{r.reportNumber}<input value={brand.report_number} onChange={event => setBrand({ ...brand, report_number: event.target.value })} /></label>
            <label>{r.logo}<input type="file" accept="image/png,image/jpeg,image/svg+xml"
              onChange={event => { const file = event.target.files?.[0]; if (file) void fileToDataUrl(file).then(setLogoDataUrl) }} /></label>
            <div className="report-brand-preview">
              {(logoDataUrl || (workspace && brand.logo_file)) && <img src={logoDataUrl || `/api/report/brand/logo?workspace=${encodeURIComponent(workspace)}`} alt={r.logoAlt} />}
              <div><b>{brand.company_name || r.companyName}</b><span>{brand.project_name || r.projectName}</span></div>
            </div>
            <button className="btn btn--primary" disabled={!workspace || busy} onClick={() => void saveBrand()}>{r.saveBrand}</button>
          </div>
        )}

        {tab === 'content' && (
          <div className="report-content-grid">
            <div className="report-section-card"><h3>{r.sectionsTitle}</h3>
              {REPORT_SECTION_ORDER.map(section => (
                <label key={section}><input type="checkbox" checked={settings.sections.includes(section)}
                  onChange={event => setSettings(current => ({ ...current, sections: event.target.checked
                    ? [...current.sections, section]
                    : current.sections.filter(item => item !== section) }))} /> {reportSectionLabel(t, section)}</label>
              ))}
            </div>
            <div className="report-section-card"><h3>{r.criteriaTitle}</h3>
              <label>{r.freqRange}<input value={String(settings.acceptance_criteria.frequency_range || '')} onChange={event => setCriteria('frequency_range', event.target.value)} placeholder={r.freqRangePlaceholder} /></label>
              <label>{r.insertionLoss}<input value={String(settings.acceptance_criteria.insertion_loss || '')} onChange={event => setCriteria('insertion_loss', event.target.value)} placeholder={r.insertionLossPlaceholder} /></label>
              <label>{r.returnLoss}<input value={String(settings.acceptance_criteria.return_loss || '')} onChange={event => setCriteria('return_loss', event.target.value)} placeholder={r.returnLossPlaceholder} /></label>
              <label>{r.eyeLimit}<input value={String(settings.acceptance_criteria.eye || '')} onChange={event => setCriteria('eye', event.target.value)} /></label>
              <div className="report-muted">{r.criteriaNote}</div>
            </div>
            {textFields.map(([key, label]) => (
              <label className="report-wide" key={key}>{label}<textarea rows={4} value={String(settings[key] || '')}
                onChange={event => setSettings({ ...settings, [key]: event.target.value })} /></label>
            ))}
          </div>
        )}

        {tab === 'watermark' && (
          <div className="report-watermark-grid">
            {licenseMark.active && (
              <div className="report-section-card report-license-mark">
                <h3>{r.licenseWatermarkTitle}</h3>
                <code>{licenseMark.text || r.licenseWatermarkPending}</code>
                <div className="report-muted">{r.licenseWatermarkNote}</div>
              </div>
            )}
            <fieldset className="report-section-card report-wm-fieldset" disabled={licenseMark.active}>
              <label className="report-switch"><input type="checkbox" checked={settings.watermark.enabled}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, enabled: event.target.checked } })} /> {r.watermarkEnable}</label>
              <label>{r.watermarkMode}<select value={settings.watermark.mode} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, mode: event.target.value as typeof settings.watermark.mode } })}>
                <option value="text">{r.modeText}</option><option value="image">{r.modeImage}</option><option value="both">{r.modeBoth}</option>
              </select></label>
              <label>{r.watermarkScope}<select value={settings.watermark.scope} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, scope: event.target.value as typeof settings.watermark.scope } })}>
                <option value="all">{r.scopeAll}</option><option value="images">{r.scopeImages}</option><option value="custom">{r.scopeCustom}</option>
              </select></label>
              <div className="report-muted">{r.scopeHint}</div>
              <label>{r.watermarkLayout}<select value={settings.watermark.layout} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, layout: event.target.value as 'tile' | 'center' } })}>
                <option value="tile">{r.layoutTile}</option><option value="center">{r.layoutCenter}</option>
              </select></label>
              <label>{r.watermarkSize}<select value={settings.watermark.size} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, size: event.target.value as WatermarkSettings['size'] } })}>
                <option value="small">{r.sizeSmall}</option><option value="medium">{r.sizeMedium}</option><option value="large">{r.sizeLarge}</option>
              </select></label>
              <label>{r.watermarkImage}<input type="file" accept="image/png,image/jpeg,image/svg+xml"
                onChange={event => { const file = event.target.files?.[0]; if (file) void fileToDataUrl(file).then(data => {
                  setWatermarkDataUrl(data)
                  setSettings(current => ({ ...current, watermark: { ...current.watermark, template_id: undefined } }))
                }) }} /></label>
              {settings.watermark.scope === 'custom' && (
                <div className="report-custom-sections"><b>{r.customSections}</b>
                  {REPORT_SECTION_ORDER.map(section => <label key={section}><input type="checkbox"
                    checked={settings.watermark.sections.includes(section)}
                    onChange={event => setSettings(current => ({ ...current, watermark: {
                      ...current.watermark,
                      sections: event.target.checked
                        ? [...current.watermark.sections, section]
                        : current.watermark.sections.filter(item => item !== section),
                    } }))} /> {reportSectionLabel(t, section)}</label>)}
                </div>
              )}
            </fieldset>
            <fieldset className="report-section-card report-wm-fieldset" disabled={licenseMark.active}>
              <label>{r.watermarkText}<textarea rows={3} value={settings.watermark.text}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, text: event.target.value } })} /></label>
              {settings.watermark.text === DEFAULT_WATERMARK.text && (
                <div className="report-muted">{r.defaultWatermarkHint}</div>
              )}
              <div className="report-variable-buttons">
                {watermarkVariables.map(variable => (
                  <button className="btn" key={variable} onClick={() => insertWatermarkVariable(variable)}>+{variable}</button>
                ))}
              </div>
              <label>{r.opacity(Math.round(settings.watermark.opacity * 100))}<input type="range" min="0.03" max="0.45" step="0.01" value={settings.watermark.opacity}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, opacity: Number(event.target.value) } })} /></label>
              <label>{r.angle(settings.watermark.angle)}<input type="range" min="-90" max="90" step="1" value={settings.watermark.angle}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, angle: Number(event.target.value) } })} /></label>
              <label>{r.color}<input type="color" value={settings.watermark.color}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, color: event.target.value } })} /></label>
              <button className="btn" onClick={() => setSettings({ ...settings, watermark: { ...DEFAULT_WATERMARK } })}>{r.suggested}</button>
              {/* 範本清單：建立時間、內建不可刪、正在用的標出來。 */}
              <table className="report-template-list" aria-label={r.templateAria}>
                <thead><tr><th>{r.templateNameCol}</th><th>{r.templateCreatedCol}</th><th className="report-template-actions">{r.templateActionsCol}</th></tr></thead>
                <tbody>
                  {watermarkTemplates.map(template => (
                    <tr key={template.id} className={isTemplateInUse(settings.watermark, template, watermarkDataUrl) ? 'in-use' : ''}>
                      <td>
                        {templateLabel(template, lang)}
                        {template.builtin && <span className="report-template-tag">{r.templateBuiltin}</span>}
                        {isTemplateInUse(settings.watermark, template, watermarkDataUrl) && <span className="report-template-tag in-use">{r.templateInUse}</span>}
                      </td>
                      <td>{template.builtin ? '—' : r.templateCreated(templateTime(template.created_at), template.imported_from === 'browser')}</td>
                      <td className="report-template-actions">
                        <button className="btn" onClick={() => applyWatermarkTemplate(template)}>{r.applyTemplate}</button>
                        {isDeletable(template)
                          ? <button className="btn btn--danger" aria-label={r.deleteTemplateAria(templateLabel(template, lang))}
                            onClick={() => void removeWatermarkTemplate(template)}>{r.deleteTemplate}</button>
                          : <button className="btn" disabled title={r.templateBuiltinTip}>{r.deleteTemplate}</button>}
                      </td>
                    </tr>
                  ))}
                  {!watermarkTemplates.some(template => !template.builtin) && (
                    <tr><td colSpan={3} className="report-muted">{r.templateListEmpty}</td></tr>
                  )}
                </tbody>
              </table>
              <div className="report-template-row">
                <button className="btn" onClick={() => void saveAsTemplate()}>{r.saveTemplate}</button>
              </div>
              {templateStore && <div className="report-muted report-template-store">{r.templateStoredAt(templateStore)}</div>}
            </fieldset>
            {licenseMark.active ? (
              <div className="report-watermark-preview license-preview">
                <div className="license-preview-stripes" aria-hidden="true" style={{ opacity: LICENSE_WATERMARK_PREVIEW.stripeOpacity, fontSize: LICENSE_WATERMARK_PREVIEW.stripeFontPx, transform: `rotate(${LICENSE_WATERMARK_PREVIEW.stripeAngle}deg)` }}>
                  <span>{licenseMark.text || r.licenseWatermarkPending}</span><span>{licenseMark.text || r.licenseWatermarkPending}</span>
                </div>
                <strong>{r.previewTitle}</strong>
                <div className="license-preview-band">{licenseMark.text || r.licenseWatermarkPending}</div>
              </div>
            ) : (
            <div className="report-watermark-preview">
              <div className={`report-preview-watermark preview-size-${settings.watermark.size}`} style={{ opacity: settings.watermark.enabled ? settings.watermark.opacity : 0, transform: `rotate(${settings.watermark.angle}deg)`, color: settings.watermark.color }}>
                {(settings.watermark.mode === 'image' || settings.watermark.mode === 'both') && watermarkDataUrl && <img src={watermarkDataUrl} alt={r.watermarkAlt} />}
                {(settings.watermark.mode === 'text' || settings.watermark.mode === 'both') && <span>{settings.watermark.text || r.watermarkPreviewFallback}</span>}
              </div>
              <strong>{r.previewTitle}</strong><p>{r.previewNote}</p>
            </div>
            )}
          </div>
        )}

        {tab === 'export' && (
          <div className="report-export-grid">
            <div className="report-section-card">
              <label>{r.language}<select value={settings.locale} onChange={event => {
                // 選過就記住：之後開報告中心、混合求解報告都用這個語言。
                const locale = event.target.value as ReportSettings['locale']
                rememberReportLocale(locale)
                setSettings({ ...settings, locale })
              }}>
                <option value="zh-TW">{r.localeZh}</option><option value="en">{r.localeEn}</option><option value="bilingual">{r.localeBilingual}</option>
              </select></label>
              <div className="report-muted">{r.localeHint}</div>
              <label>{r.securityMode}<select value={settings.security_mode} onChange={event => setSettings({ ...settings, security_mode: event.target.value as ReportSettings['security_mode'] })}>
                <option value="external">{r.securityExternal}</option><option value="internal">{r.securityInternal}</option>
              </select></label>
              <label>{r.quality}<select value={settings.quality} onChange={event => setSettings({ ...settings, quality: event.target.value as ReportSettings['quality'] })}>
                <option value="compact">{r.qualityCompact}</option><option value="standard">{r.qualityStandard}</option><option value="high">{r.qualityHigh}</option>
              </select></label>
              <label>{r.outputPath}<input value={outputPath} onChange={event => setOutputPath(event.target.value)} placeholder={r.outputPathPlaceholder} /></label>
            </div>
            <div className="report-preflight">
              <h3>{r.preflight}</h3>
              <div className={activeSnapshots.length ? 'ok' : 'warn'}>{r.activeCount(activeSnapshots.length)}</div>
              <div className={staleCount ? 'warn' : 'ok'}>{r.staleCount(staleCount)}</div>
              {mismatchCount > 0 && <div className="warn">{r.localeMismatch(mismatchCount)}</div>}
              <div className={brand.company_name ? 'ok' : 'warn'}>{r.companyIs(brand.company_name || r.notSet)}</div>
              {licenseMark.active
                ? <div className="ok">{r.watermarkLicensed(licenseMark.text)}</div>
                : <div className={settings.watermark.enabled ? 'ok' : ''}>{settings.watermark.enabled ? r.watermarkOn : r.watermarkOff}</div>}
              <div>{r.sectionCount(settings.sections.length)}</div>
              <button className="btn btn--primary report-generate" disabled={!workspace || busy} onClick={() => void generate()}>
                {busy ? r.generatingButton : r.generateButton}
              </button>
              {(manifest?.exports?.length || 0) > 0 && (
                <button className="btn" onClick={() => void openLatest()}>{r.openLatest}</button>
              )}
              {lastOutput && <div className="report-output-path">{lastOutput}</div>}
            </div>
          </div>
        )}
      </div>
      {message.text && <div className={message.error ? 'report-center__message error' : 'report-center__message'}>{message.text}</div>}
      <ReportCollectStage ref={stageRef} job={stageJob} onReady={id => {
        stageWaiters.current.get(id)?.resolve()
        stageWaiters.current.delete(id)
      }} onError={(id, error) => {
        stageWaiters.current.get(id)?.reject(error)
        stageWaiters.current.delete(id)
      }} />
    </div>
  )
}
