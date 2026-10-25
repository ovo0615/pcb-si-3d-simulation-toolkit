import SupportBundleDialog from './components/SupportBundleDialog'
import { notifyStartupPaint } from './startupDiagnostics'
import { safeUserMessage } from './userMessages'
import { useLengthT as useT } from './useLengthT'
import { LengthInput, LengthUnitControl, LengthUnitError, useLengthUnit, useLengthField } from './lengthContext'
import { formatLength, type DisplayLengthUnit } from './lengthUnits'
import { lengthText } from './lengthText'
import { lengthRequest } from './lengthRequests'
// PCB SI 3D 模擬分析工具 — 前端主程式
// 裁切流程：載入電路板 → 選擇訊號／參考網路 → 裁切設定 → Port 設定 → 執行裁切
import {
  useState, useEffect, useMemo, useRef, useCallback, Fragment,
  type CSSProperties, type ChangeEvent,
} from 'react'
import { Allotment } from 'allotment'
import {
  loadLogSplit, loadMainSplit, saveLogSplit, saveMainSplit,
  loadReportWorkspace, saveReportWorkspace, resetReportWorkspaceIfNewInstance,
} from './splitLayout'
import { logPaneMaxPx, tdrChartHeight } from './compactLayout'
import { dcNoteLabel } from './dcNoteLabel'
import { appendLogEntry, logColor, logText, parseLogMessage } from './logLevel'
import { solverProgress, monitorRetry } from './solverProgress'
import { alertMessage as alert, alertMessageAndWait, confirmMessage as confirm, promptMessage } from './messageDialog'
import { useLogAutoScroll } from './useLogAutoScroll'
import type { LogEntry } from './logLevel'
import { describeApiError as describeApiErrorText } from './apiError'
import { isNoDiffPairsError, pickText, pickList, errorText } from './backendFields'
import type { ProfileListItem } from './backendFields'
import type { ResolvedBandwidth } from './bandwidthSource'
import SimulationSettings from './components/SimulationSettings'
import { simulationPayload } from './simulationRequest'
import { confirmProfileOverwrite } from './profileSave'
import { LANG_NAMES, LANGS } from './i18n'
import { currentLang, messagesFor } from './i18n/catalog'
import type { Messages } from './i18n/zh-TW'
import type { Lang } from './i18n/lang'
import { revealPath } from './revealPath'
import { buildSegmentOverlay, isWholeBoardPlan, segmentOverlayCount } from './segmentOverlay'
import type { ForbiddenInterval, PlanLayout } from './segmentOverlay'
import { complexityCutRequests, moveComplexityCut } from './complexityCutRequests'
import {
  cancelShellClose, copyText, finishShellClose, installCloseRequestHandler, useDesktopShell,
} from './desktopBridge'
import type { CloseRequestPayload } from './desktopBridge'
import { rememberInstallKind, restartHint } from './installKind'
import { describeJobFailure, fatalJobError, isFatalJobError } from './jobError'
import { runBoundaryPreviewJob } from './boundaryPreviewJob'
import { failureText, failureTime, hasFailure } from './segmentFailure'
import type { SegmentFailure } from './segmentFailure'
import RunHistory from './components/RunHistory'
import EulaPanel from './components/EulaPanel'
import 'allotment/dist/style.css'
import Preview2D, {
  CleanupOverlay,
  CleanupRemovedGeometry,
  CrossSectionCut,
  CrossSectionMode,
  CrossSectionRegion,
  PreviewData,
  SegmentCutsInfo,
  TdrMarkerSpan,
} from './components/Preview2D'
import CrossSectionView, {
  CrossSectionResults,
  CrossSectionScan,
} from './components/CrossSectionView'
import CrossSectionComparison, {
  ComparisonResult,
} from './components/CrossSectionComparison'
import SParamChart, { SParamSeries } from './components/SParamChart'
import EvidenceBadges from './components/EvidenceBadges'
import OpenFolderButton from './components/OpenFolderButton'
import TdrChart from './components/TdrChart'
import TaskPicker from './components/TaskPicker'
import BetaBadge from './components/BetaBadge'
import BetaSwitch, { useBetaEnabled } from './components/BetaSwitch'
import { mainOnlySelection, betaTasksIn } from './featureTiers'
import { confirmBetaUse } from './betaGuard'
import {
  loadSavedTasks,
  makeFlags,
  normalizeTaskList,
  saveTasks,
  type TaskKey,
} from './taskConfig'
import { backendDirectAfterLoad, createEntryModeSyncer, initialEnabledTasks } from './entryMode'
import { portComponents, readExistingPorts, signalNetsFromPorts, type ExistingPort } from './existingPorts'
import CascadeSchematic, { CascadeGraph } from './components/CascadeSchematic'
import ReportCenter, { type ReportCollectSources } from './components/ReportCenter'
import ReportSnapshotButton from './components/ReportSnapshotButton'
import { boundJobResult, supplementalViews, hashText, sourcePathKey, type ReportJobBinding, type PreprocessingRecord } from './reportCollect'
import { appendLineage, rememberedWorkSources, rememberWorkSource, segmentedWorkSource, startLineage,
  type WorkLineage } from './reportWorkSources'
import type { WorkSource } from './reportCollect'
import ModelLibrary from './components/ModelLibrary'
import { modelsReportMetadata } from './components/reportMetadataStore'
import { notifyCascadedChannelChanged } from './components/useCascadedChannel'
import { markReportSnapshotsStale, captureReportSourceEvidence } from './reportApi'
import { effectiveReportLocale } from './reportLocale'
import { displayFileName } from './reportPrivacy'
import { reportSegmentCount } from './reportSegmentCount'
import { AnsysLicensePanel } from './components/AnsysLicensePanel'
import { CloseSessionDialog } from './components/CloseSessionDialog'
import { ConfirmDialog, useConfirmDialog } from './components/ConfirmDialog'
import { useSessionRef, useSessionState } from './useSessionState'
import { DEFAULT_SOLVER_CORES, SOLVER_CORES_SESSION_KEY, SOLVER_CORES_PREFERENCE_KEY, parseSolverCores, isSolverCoresPreference } from './solverCores'
import { SolverCoresField } from './components/SolverCoresField'
import { restoreSparamView, sparamTabEnabled, useSparamViewPersistence } from './sparamViewRestore'
import { formatMaxS } from './cascadeSummary'
import {
  applySessionFields, attachSession, closeSession, createAutosaver, getAttachResult, hasRestoredFields,
  HEARTBEAT_MS, sendSessionHeartbeat,
  notifySessionChange, onSessionChange, putSessionSnapshot, registerSessionField,
  restoredFieldValue, sessionData,
} from './uiSession'
import { LicenseTag } from './components/LicenseTag'
import {
  canOfferStitchRelease, releaseBadge, releaseConfirmNumbers, releaseHasNoGuarantee,
  releaseRunLimit, releaseWarning, segmentReleaseNote, segmentReleases,
  type ManualDRelease, type StitchCeiling,
} from './stitchRelease'
import { licenseBlock, useAnsysLicense, type AnsysFunction } from './ansysLicense'

const normalizeUserPath = (path: string): string => {
  let value = path.trim()
  const quotePairs = new Set(['""', "''", '“”', '‘’'])
  while (value.length >= 2 && quotePairs.has(value[0] + value[value.length - 1])) {
    value = value.slice(1, -1).trim()
  }
  return value
}

// 求解包輸出資料夾的建議路徑：放在 segments.json 旁邊，加時間戳。
// 加時間戳是因為後端會拒絕非空資料夾——求解包內含 .aedb 資料夾，混入上一批
// 的殘留檔案會讓求解機讀到舊資料而難以察覺。每次都給新資料夾就不會撞到。
const suggestPackDir = (metadataPath: string): string => {
  const path = normalizeUserPath(metadataPath)
  if (!path) return ''
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (cut < 0) return ''
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `_${pad(now.getHours())}${pad(now.getMinutes())}`
  // 沿用原路徑的分隔字元，避免使用者貼正斜線路徑時混出 `a/b\c` 這種混用
  return `${path.slice(0, cut)}${path[cut]}solve_pack_${stamp}`
}

interface SegmentCut {
  position_mm: number               // X 或 Y 軸切割位置
  valid: boolean
  crossing_count: number
  crossings: { net: string; layer: string; x_mm: number; y_mm: number; angle_deg: number }[]
  min_obstacle_mm: number | null
  worst_angle_deg: number | null
  clearance_ok?: boolean
  unique_per_net?: boolean
  poly_hit?: boolean
  recommended_clearance_mm: number
  effective_angle_limit_deg: number
  quality_grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'M'
  quality_reason: string
  clearance_ratio: number
  ideal_position_mm: number
  deviation_mm: number
  hard_blocked: boolean
  hard_reasons: string[]
  risk_hit: boolean
  risk_reasons: string[]
  reference_missing: string[]
  /** 單參考（微帶線）切面的提示。不影響評級，但要讓人看到。
   *  後端刻意讓每一刀的文字相同，所以顯示時去重、只出現一次。 */
  stitch_return_path_risk?: string | null
  nearest_obstacle?: { kind: string; label: string; net: string; layer: string } | null
  /** 手動放行 D 級（縫合不足）的刀才有；評級仍是 D。 */
  manual_d_release?: ManualDRelease | null
}

/** 兩種分析共用的放行相關欄位。舊後端沒有。 */
interface StitchReleaseFields {
  allow_stitch_release?: boolean
  stitch_ceiling?: StitchCeiling | null
  stitch_failed_count?: number
  manual_d_release?: ManualDRelease[]
}

type QualityThreshold = 'A' | 'B' | 'C'

/** 依 3D 複雜度分段的分析結果。段數是偵測結果，不是輸入。 */
interface ComplexityAnalysis extends StitchReleaseFields {
  mode: 'complexity'
  feasible: boolean
  reason: string
  quality_threshold: QualityThreshold
  feature_count: number
  bounds_mm: { min: [number, number]; max: [number, number] }
  regions: {
    index: number
    bounds_mm: [number, number, number, number]
    feature_count: number
    kinds: string[]
    exit_count: number
  }[]
  cuts: {
    axis: number
    source_index?: number
    direction: 'x' | 'y'
    position_mm: number
    region: number
    margin_mm: number
    quality_grade: string
    quality_reason: string
    worst_angle_deg: number | null
    crossing_count: number
    /** 這把刀是在預覽圖上拖過的；auto_position_mm 是原本的自動位置。 */
    manual: boolean
    auto_position_mm: number | null
    /** 單參考（微帶線）切面的提示。每一刀文字相同，顯示時去重。 */
    stitch_return_path_risk?: string | null
    manual_d_release?: ManualDRelease | null
  }[]
  source_cuts?: { axis: number; position_mm: number; manual?: boolean }[]
  segments: {
    index: number
    bounds_mm: [number, number, number, number]
    signal_length_mm: number
    regions: number[]
    solver: 'hfss' | 'siwave'
    solver_reason: string
  }[]
  unresolved: { region: number; reason: string }[]
  corner_crossings: { net: string; x_mm: number; y_mm: number }[]
}

interface ThresholdReportItem {
  grade: QualityThreshold
  feasible: boolean
  candidate_count: number
  max_segment_mm?: number
  min_segment_mm?: number
  balance_ratio?: number
}

interface SegmentAnalysis extends StitchReleaseFields {
  mode: 'axis'
  quality_threshold: QualityThreshold
  /** 選定門檻下是否找得到可行的切點組合；false 時切面僅供參考，不可執行。 */
  threshold_feasible: boolean
  /** A／B／C 三個門檻各自的可行性與平衡度，用來回報「放寬一級能改善多少」。 */
  threshold_report: ThresholdReportItem[]
  segment_lengths_mm: number[]
  balance_ratio: number
  balance_warning: string | null
  direction: 'x' | 'y'
  bounds_mm: { min: [number, number]; max: [number, number] }
  n_segments: number
  requested_safe: boolean
  max_safe_segments: number
  minimum_segment_mm: number
  ideal_positions_mm: number[]
  rejected_candidates: {
    position_mm: number
    hard_blocked: boolean
    reasons: string[]
    nearest_obstacle?: { kind: string; label: string; net: string; layer: string } | null
  }[]
  /** 板子禁切區間，與 N 無關。舊版後端沒有這個欄位。 */
  forbidden_intervals?: ForbiddenInterval[]
  safety_overlay: {
    items: {
      kind: string
      severity: 'hard' | 'risk'
      label: string
      net: string
      layer: string
      estimated: boolean
      bounds_mm: [number, number, number, number]
      points_mm?: [number, number][]
      width_mm?: number
    }[]
    total: number
    truncated: boolean
    hard_count: number
    risk_count: number
  }
  axis_alternatives: {
    direction: 'x' | 'y'
    requested_safe: boolean
    max_safe_segments: number
    safe_candidate_count: number
    span_mm: number
  }[]
  auto_profile?: {
    minimum_clearance_mm: number
    maximum_clearance_mm: number
    width_factor: number
    height_factor: number
    reference_layers: string[]
    stackup_available: boolean
    layer_rules: Record<string, {
      trace_width_mm: number | null
      reference_height_mm: number | null
      recommended_clearance_mm: number
    }>
  } | null
  cuts: SegmentCut[]
}

interface SegmentRunResult {
  metadata_path: string
  segments: {
    index: number
    path: string
    cut_ports: any[]
    all_ports: string[]
    solver_plan?: Omit<SegmentSolverPlan, 'index' | 'path'>
    box_mm?: [number, number, number, number]
  }[]
  // `position_mm` 可以是 null：`_cut_face_position_mm` 找不到那把刀的實際
  // 切面時回 None，寧可缺值也不拿別把刀的座標充數（segment.py）。
  cut_pairs: { cut_index: number; position_mm: number | null; pairs: string[][] }[]
  previews: (PreviewData | null)[]
}

interface SegmentSolverPlan {
  index: number
  path: string
  recommended_solver: 'hfss' | 'siwave'
  requested_solver: 'hfss' | 'siwave'
  complexity_score: number
  confidence: number
  reasons: string[]
  overridden: boolean
  solve_status?: string
  export_status?: string
  touchstone?: string | null
  result_stale?: boolean
  /** 上一次為什麼失敗；舊檔沒記錄是 null，畫面顯示「未記錄」。 */
  failure?: SegmentFailure | null
  /** 這一段兩側切面的手動放行 D 級紀錄；舊檔沒有。 */
  manual_d_release?: ManualDRelease[]
  /** 該段的矩形範圍（mm）；預覽畫載入檔案的分段時用。舊檔沒有。 */
  box_mm?: [number, number, number, number] | null
}

interface CleanupAnalysis {
  mode: 'conservative' | 'em_field' | 'conservative_fallback'
  guard_mm: number
  remove_count: number
  stats: Record<string, number>
  overlay: CleanupOverlay
  safety: Record<string, boolean>
  deleted?: { primitive: number; via: number; failed: number }
  output_path?: string
  report_path?: string
  preview?: PreviewData
  comparison?: {
    before: { primitive: number; padstack: number; file_bytes: number }
    after: { primitive: number; padstack: number; file_bytes: number }
  }
  removed_geometry?: CleanupRemovedGeometry
  difference_regions?: {
    count: number
    primitive: number
    via: number
    bounds: { min: [number, number]; max: [number, number] }
  }[]
  em_field?: {
    isolation_db: number
    field_factor: number
    minimum_guard_mm: number
    reference_layers: string[]
    layer_rules: Record<string, { reference_height_mm: number; same_layer_radius_mm: number }>
  } | null
}

interface ComponentInfo {
  name: string
  nets: string[]
  pin_count: number
}

// 已選網路清單的最小高度。
//
// 原本只給 flex: 3 / flex: 2，左側面板一長（多勾幾個任務就會）兩個清單就被
// 壓到只剩一行——選了兩條訊號網路卻只看得到一條，看起來像是沒選到。
// 一列約 24 px，另外留 27 px 給標題與內距。訊號五列、參考兩列——夠看出「選了
// 幾條」，又不會把下面的面板擠掉。清單本身可捲動，超過的看得到。
/** 側向收斂驗證的加寬倍率。1.5 是常用的起點，也是回報訊息裡那個「加寬 50%」。 */
const WIDEN_FACTOR = 1.5

/** 系統日誌保留的行數上限。
 *
 *  日誌是從 WebSocket 一行一行推進來的，而畫面上那一塊是整份 `logs.map`
 *  出來的——沒有上限的話，一趟數小時的 HFSS 求解會讓陣列與 DOM 一路長大，
 *  每來一行就重繪整個元件。5000 行足夠回頭看完一個階段（AEDT 自己的訊息
 *  視窗也是同一個量級），又不會把記憶體吃到影響求解。 */
const MAX_LOG_LINES = 5000
/** 自動保存工作階段的防抖時間。關窗時另外再存一次最新的。 */
const SESSION_AUTOSAVE_MS = 1500

const NETLIST_ROW_HEIGHT = 24
const NETLIST_CHROME_HEIGHT = 27
const NETLIST_SIGNAL_MIN_HEIGHT = 5 * NETLIST_ROW_HEIGHT + NETLIST_CHROME_HEIGHT
const NETLIST_REFERENCE_MIN_HEIGHT = 2 * NETLIST_ROW_HEIGHT + NETLIST_CHROME_HEIGHT
/** 兩個清單加上中間的間距。外層容器也要有這個下限，否則子項會溢位蓋到下面的面板。 */
const NETLIST_MIN_HEIGHT =
  NETLIST_SIGNAL_MIN_HEIGHT + NETLIST_REFERENCE_MIN_HEIGHT + 6
/** 清單上方的標題、說明、匯入匯出按鈕與過濾欄合計高度。 */
const NETS_HEADER_HEIGHT = 200
// DDR 分類結果面板的高度上限。實測 433 條網路的板子攤開是 281 px；
// 這個值同時當作面板自己的 maxHeight 與外層要多留的空間，兩邊用同一個數字，
// 才不會像上次那樣「面板長高了、外層沒跟上」而讓清單掛到外面。
const DDR_PANEL_MAX_HEIGHT = 300

type ViewMode = 'full' | 'cut' | 'cleanup' | 'segments' | 'schematic' | 'sparam' | 'eye' | 'models' | 'tdr' | 'crosssection' | 'report'

/** 量測容器實際高度，讓圖表填滿剩餘空間而不需捲動。
 *  分頁高度會隨視窗與 Allotment 分隔線改變，因此以 ResizeObserver 追蹤，
 *  不用 window.innerHeight 推算。
 *
 *  用 callback ref：被量的元素只在某個分頁才掛上，原本的
 *  useEffect(…, []) 在 App 第一次 render 時元素還不在，之後就再也不量。 */
function useMeasuredHeight<T extends HTMLElement>() {
  const observerRef = useRef<ResizeObserver | null>(null)
  const [height, setHeight] = useState(0)
  const ref = useCallback((element: T | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!element) return
    setHeight(element.clientHeight)
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setHeight(entry.contentRect.height)
    })
    observer.observe(element)
    observerRef.current = observer
  }, [])
  return [ref, height] as const
}

/** 視窗高度：系統日誌的最大高度跟著它走。 */
function useViewportHeight() {
  const [height, setHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const update = () => setHeight(window.innerHeight)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return height
}

/** 前後端之間的介面版號，必須與後端 `main.py` 的 `API_CONTRACT_VERSION` 相同。
 *
 *  前端是靜態檔：`npm run build` 一跑，**還在跑的舊後端就會開始供應新前端**。
 *  新前端呼叫新端點會撞上根路徑的 StaticFiles，而它只收 GET／HEAD，於是 POST
 *  得到 `405 Method Not Allowed`——訊息完全沒有指向真正的原因。更難查的是
 *  另一半：舊後端看不懂新送的欄位會**安靜忽略**，畫面上只表現為「按鈕是灰的」。
 *  2026-08-19 實測兩種都發生了。
 *
 *  加端點或改送出欄位時兩邊一起 +1；`test_api_contract_version.py` 會擋住只改一邊。 */
const API_CONTRACT_VERSION = 13

/** 結果物件換版後，將同類報告快照標記為可能過期；第一次載入不誤報。 */
function useReportStaleRevision(
  workspace: string,
  kinds: string[],
  revision: unknown,
  reason: string,
) {
  const previous = useRef(revision)
  const kindKey = kinds.join('|')
  useEffect(() => {
    if (!workspace) {
      previous.current = revision
      return
    }
    if (previous.current && revision && previous.current !== revision) {
      void markReportSnapshotsStale(workspace, kinds, reason).catch(() => undefined)
    }
    previous.current = revision
  // kinds 由固定字串建立，以 kindKey 作為穩定相依值。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, revision, kindKey, reason])
}

/** 由資料速率推得發送端 Tr／Tf：Tr = 0.2 × UI（與後端 rise_time_ps_for 同式）。
 *  Tr 是驅動器的邊緣速率、屬元件規格，不由頻寬換算；1 Gbps → 200 ps。 */
const RISE_TIME_UI_RATIO = 0.2
function riseTimePsFor(dataRateGbps: number): number | null {
  if (!Number.isFinite(dataRateGbps) || dataRateGbps <= 0) return null
  return Math.round(1000 / dataRateGbps * RISE_TIME_UI_RATIO * 1000) / 1000
}
/** 背鑽表格的 Net 欄：完整網路名，過長才以刪節號收尾（滑鼠移上去看全名）。
 *  這欄是使用者判斷「哪一條訊號的 Via 要背鑽」的唯一依據，不可截字元：
 *  舊版寫死 `net.split('.')[0].slice(7)`，只要第一段不超過 7 個字元整欄就是空白。 */
const BD_NET_STYLE: CSSProperties = {
  display: 'block', maxWidth: 150,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

/** 保留殘樁低於這個值就警告（與後端 backdrill.MIN_SAFE_TARGET_STUB_M 同值）。
 *  背鑽深度有製造公差，留得比公差還短，鑽深一點就把出線層鑽斷。 */
const BACKDRILL_MIN_SAFE_STUB_MIL = 4

/** 保留殘樁過短的警告；空字串＝沒問題（或還沒填好，由送出時再擋）。 */
const backdrillStubWarning = (text: string, unit: DisplayLengthUnit): string => {
  const tx = lengthText(messagesFor(currentLang()), unit, currentLang()).appFlow
  const mil = Number(text)
  if (text.trim() === '' || !Number.isFinite(mil) || mil < 0) return ''
  if (mil === 0) {
    return tx.a0MilStubLetsTheDrill
      + tx.connectionBetweenTheRoutingLayerAndBarrel(formatLength(BACKDRILL_MIN_SAFE_STUB_MIL, 'mil', unit))
  }
  if (mil < BACKDRILL_MIN_SAFE_STUB_MIL) {
    return tx.aMilStubIsShorterThanA(formatLength(mil, 'mil', unit))
      + tx.keepAtLeastMilAndConfirmWith(formatLength(BACKDRILL_MIN_SAFE_STUB_MIL, 'mil', unit))
  }
  return ''
}

type CleanupCompareMode = 'side-by-side' | 'before' | 'after' | 'overlay'

interface ExtFileInfo {
  path: string
  name: string
  n_ports: number
  port_names: string[]
}

interface ExtConn { a_file: number; a_port: string; b_file: number; b_port: string }
interface ExtShort { file: number; ports: string[] }

/** 疊構／背鑽／清理會改動幾何，對已建好的元件端 Port 有風險。
 *
 *  Port 的負端綁在特定層與座標上，幾何一改就可能失去附著點；而失敗要等到
 *  求解時才會以 invalid port 出現。介面的流程順序已經把 Port 排在這三步
 *  之後，但那只是建議——使用者仍可照任意順序操作，所以套用前再擋一次。
 */
function PortWarning({ warning }: { warning: any }) {
  const { t, lang } = useT()
  if (!warning || !warning.count) return null
  return (
    <div
      className="status"
      style={{
        marginTop: 6, fontSize: 11.5, lineHeight: 1.7,
        border: '1px solid #6a5326', background: '#221c10',
        borderRadius: 6, padding: '7px 10px', color: '#ffd98a',
      }}
    >
      <b>{t.appFlow.existingComponentPorts(warning.count)}</b>
      {pickText(warning, 'message', lang)}
      {warning.names?.length > 0 && (
        <div style={{ marginTop: 3, opacity: 0.8 }}>
          {t.appFlow.examples}{warning.names.slice(0, 4).join(t.appFlow.listSeparator)}
          {warning.count > 4 ? ' …' : ''}
        </div>
      )}
    </div>
  )
}

/** 裁切外框形狀的中文名稱。後端回傳的是 PyEDB 的英文代號。 */


const cutoutBoundaryKey = (
  signalNets: string[], refNets: string[], expansionMm: string, extentType: string,
): string => JSON.stringify([
  [...signalNets].sort(),
  [...refNets].sort(),
  Number.parseFloat(expansionMm) || 0,
  extentType,
])

// 參考網路自動建議：優先精確匹配常見接地名稱，避免把上百個 GND-xxx 島全部加入
const GND_EXACT = ['GND', 'GROUND', 'VSS', 'AGND', 'DGND', 'PGND']
const GND_PATTERN = /^(gnd|vss|ground)$/i

const suggestReferenceNets = (nets: string[]): string[] => {
  const exact = nets.filter(n => GND_EXACT.includes(n.toUpperCase()))
  if (exact.length > 0) return exact
  return nets.filter(n => GND_PATTERN.test(n))
}

const parseFreqToGHz = (freqStr: string): number => {
  const match = freqStr.match(/([\d.]+)\s*(Hz|kHz|MHz|GHz)/i);
  if (!match) return parseFloat(freqStr) || 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'ghz') return val;
  if (unit === 'mhz') return val / 1000;
  if (unit === 'khz') return val / 1000000;
  if (unit === 'hz') return val / 1000000000;
  return val;
}

// 排程模擬：把秒數格式化成人看得懂的耗時文字
const formatElapsed = (sec: number): string => {
  if (sec < 60) return messagesFor(currentLang()).appFlow.elapsedSeconds(Math.floor(sec))
  const totalMin = Math.floor(sec / 60)
  if (totalMin < 60) return messagesFor(currentLang()).appFlow.elapsedMinutes(totalMin, Math.floor(sec % 60))
  const h = Math.floor(totalMin / 60)
  return messagesFor(currentLang()).appFlow.elapsedHours(h, totalMin % 60)
}

// 排程模擬：計算單一 job 的耗時（秒）。pending/skipped（沒開始求解）回傳 null。
// tick 是目前時間（epoch 秒），用來讓「求解中」的段即時跳動。
const jobElapsedSec = (job: any, tick: number): number | null => {
  if (!job.started_at) return null
  const end = job.status === 'running' ? tick : (job.finished_at ?? tick)
  return end - job.started_at
}

type StorageInfo = {
  locations: { label: string; path: string; exists: boolean; note: string }[]
  board_outputs: string
  network: string
}

type FlowMessage = string | ((t: Messages, lang: Lang) => string)

/** 保留訊息的資料與字典取用方式，切語言時重新顯示，不重跑 API 或求解。 */
function useFlowMessage(initial: FlowMessage): [string, (next: FlowMessage) => void] {
  const { t, lang } = useT()
  const [message, setMessage] = useState<FlowMessage>(() => initial)
  const setNext = (next: FlowMessage) => setMessage(() => next)
  return [typeof message === 'function' ? message(t, lang) : message, setNext]
}

/** API 例外保留雙語，已顯示的錯誤列切語言後仍能改用英文。 */
function flowError(message: (t: Messages, lang: Lang) => string): Error {
  return Object.assign(new Error(message(messagesFor('zh-TW'), 'zh-TW')), {
    user_safe: true, detail: message(messagesFor('zh-TW'), 'zh-TW'), detail_en: message(messagesFor('en'), 'en'),
  })
}

export default function App() {
  useEffect(() => notifyStartupPaint(), [])
  const { unit, length, measure, valid: validLengths, reset: resetLengths } = useLengthUnit()
  const { t, lang, setLang } = useT()
  const EXTENT_LABEL: Record<string, string> = {
    Conforming: t.appFlow.conforming,
    ConvexHull: t.appFlow.convexHull,
    Bounding: t.appFlow.boundingBox,
  }
  // ── 檔案與載入狀態 ──
  const [inputPath, setInputPath] = useSessionState('inputPath', '')
  const [outputPath, setOutputPath] = useSessionState('outputPath', '')
  // 資料放在哪裡：由後端回報實際路徑，前端不寫死。
  // 環境變數改得動模型庫與設定檔的位置，寫死的字串會安靜地說謊。
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  // S 參數分頁：自動曲線（單端／差動、IL／RL／NEXT／FEXT）
  const [spMode, setSpMode] = useSessionState<'single' | 'diff'>('spMode', 'diff')
  // 使用者有沒有自己按過模式。沒按過而差動配不出來（兩條互不相干的單端
  // 網路）就自動改單端，不要讓人第一眼看到的是紅字「找不到可配對的差動對」。
  const spModePicked = useRef(false)
  const [spKinds, setSpKinds] = useSessionState<Record<string, boolean>>('spKinds',
    { il: true, rl: true, next: false, fext: false })
  const [spData, setSpData] = useState<any | null>(null)
  const [spBusy, setSpBusy] = useState(false)
  const [spError, setSpError] = useFlowMessage('')
  // 設定 Port 與求解器：只建立 Port 與 Setup，不執行裁切
  const [portsOutputPath, setPortsOutputPath] = useSessionState('portsOutputPath', '')
  // 6c 疊構更換
  const [stackupFilePath, setStackupFilePath] = useSessionState('stackupFilePath', '')
  const [stackupOutputPath, setStackupOutputPath] = useSessionState('stackupOutputPath', '')
  const [stackupExportFormat, setStackupExportFormat] = useSessionState<'xml' | 'csv' | 'json'>('stackupExportFormat', 'xml')
  const [stackupDiff, setStackupDiff] = useState<any | null>(null)
  const [stackupConfirmRemoval, setStackupConfirmRemoval] = useState(false)
  // 6d 背鑽
  const [bdTargetStubMil, setBdTargetStubMil] = useSessionState('bdTargetStubMil', '5')
  // 鑽頭加大是選項，預設不加大：鑽頭直徑＝Via Hole。
  const [bdDrillOversize, setBdDrillOversize] = useSessionState('bdDrillOversize', false)
  const [bdDiameterIncMil, setBdDiameterIncMil] = useSessionState('bdDiameterIncMil', '8')
  const [bdResult, setBdResult] = useState<any | null>(null)
  const [bdOutputPath, setBdOutputPath] = useSessionState('bdOutputPath', '')
  const [allNets, setAllNets] = useState<string[]>([])
  // DDR 自動分類的結果與使用者勾選的角色。null = 還沒分類過。
  const [ddrResult, setDdrResult] = useState<any>(null)
  const [ddrRoles, setDdrRoles] = useState<string[]>([])
  const [ddrBusy, setDdrBusy] = useState(false)
  const [components, setComponents] = useState<ComponentInfo[]>([])
  /** 載入的板上已經有的元件端 Port。用來預選訊號網路，以及在
   *  勾著「局部裁切」載入時提示這塊板看起來已經裁切、設好 Port 了。 */
  const [existingPorts, setExistingPorts] = useState<ExistingPort[]>([])
  /** 載入時依既有 Port 預選了哪些訊號網路；畫面上講一聲，免得使用者以為是殘留。 */
  const [netsPrefilledFromPorts, setNetsPrefilledFromPorts] = useState<string[]>([])

  // ── 網路選擇 ──
  const [signalNets, setSignalNets] = useSessionState<string[]>('signalNets', [])
  const [refNets, setRefNets] = useSessionState<string[]>('refNets', [])
  const [filterText, setFilterText] = useSessionState('filterText', '')

  // ── 裁切與 Port 設定 ──
  const [expansionMm, setExpansionMm] = useSessionState('expansionMm', '5')
  // 預設「貼合走線」：凸包對斜向與彎折通道必然多包一大塊無關銅箔與 Via。
  // 貼合外框漏掉訊號時後端會自動回退凸包並通知，不會安靜地切壞。
  const [extentType, setExtentType] = useSessionState('extentType', 'Conforming')
  const [actualCutoutExtentType, setActualCutoutExtentType] = useState('')
  const [preciseBoundaryPreview, setPreciseBoundaryPreview] = useState<number[][] | null>(null)
  const [preciseBoundaryPreviewKey, setPreciseBoundaryPreviewKey] = useState('')
  /** 貼合外框比凸包少包多少面積（%）；只有 Conforming 預檢成功時才有值。 */
  const [boundaryAreaSaving, setBoundaryAreaSaving] = useState<number | null>(null)
  // 甲1（2026-08-29 拍板）：預設自動——細間距陣列整板 Pin Group，其餘 Coax。
  const [portType, setPortType] = useSessionState('portType', 'auto')
  const [checkedComps, setCheckedComps] = useSessionState<Record<string, boolean>>('checkedComps', {})
  const [cutoutJobId, setCutoutJobId] = useState('')
  const [cutoutStopping, setCutoutStopping] = useState(false)
  const [boundaryPreviewStartedAt, setBoundaryPreviewStartedAt] = useState<number | null>(null)

  // ── 模擬設定（HFSS 3D Layout／SIwave SYZ）──
  // ：只保存兩個使用者輸入，舊 session 的工程參數不再還原。
  const [specName, setSpecName] = useSessionState('simulationSpecName', '')
  const simulationChoiceEpoch = useRef(0)
  const [maxFrequencyGHz, setMaxFrequencyGHz] = useSessionState('maxFrequencyGHz', () => {
    const old = restoredFieldValue<{ end: string }[]>('sweeps', [])
    const maximum = old.length ? Math.max(...old.map(row => parseFreqToGHz(row.end))) : 50
    return String(Number.isFinite(maximum) && maximum > 0.1 ? maximum : 50)
  })
  const simulationKey = JSON.stringify([specName, maxFrequencyGHz])
  const [simulationResolved, setSimulationResolved] = useState<any>(null)
  const [simulationFailure, setSimulationFailure] = useState('')
  const simulationReady = simulationResolved?.inputKey === simulationKey
  const simulationInputRef = useRef({ specName, maxFrequencyGHz, ready: simulationReady })
  simulationInputRef.current = { specName, maxFrequencyGHz, ready: simulationReady }
  const fixed = simulationReady ? simulationResolved.settings : {}
  const sweepType = fixed.sweepType || 'Interpolating'
  const sweeps: { distribution: string; start: string; end: string; value: string }[] = fixed.sweeps || []
  const solutionFreq = String(fixed.solutionFreq || '')
  const errorTolerance = '0.1'
  const maxPasses = '20'
  const maxDeltaS = '0.02'
  const maxRefinementPerPass = '15'
  const minConvergedPasses = '2'
  const hfssMeshMethod = 'Phi'
  const adaptiveMode = fixed?.adaptiveMode || 'broadband'
  const parallelRefinement = true
  // 求解核心數由使用者設定：沒有 HPC 授權的客戶設 4 才能解。
  // 跟著工作階段保存；舊工作階段沒有這個欄位時回到 12。
  const [solverCores, setSolverCores] = useSessionState(SOLVER_CORES_SESSION_KEY, String(DEFAULT_SOLVER_CORES),
    { key: SOLVER_CORES_PREFERENCE_KEY, valid: isSolverCoresPreference })
  const solverCoresValue = parseSolverCores(solverCores)
  const solverMemoryPercent = '90'
  const [solverResourcePreview, setSolverResourcePreview] = useState<any>(null)

  // ── Layout 保守清理 ──
  // 預設＝建議設定：第一級電磁範圍、最小保護距離 0.2 mm、40 dB。
  const [cleanupGuardMm, setCleanupGuardMm] = useSessionState('cleanupGuardMm', '0.2')
  const [cleanupMode, setCleanupMode] = useSessionState<'conservative' | 'em_field'>('cleanupMode', 'em_field')
  const [cleanupIsolationDb, setCleanupIsolationDb] = useSessionState('cleanupIsolationDb', '40')
  const [cleanupOutputPath, setCleanupOutputPath] = useSessionState('cleanupOutputPath', '')
  const [cleanupAnalysis, setCleanupAnalysis] = useState<CleanupAnalysis | null>(null)
  const [cleanupBeforeScene, setCleanupBeforeScene] = useState<PreviewData | null>(null)
  const [cleanupAfterScene, setCleanupAfterScene] = useState<PreviewData | null>(null)
  const [cleanupCompareMode, setCleanupCompareMode] = useSessionState<CleanupCompareMode>('cleanupCompareMode', 'overlay')
  const [cleanupDiffKind, setCleanupDiffKind] = useSessionState<'all' | 'primitive' | 'via'>('cleanupDiffKind', 'all')
  const [cleanupDiffLayer, setCleanupDiffLayer] = useSessionState('cleanupDiffLayer', '')
  const [cleanupFocusRegion, setCleanupFocusRegion] = useState<number | null>(null)

  // ── N 段分割 ──
  const [nSegments, setNSegments] = useSessionState('nSegments', '3')
  // 這次可以接受的切點評分。門檻越嚴候選越少，各段就越難平分。
  const [segmentQuality, setSegmentQuality] = useSessionState<QualityThreshold>('segmentQuality', 'B')
  /** 依複雜度分段的分析結果；與等分分段互斥，後分析的那個生效。 */
  const [complexityAnalysis, setComplexityAnalysis] =
    useState<ComplexityAnalysis | null>(null)
  const [segOutputDir, setSegOutputDir] = useSessionState('segOutputDir', '')
  const [segAnalysis, setSegAnalysis] = useState<SegmentAnalysis | null>(null)
  // 分段結果也跟著工作階段保存，但不存預覽幾何（太大，畫面會退回裁切後的整板）。
  const [segRun, setSegRun] = useState<SegmentRunResult | null>(() => restoredFieldValue<SegmentRunResult | null>('segRun', null))
  const [activeSegIdx, setActiveSegIdx] = useSessionState('activeSegIdx', 0)
  const [showSegmentSafetyOverlay, setShowSegmentSafetyOverlay] = useSessionState('showSegmentSafetyOverlay', true)
  const [showSegmentCutDiagnostics, setShowSegmentCutDiagnostics] = useSessionState('showSegmentCutDiagnostics', true)
  const [showSolverRegionOverlay, setShowSolverRegionOverlay] = useSessionState('showSolverRegionOverlay', true)
  const [segmentSolverPlans, setSegmentSolverPlans] = useState<SegmentSolverPlan[]>([])
  const mixedSolverCascade = new Set(segmentSolverPlans.map(plan => plan.requested_solver)).size > 1
  /** 分段預覽跟著誰畫：null＝剛分析完，跟著分析；有值＝執行過或
   *  載入了 segments.json，跟著混合求解表。值是檔案裡的切點，載入時用得到。 */
  const [segFollowPlan, setSegFollowPlan] = useState<PlanLayout | null>(null)
  // 直接匯入分段模式：跳過裁切，載入的檔案直接進行 N 段分割
  const [directSegmentMode, setDirectSegmentMode] = useSessionState('directSegmentMode', false)

  // ── 排程求解 ──
  // ── 入口介面：這次要用哪些項目 ──────────────────────
  // 入口勾選跟著工作階段快照走：重開視窗要和上次一樣，而且要在接續
  // 載入之前就還原。localStorage 綁埠號，只當沒有快照時的備援。
  const [enabledTasks, setEnabledTasks] = useState<TaskKey[]>(
    () => initialEnabledTasks(restoredFieldValue<unknown>('enabledTasks', null), loadSavedTasks()))
  const enabledTasksRef = useRef(enabledTasks)
  enabledTasksRef.current = enabledTasks
  useEffect(() => registerSessionField('enabledTasks', () => enabledTasksRef.current, value => {
    const next = normalizeTaskList(value)
    if (next) setEnabledTasks(next)
  }, []), [])
  const enabledTasksMounted = useRef(false)
  useEffect(() => {
    if (enabledTasksMounted.current) notifySessionChange()
    enabledTasksMounted.current = true
  }, [enabledTasks])
  // 上次存下的設定裡就有的 Beta 任務：原樣載入，入口只提示、不改值。
  const [legacyBetaTasks] = useState<TaskKey[]>(
    () => betaTasksIn(enabledTasks) as TaskKey[])
  // 每次啟動都先顯示入口（帶出上次勾選），按「開始」才進主畫面。
  const [pickerOpen, setPickerOpen] = useSessionState('pickerOpen', true)
  const [pickerReturning, setPickerReturning] = useState(false)
  const [pickerClosing, setPickerClosing] = useState(false)
  const pickerCloseTimer = useRef<number | null>(null)
  const betaEnabled = useBetaEnabled()
  const effectiveTasks = betaEnabled ? enabledTasks : mainOnlySelection(enabledTasks)
  const show = makeFlags(effectiveTasks)

  // 「模擬設定」被四個任務共用，任一個勾了就要顯示。
  // 裁切已不再建立 Port／Setup（見 create_ports），所以「模擬設定」不再跟
  // show.cutout 綁定；只有真的會用到 Setup 的任務才需要它。
  const showSolverSetup = show.ports || show.segment || show.schedule

  // 「直接匯入分段」完全由入口的「局部裁切」決定，不需要使用者再勾一次：
  // 要裁切 → 載入的是整片板、之後才切；不裁切 → 載入的檔案本身就是通道，
  // 直接進分段。「設定 Port 與求解器」與這個判斷無關（Port 兩種情況都可能要建）。
  // 載入中旗標要在入口同步之前宣告：同步 effect 的相依陣列在繪製時就讀它。
  const [isLoading, setIsLoading] = useState(false)
  const edbActionRef = useRef(false)
  /** 後端目前的分段模式由同步器記著：載入、重新載入原始檔、同步成功後
   *  才知道；null＝未知或入口管不到（還沒有板子、裁切過）。 */
  const syncAlertRef = useRef<(e: unknown, direct: boolean) => void>(() => {})
  syncAlertRef.current = (e, direct) => {
    alert(t.appFlow.segmentModeSyncFailed(direct) + errorText(e, lang))
  }
  const [segmentModeSyncer] = useState(() => createEntryModeSyncer({
    send: direct => api('/api/segment_mode', { direct }),
    onError: (e, direct) => syncAlertRef.current(e, direct),
  }))
  const forcedDirectSegment = !show.cutout

  useEffect(() => {
    setDirectSegmentMode(prev =>
      prev === forcedDirectSegment ? prev : forcedDirectSegment)
    // 板子載入之後才回入口改勾選：後端的分段就緒只在載入時
    // 決定，不同步的話這裡按鈕亮了、按下去卻被後端擋。已經裁切過的板不用管
    // ——就緒由「有沒有建 Port」決定；正在載入的那一次會自己帶模式過去。
    // 只拿「已知的後端模式」來比：掛載當下接續載入還沒開始、後端也
    // 還沒有板子，那時去同步只會拿到「EDB 尚未載入」而誤報不一致。
    if (!workingPath || cutScene) return
    if (forcedDirectSegment) {
      setCleanupOutputPath(prev => prev || workingPath.replace(/\.aedb$/i, '') + '_cleaned.aedb')
      setPortsOutputPath(prev => prev || workingPath.replace(/\.aedb$/i, '') + '_ports.aedb')
    }
    // 快速切換時同步請求會重疊：交給同步器排隊，回應後再比最新勾選。
    segmentModeSyncer.request(forcedDirectSegment, isLoading)
  }, [forcedDirectSegment, isLoading])

  const [schedMetaPath, setSchedMetaPath] = useSessionState('schedMetaPath', '')
  // 遠端求解包：打包 SIwave 段，複製到求解機雙擊執行
  const [packDir, setPackDir] = useSessionState('packDir', '')
  // segments.json 一確定就帶出建議輸出資料夾；使用者已填則不覆蓋。
  useEffect(() => {
    if (!schedMetaPath) return
    setPackDir(prev => prev || suggestPackDir(schedMetaPath))
  }, [schedMetaPath])
  const [packBusy, setPackBusy] = useState(false)
  // 收檔：把求解機跑出來的 Touchstone 收回 segments.json
  const [ingestDir, setIngestDir] = useSessionState('ingestDir', '')
  const [ingestBusy, setIngestBusy] = useState(false)
  const [schedStatus, setSchedStatus] = useState<any | null>(null)
  const schedStartRef = useRef(false)
  const [schedStartingAt, setSchedStartingAt] = useState<number | null>(null)
  const [schedStartPhase, setSchedStartPhase] = useFlowMessage('')
  const scheduleBusy = schedStartingAt !== null || Boolean(schedStatus?.running)

  // ── 電路串接 ──
  const [cascadeResult, setCascadeResult] = useState<any | null>(null)
  // 「載入外部 S 參數」的結果是使用者自己的檔案，不是工具產出：沒有 summary_path，
  // 不給「開啟模擬資料夾」（後端也不會開）。串接（含手動接線）一定寫摘要。
  const cascadeIsToolOutput = Boolean(cascadeResult?.summary_path)
  const [cascadeBusy, setCascadeBusy] = useState(false)
  const [cascadeMode, setCascadeMode] = useSessionState<'tool' | 'external'>('cascadeMode', 'tool')
  const [schematicGraph, setSchematicGraph] = useState<CascadeGraph | null>(null)
  const [circuitBusy, setCircuitBusy] = useState(false)
  const circuitBusyRef = useRef(false)
  const [circuitExportMode, setCircuitExportMode] = useSessionState<'complete' | 'segments'>('circuitExportMode', 'complete')
  const [circuitResult, setCircuitResult] = useState<any | null>(null)
  const [circuitError, setCircuitError] = useFlowMessage('')
  const [eyeSuggestion, setEyeSuggestion] = useState<any | null>(null)
  const [eyeSuggestionError, setEyeSuggestionError] = useFlowMessage('')
  const [eyeSuggestionRevision, setEyeSuggestionRevision] = useState(0)
  const [eyeMode, setEyeMode] = useSessionState<'single' | 'differential'>('eyeMode', 'differential')
  const [eyeDataRate, setEyeDataRate] = useSessionState('eyeDataRate', '1')
  const [eyeRiseTime, setEyeRiseTime] = useSessionState('eyeRiseTime', '200')
  const [eyeInputP, setEyeInputP] = useSessionState('eyeInputP', '')
  const [eyeInputN, setEyeInputN] = useSessionState('eyeInputN', '')
  const [eyeOutputP, setEyeOutputP] = useSessionState('eyeOutputP', '')
  const [eyeOutputN, setEyeOutputN] = useSessionState('eyeOutputN', '')
  // 一鍵眼圖背景工作：輪詢狀態，完成後在「眼圖」分頁顯示 AEDT 產的 JPG
  const [eyeJob, setEyeJob] = useState<any | null>(null)
  const [eyeImageRevision, setEyeImageRevision] = useState(0)
  // TDR 阻抗定位：背景求解 + 劇變位置映射到 Layout
  const [tdrSuggestion, setTdrSuggestion] = useState<any | null>(null)
  const [tdrSuggestionError, setTdrSuggestionError] = useState<unknown>(null)
  const [tdrSuggestionLoading, setTdrSuggestionLoading] = useState(false)
  const [tdrSuggestionRevision, setTdrSuggestionRevision] = useState(0)
  const [tdrMode, setTdrMode] = useSessionState<'single' | 'differential'>('tdrMode', 'single')
  const [tdrInputP, setTdrInputP] = useSessionState('tdrInputP', '')
  const [tdrInputN, setTdrInputN] = useSessionState('tdrInputN', '')
  const [tdrOutputP, setTdrOutputP] = useSessionState('tdrOutputP', '')
  const [tdrOutputN, setTdrOutputN] = useSessionState('tdrOutputN', '')
  const [tdrDkHint, setTdrDkHint] = useSessionState('tdrDkHint', '')
  const [tdrNet, setTdrNet] = useSessionState('tdrNet', '')          // 被探測的訊號網路（路徑長度與標記映射用）
  const [tdrFlipStart, setTdrFlipStart] = useSessionState('tdrFlipStart', false) // 起點在走線的另一端
  const [tdrPath, setTdrPath] = useState<any | null>(null) // /api/tdr/path 結果
  const [tdrJob, setTdrJob] = useState<any | null>(null)
  const [tdrAnalysisIdx, setTdrAnalysisIdx] = useSessionState('tdrAnalysisIdx', 0)  // A 法／B 法切換
  const [tdrMarkers, setTdrMarkers] = useState<TdrMarkerSpan[] | null>(null)
  const [tdrMapError, setTdrMapError] = useFlowMessage('')
  // 量測波形匯入（乙路）：示波器 CSV → 錨點指認 → 同一套劇變定位
  const [tmCsvPath, setTmCsvPath] = useSessionState('tmCsvPath', '')
  const [tmPreview, setTmPreview] = useState<any | null>(null)
  // 時間單位：auto＝由表頭與取樣間隔判定；0.1 這種步長在 ps 與 ns 下數字一樣，
  // 判不出來時後端會拒絕並要求明選，這個下拉就是那條路。
  const [tmTimeUnit, setTmTimeUnit] = useSessionState<'auto' | 's' | 'ms' | 'us' | 'ns' | 'ps'>('tmTimeUnit', 'auto')
  const [tmT0, setTmT0] = useSessionState('tmT0', '')       // 板端入口（ns）
  /** TDR 這次用的穿透路徑，換成 Touchstone 的 0 起算 Port 索引給證據徽章：
   *  多埠檔的因果性只有指定了「哪個輸出對哪個輸入」才量得到。名稱對不到
   *  索引（還沒選、或選的不在這份檔裡）就不傳，徽章維持「未判定」。 */
  const tdrThroughPaths = useMemo<[number, number][]>(() => {
    const names: string[] = cascadeResult?.port_names || []
    if (!names.length) return []
    const pairs: [string, string][] = tdrMode === 'differential'
      ? [[tdrOutputP, tdrInputP], [tdrOutputN, tdrInputN]]
      : [[tdrOutputP, tdrInputP]]
    const out: [number, number][] = []
    for (const [o, i] of pairs) {
      const oi = names.indexOf(o), ii = names.indexOf(i)
      if (oi >= 0 && ii >= 0 && oi !== ii) out.push([oi, ii])
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cascadeResult?.port_names, tdrMode, tdrInputP, tdrInputN, tdrOutputP, tdrOutputN])

  const [tmTEnd, setTmTEnd] = useSessionState('tmTEnd', '')   // 線尾反射（ns）
  const [tmRise, setTmRise] = useSessionState('tmRise', '')   // 歐姆／rho 波形的儀器上升時間（ps）
  const [tmBusy, setTmBusy] = useState(false)
  const [tmError, setTmError] = useFlowMessage('')

  // 截面阻抗（Q2D）：在 Layout 上框工作範圍、拉一條切線，從 EDB 還原截面。
  // 工作範圍同時是二維模型的側向截斷邊界，不只是畫面上的框。
  const [xsMode, setXsMode] = useState<CrossSectionMode>('none')
  const [xsRegion, setXsRegion] = useState<CrossSectionRegion | null>(null)
  const [xsCut, setXsCut] = useState<CrossSectionCut | null>(null)
  const [xsScan, setXsScan] = useState<CrossSectionScan | null>(null)
  const [xsBusy, setXsBusy] = useState(false)
  const [xsError, setXsError] = useFlowMessage('')
  const [xsResolutionUm, setXsResolutionUm] = useSessionState('xsResolutionUm', '2')
  const [xsHeightUm, setXsHeightUm] = useSessionState('xsHeightUm', '')   // 導體到參考面，判側向截斷用
  const [xsRoleOverrides, setXsRoleOverrides] = useSessionState<Record<string, string>>('xsRoleOverrides', {})
  const [xsSavedCuts, setXsSavedCuts] = useState<any[]>([])
  const [xsCutsSource, setXsCutsSource] = useState('')
  /** 這片板子的切線集是不是「真的讀回來過」。
   *
   *  存檔是整份覆寫（ 的 sidecar 就是一個檔），所以在沒讀成功的
   *  情況下存一條切線，等於把這片板子先前存的全部切線刪掉。讀不到有兩種：
   *  「還沒標註過」後端回的是 `{"cuts": []}`（成功，旗標為 true），
   *  真正的失敗才會落到 catch——那時候不准存。 */
  const [xsCutsLoaded, setXsCutsLoaded] = useState(false)
  const [xsSolveMode, setXsSolveMode] = useSessionState('xsSolveMode', 'standard')
  const [xsFrequency, setXsFrequency] = useSessionState('xsFrequency', '8GHz')
  const [xsWidenCheck, setXsWidenCheck] = useSessionState('xsWidenCheck', false)
  const [xsJob, setXsJob] = useState<any | null>(null)
  const [xsResultIdx, setXsResultIdx] = useState(0)
  // TDR 捷徑（第 4 期）：把劇變的距離或沿線取樣直接換成切線
  const [xsFromTdrBusy, setXsFromTdrBusy] = useState(false)
  const [xsSampleSpacingMm, setXsSampleSpacingMm] = useSessionState('xsSampleSpacingMm', '10')
  const [xsHalfWidthUm, setXsHalfWidthUm] = useSessionState('xsHalfWidthUm', '7000')
  useLengthField('expansionMm', expansionMm, 'mm', { min: 0 })
  useLengthField('bdTargetStubMil', bdTargetStubMil, 'mil', { min: 0 })
  useLengthField('bdDiameterIncMil', bdDiameterIncMil, 'mil', { min: 0 })
  useLengthField('cleanupGuardMm', cleanupGuardMm, 'mm', { min: 0.1 })
  useLengthField('xsResolutionUm', xsResolutionUm, 'um', { min: 0, positive: true })
  useLengthField('xsHeightUm', xsHeightUm, 'um', { min: 0, optional: true })
  useLengthField('xsSampleSpacingMm', xsSampleSpacingMm, 'mm', { min: 0, positive: true })
  useLengthField('xsHalfWidthUm', xsHalfWidthUm, 'um', { min: 0, positive: true })
  const [xsCompare, setXsCompare] = useState<ComparisonResult | null>(null)
  const [spChartRef, spChartHeight] = useMeasuredHeight<HTMLDivElement>()
  const [tdrChartBoxRef, tdrChartBoxHeight] = useMeasuredHeight<HTMLDivElement>()
  const viewportHeight = useViewportHeight()
  // 外部檔案接線模式
  const [extFiles, setExtFiles] = useSessionState<ExtFileInfo[]>('extFiles', [])
  const [extConns, setExtConns] = useSessionState<ExtConn[]>('extConns', [])
  const [extShorts, setExtShorts] = useSessionState<ExtShort[]>('extShorts', [])
  // 純粹用來讓「求解中」的段耗時每秒跳動；不打 API，只觸發重繪
  const [nowTick, setNowTick] = useState(() => Date.now() / 1000)

  const targetFmaxGHz = simulationReady ? Number(maxFrequencyGHz) : null

  /** 後端介面版號與前端對不上（＝後端沒重啟）。 */
  const [staleBackend, setStaleBackend] = useState<number | null>(null)
  // 判斷頻寬由選定規範導出；切面驗收仍用完整掃頻上限。
  const solverBandwidth: ResolvedBandwidth = {
    ghz: simulationReady ? simulationResolved.solver_bandwidth_ghz : null,
    source: specName ? 'spec' : 'sweep', invalidOverride: false, staleRate: false,
  }
  /** 目前混合求解表的建議是用幾 GHz 算的（undefined＝不知道，例如舊檔）。
   *  和現在的判斷頻寬不同時提示重新評估：分段後再改頻寬，建議不會自己更新。 */
  const [segPlanBandwidthGHz, setSegPlanBandwidthGHz] = useState<number | null | undefined>(undefined)

  // ── 預覽場景 ──
  const [fullScene, setFullScene] = useState<PreviewData | null>(null)
  const [cutScene, setCutScene] = useState<PreviewData | null>(null)
  const [activeView, setActiveView] = useSessionState<ViewMode>('activeView', 'full')
  // AEDT 版本：整條流程共用一個版本，載入電路板之後就鎖住。
  // 求解機只有舊版時，要在載入前先把版本對齊過去——用新版 EDB 去撞舊版
  // 求解器不會失敗，只會讓疊構被誤讀，S 參數靜默出錯。
  const [aedtVersion, setAedtVersion] = useState('')
  const [aedtVersions, setAedtVersions] = useState<
    { version: string; installed: boolean; path: string }[]>([])
  const [aedtLocked, setAedtLocked] = useState(false)

  const refreshAedtVersion = async () => {
    try {
      const d = await api('/api/aedt-version')
      setAedtVersion(d.current || '')
      setAedtVersions(d.supported || [])
      setAedtLocked(Boolean(d.locked))
    } catch { /* 後端還沒起來，稍後由其他動作帶出 */ }
  }
  useEffect(() => { void refreshAedtVersion() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSetAedtVersion = async (value: string) => {
    if (!value || value === aedtVersion) return
    try {
      const d = await api('/api/aedt-version', { version: value })
      setAedtVersion(d.current)
      setAedtVersions(d.supported || [])
      alert(t.appFlow.switchedToAedt(d.current)
        + t.appFlow.startAgainFromImportOriginalBoardAn, 'info')
    } catch (e) {
      alert(t.appFlow.failedToSwitchVersion + errorText(e, lang), 'error')
      void refreshAedtVersion()
    }
  }

  // 報告工作區一旦定下來就固定，並記住到下一次開啟。
  //
  // 它原本每次都由「目前載入的檔案」重新推導，於是同一個案子只要換個匯入來源
  // ——載入板子、改看串接後的 .sNp、指向另一份 segments.json——就各自長出一個
  // report_workspace，快照散在好幾個資料夾裡，事後根本找不到是哪一個。
  // 要換位置仍然可以，在報告中心的工作區欄位改就好。
  const [reportWorkspace, setReportWorkspace] = useSessionState('reportWorkspace', loadReportWorkspace)
  // 用 useCallback 包住：這個函式當成 prop 傳給報告中心與快照按鈕，每次
  // App 重繪（日誌一行、輪詢一次就會重繪）都換一個新的函式參考，下游的
  // memo 與 effect 相依就跟著全數失效。它本身不依賴任何 state。
  const rememberReportWorkspace = useCallback((value: string) => {
    setReportWorkspace(value)
    saveReportWorkspace(value)
  }, [])

  // 是否可進行分段：裁切完成、或直接匯入分段模式已載入
  const canSegment = !!cutScene || (directSegmentMode && allNets.length > 0)

  /** 「建立 Port 並套用求解器設定」還缺什麼。
   *
   *  這顆按鈕有四個前提，全部滿足才亮。灰掉卻不說原因的話，使用者只能一格
   *  一格試——實際回報過：板子載入了、Port 類型也選了、元件也勾了，就是按
   *  不下去，因為**還沒執行裁切**，而那件事發生在畫面另一區。 */
  const portsSetupBlockers = [
    !cutScene && !directSegmentMode ? t.appFlow.runCutoutFirstOrUncheckLocalCutout : '',
    signalNets.length === 0 ? t.appFlow.selectSignalNets : '',
    refNets.length === 0 ? t.appFlow.selectReferenceNets : '',
    Object.keys(checkedComps).filter(c => checkedComps[c]).length === 0
      ? t.appFlow.selectTheComponentsForPortCreation : '',
  ].filter(Boolean)

  /** 後端 session 目前開著的那個檔。每個會另存新檔的步驟完成後都要更新。
   *
   *  各步驟的「輸出路徑」建議名要一律從這裡長出來。之前每一步各自猜自己的
   *  基準（背鑽用 outputPath＝裁切的輸出），結果「裁切→換疊構→背鑽」產生的
   *  檔名是 ..._Cutout_backdrill，把中間的疊構更換整個吃掉——檔名是這條加工鏈
   *  唯一的紀錄，漏一環之後就分不出哪個檔套過疊構。 */
  const [workingPath, setWorkingPath] = useSessionState('workingPath', '')
  const backdrillInputKey = JSON.stringify([workingPath, [...signalNets].sort(),
    bdTargetStubMil, bdDrillOversize, bdDiameterIncMil])
  const backdrillInputKeyRef = useRef(backdrillInputKey)
  backdrillInputKeyRef.current = backdrillInputKey
  useEffect(() => { setBdResult(null) }, [backdrillInputKey])
  // 報告只採用實際載入的板路徑，不能把裁切後 workingPath 當成原板。
  const [reportBoardPath, setReportBoardPath] = useState('')
  const [reportWorkSources, setReportWorkSources] = useState<WorkSource[]>([])
  // 原板 → 目前 session 檔的加工鏈，只由工具完成的步驟累加；分段完成時隨工作一起記下。
  const [reportLineage, setReportLineage] = useState<WorkLineage | null>(null)
  const reportBoardEpoch = useRef(0)
  const boardAnalysisEpoch = useRef(0)
  const stackupDiffEpoch = useRef(0)
  const reportGeometryBindings = useRef<Partial<Record<'cut' | 'cleanup' | 'segment' | 'schematic' | 'cascade', string>>>({})
  const reportGeometryContext = JSON.stringify([reportBoardEpoch.current, reportBoardPath, signalNets, refNets])
  const reportCascadeContext = JSON.stringify([reportGeometryContext, normalizeUserPath(schedMetaPath),
    cascadeMode, extFiles, extConns, extShorts])
  const reportJobBindings = useRef<Partial<Record<'eye' | 'tdr' | 'xs', ReportJobBinding>>>({})
  const reportSourceContext = JSON.stringify([reportBoardEpoch.current, reportBoardPath,
    workingPath, cascadeResult?.output_path, reportCascadeContext, schedMetaPath, signalNets, refNets])
  const reportEyeContext = JSON.stringify([reportSourceContext, eyeMode, eyeDataRate,
    eyeRiseTime, eyeInputP, eyeInputN, eyeOutputP, eyeOutputN])
  const reportTdrContext = JSON.stringify([reportSourceContext, tdrMode, tdrInputP,
    tdrInputN, tdrOutputP, tdrOutputN, tdrDkHint, tdrNet, tdrFlipStart, tdrPath,
    tmCsvPath, tmTimeUnit, tmT0, tmTEnd, tmRise])
  const reportXsContext = JSON.stringify([reportSourceContext, xsFrequency, xsSolveMode,
    xsWidenCheck, xsSavedCuts, xsRegion, xsCut, xsRoleOverrides, xsResolutionUm, xsHeightUm])
  const reportCompareContext = JSON.stringify([reportXsContext, reportTdrContext, tdrAnalysisIdx])
  const reportComparisonBinding = useRef('')
  const reportMarkerContext = JSON.stringify([reportTdrContext, tdrAnalysisIdx])
  const reportMarkerBinding = useRef('')
  const [reportCutoutRecord, setReportCutoutRecord] = useState<PreprocessingRecord | null>(null)
  const [reportCleanupRecord, setReportCleanupRecord] = useState<PreprocessingRecord | null>(null)
  const [reportQualityRecord, setReportQualityRecord] = useState<PreprocessingRecord | null>(null)
  const captureBeforeAnalysis = async (family: string, paths: string[], inputs: unknown) => {
    try {
      return await captureReportSourceEvidence(`t-${hashText(paths.map(path => normalizeUserPath(path).toLowerCase()).join('|'))}`,
        `${family}-${hashText(JSON.stringify(inputs))}`, paths)
    } catch {
      // 收據失敗不阻止原工程動作；報告會逐項列「分析開始收據未保存」。
      return undefined
    }
  }
  // 疊構更換屬於「準備」階段（載入的子項），必須在裁切之前就能用——換疊構會
  // 改變層厚與層數，裁切與 Port 都得建立在最終疊構上。因此它的門檻是「板子
  // 載入了」，不是「裁切完成了」。
  const boardLoaded = !!fullScene || allNets.length > 0

  // ── UI 狀態 ──
  // 後端送結構化紀錄 {text, level, text_en}；本機補進來的錯誤仍是純文字。
  const [logs, setLogs] = useState<(LogEntry | string)[]>([])
  const [loadingMsg, setLoadingMsg] = useFlowMessage(t => t.appFlow.processing)
  const [showLogs, setShowLogs] = useSessionState('showLogs', true)
  // ：進眼圖頁時日誌先摺疊；要看再從「檢視 → 顯示系統日誌」打開。
  useEffect(() => { if (activeView === 'models') setShowLogs(false) }, [activeView])
  // Ansys 授權對照：按鈕變灰與「說明 → Ansys 授權對照」共用同一份狀態。
  const [licensePanelOpen, setLicensePanelOpen] = useState(false)
  const { status: licenseStatus } = useAnsysLicense()
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const { logBoxRef, onLogScroll } = useLogAutoScroll(logs, showLogs)
  // 載入遮罩內的日誌尾巴用獨立 ref：遮罩顯示時把系統日誌整個蓋住，使用者在
  // 長時間操作（例如讀取大型 EDB）期間看不到任何進度，只能乾等一個籠統的
  // 訊息。這個 ref 對應的框在遮罩顯示時才存在，所以需要自己的自動捲動邏輯。
  const loadingLogBoxRef = useRef<HTMLDivElement | null>(null)
  const signalFileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const box = loadingLogBoxRef.current
    if (!box) return
    box.scrollTop = box.scrollHeight
  }, [logs, isLoading])

  // WebSocket 日誌（含斷線自動重連）
  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let retry: number | undefined

    const connect = () => {
      ws = new WebSocket(`ws://${window.location.host}/ws/logs`)
      ws.onmessage = (event) => setLogs(prev =>
        appendLogEntry(prev, parseLogMessage(String(event.data)), MAX_LOG_LINES))
      ws.onclose = () => {
        if (!closed) retry = window.setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      closed = true
      if (retry) window.clearTimeout(retry)
      ws?.close()
    }
  }, [])

  // ── API 呼叫 ──────────────────────────────────────────
  /** 把後端的錯誤攤成一句人看得懂的話（規則在 apiError.ts；英文介面用 detail_en）。 */
  const describeApiError = (data: any, res: Response, lang: Lang = 'zh-TW'): string =>
    describeApiErrorText(data, res, lang)

  const api = async (url: string, body?: any) => {
    const latestSimulation = simulationInputRef.current
    body = simulationPayload(url, body, latestSimulation, latestSimulation.ready,
      t.simulationSetup.pending)
    body = lengthRequest(url, body, unit)
    const res = await fetch(url, body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    // 後端在極少數情況會回非 JSON 內容（例如回應序列化失敗時，Starlette
    // 會回純文字 "Internal Server Error"）。直接 res.json 會拋出
    // 「Unexpected token」這種對使用者毫無意義的訊息，掩蓋真正的錯誤，
    // 故改為先取文字再嘗試解析。
    const text = await res.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      if (!res.ok) {
        throw flowError(t => t.appFlow.serverErrorHttp(res.status, ''))
      }
      throw flowError(t => t.appFlow.invalidServerResponseNotJson(''))
    }
    // 後端啟用本機 token 而這個分頁沒有 cookie（自己打網址、或 cookie 被清掉）。
    // 訊息要說出下一步，不能只有「HTTP 401」。
    if (res.status === 401) {
      throw flowError((t, lang) => t.appFlow.backendAccessDenied401UseTheTool(restartHint(lang)))
    }
    // 帶上後端的訊息代碼：要依錯誤種類決定行為的地方看 code，不比對文字。
    if (!res.ok) throw Object.assign(new Error(describeApiError(data, res)), {
      user_safe: true, detail: describeApiError(data, res), code: data?.code, detail_en: describeApiErrorText(data, res, 'en'),
      status: res.status,
    })
    return data
  }

  useEffect(() => {
    let current = true
    setSimulationFailure('')
    void api('/api/simulation-settings/resolve', {
      spec_name: specName, max_frequency_ghz: Number(maxFrequencyGHz),
    }).then(data => {
      if (current) setSimulationResolved({ ...data, inputKey: simulationKey })
    }).catch(error => {
      if (current) setSimulationFailure(errorText(error, lang))
    })
    return () => { current = false }
  }, [specName, maxFrequencyGHz])

  // 要使用者決定的不可逆操作一律用工具自己的確認框，不用瀏覽器原生 confirm
  // （會跳「127.0.0.1:8765 說」，看起來像網頁出錯； A）。
  const { request: confirmRequest, askConfirm, settle: settleConfirm } = useConfirmDialog()

  const confirmOutputOverwrite = async (
    path: string,
    actionLabel: string,
  ): Promise<boolean | null> => {
    const status = await api('/api/output_path/status', { path })
    if (!status.exists) return false
    const targets = (status.targets as string[]).map(target => `• ${target}`).join('\n')
    const accepted = await askConfirm({
      title: t.appFlow.overwriteTitle,
      message: t.appFlow.overwriteWarning(actionLabel)
        + `${targets}\n\n`
        + t.appFlow.overwritePermanent
        + t.appFlow.overwriteConfirm,
      confirmLabel: t.appFlow.overwriteProceed,
      cancelLabel: t.appFlow.confirmCancel,
      destructive: true,
    })
    return accepted ? true : null
  }

  /** 送出分段（`/api/segment/run` 或 `run-single`），被「資料夾裡已經有
   *  上一批」擋下就問一次。
   *
   *  分段的輸出是一整個資料夾裡的 segment_N.aedb，不是單一個 .aedb，
   *  `/api/output_path/status`（裁切用的那條）只看得出「這個資料夾存在」——
   *  拿它來事前探測，等於每次分段都跳一次確認，而且問的不是真正的問題。
   *  所以沿用後端那道閘門：先照預設（不覆寫）送出，真的撞到既有結果時，
   *  把後端寫的理由原封不動給使用者看，答應了才帶 `overwrite_existing`
   *  重送。取消回 null，呼叫端安靜結束，不當成失敗。
   *
   *  措辭要跟後端現在的行為一致：帶 `overwrite_existing` 重送時，後端會
   *  **真的把舊的 segment_N.aedb 整個資料夾刪掉**（連同 .aedt、.aedt.lock
   *  與 .aedtresults）再裁切，不再只是「不擋你」。所以這裡講清楚刪的是什麼，
   *  而不是含糊的「覆寫」。 */
  const runSegmentJob = async (
    endpoint: string, payload: Record<string, any>,
  ) => {
    try {
      return await api(endpoint, { ...payload, overwrite_existing: false })
    } catch (error) {
      // 後端用 409＋專用代碼表示「已有上一次的結果，要使用者決定」（ A）。
      const { status, code } = error as { status?: number; code?: string }
      if (status !== 409 || !code?.startsWith('segment.previous_results_present')) throw error
      // 後端寫的理由照原樣給使用者看；去掉 `[HTTP 409 / 代碼]` 前綴，那是給客服看的。
      const reason = errorText(error, lang).replace(/^\[[^\]]*\]\s*/, '')
      const accepted = await askConfirm({
        title: t.appFlow.previousSegmentationTitle,
        message: t.appFlow.deleteTheseSegmentNAedbFoldersIncluding(reason)
          + t.appFlow.solvedResultsAndAedtresultsAndRerunDeleted,
        confirmLabel: t.appFlow.deleteAndRerun,
        cancelLabel: t.appFlow.confirmCancel,
        destructive: true,
      })
      if (!accepted) return null
      return await api(endpoint, { ...payload, overwrite_existing: true })
    }
  }

  useEffect(() => {
    // 輸入不合法時不問後端（會回 400），畫面由 SolverCoresField 說明。
    if (solverCoresValue === null) return
    const controller = new AbortController()
    const memory = parseInt(solverMemoryPercent, 10) || 90
    fetch(`/api/system/solver_resources?num_cores=${solverCoresValue}&memory_percent=${memory}`, {
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data) setSolverResourcePreview(data) })
      .catch(() => {})
    return () => controller.abort()
  }, [solverCoresValue, solverMemoryPercent])

  const handleBrowseInput = async () => {
    try {
      const data = await api('/api/browse_input')
      if (data.path) {
        setInputPath(data.path)
        setOutputPath(stripExtension(data.path) + '_Cutout.aedb')
      }
    } catch (e) { reportBrowseFailure('inputFile', e) }
  }

  /** 挑一個 CSV 填進指定欄位。示波器匯出的檔名又長又帶時間戳，
   *  手打路徑打錯一個字元得到的是「找不到檔案」，看不出是路徑的問題。 */
  const browseCsvInto = async (setter: (path: string) => void, title: string) => {
    try {
      const data = await api(`/api/browse_csv?title=${encodeURIComponent(title)}`)
      if (data.path) setter(data.path)
    } catch (e) { reportBrowseFailure('csvFile', e) }
  }

  const revealInExplorer = async (path: string) => {
    const failure = await revealPath(path)
    if (failure) setLogs(prev => [...prev, failure])
  }

  /** 瀏覽視窗打不開時要說出來。
   *
   *  `browse_*` 端點自己吞掉例外並回 `{"path": ""}`（使用者按取消也是這樣），
   *  所以會走到 catch 的只剩傳輸層失敗——後端沒起來、或前端新後端舊撞上
   *  StaticFiles 的 405。原本只 `console.error`，畫面上按下去完全沒有反應，
   *  看起來像按鈕壞了。跟 `revealInExplorer` 一樣寫進系統日誌。 */
  const reportBrowseFailure = (what: string, error: unknown) => {
    const zh = messagesFor('zh-TW').appFlow
    const en = messagesFor('en').appFlow
    const fields = ['inputFile', 'csvFile', 'outputPath', 'stackupFile'] as const
    const field = fields.find(key => what === key || what === zh[key] || what === en[key])
    setLogs(prev => [...prev, {
      text: zh.errorFailedToOpenTheBrowser(field ? zh[field] : what, errorText(error, 'zh-TW')),
      text_en: en.errorFailedToOpenTheBrowser(field ? en[field] : what, errorText(error, 'en')),
      level: 'error',
    }])
  }

  const handleBrowseOutput = async () => {
    try {
      const data = await api('/api/browse_output')
      if (data.path) setOutputPath(data.path)
    } catch (e) { reportBrowseFailure('outputPath', e) }
  }

  // 分隔線位置：讀一次當初始值，之後每次拖曳就記起來當下次的預設。
  // useState 的初值只在第一次 render 取用，所以不需要 useMemo。
  const [splitSizes] = useState(loadMainSplit)
  const [logSplitSizes] = useState(loadLogSplit)
  // ：模型頁把左側面板收起來，收起時 Allotment 回報的寬度是 0，
  // 存下去會讓下次開啟時左側消失，所以模型頁不存。
  const saveSplitSizes = (sizes: number[]) => { if (activeView !== 'models') saveMainSplit(sizes) }
  const saveLogSplitSizes = (sizes: number[]) => saveLogSplit(sizes)

  /** 上一次自動填進各輸出路徑欄位的建議值；用來分辨「使用者自己改過」。 */
  const autoSuggested = useSessionRef<Record<string, string>>('autoSuggested', {})

  /** 去掉副檔名——只動檔名那一段，不會咬到目錄。
   *
   *  常見寫法 `path.replace(/\.[^/.]+$/, '')` 在 Windows 路徑上會出事：
   *  `[^/.]` 允許反斜線，所以像 `…\v1.2\board` 這種（目錄名含小數點、檔名
   *  沒有副檔名）會從小數點一路吃到結尾，只剩 `…\v1`。
   */
  const stripExtension = (path: string) => {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    return path.slice(0, cut + 1) + path.slice(cut + 1).replace(/\.[^.]+$/, '')
  }

  /** 依目前工作檔重算某個步驟的輸出路徑建議。
   *
   *  只有欄位是空的、或仍等於上一次的建議時才覆寫——使用者自己打過的路徑
   *  不能被工作檔一變就洗掉。
   */
  const suggestOutputPath = (
    key: string, suffix: string,
    current: string, setter: (value: string) => void,
  ) => {
    const base = workingPath || inputPath
    if (!base) return
    const next = stripExtension(base) + suffix
    if (current && current !== autoSuggested.current[key]) return
    if (current === next) return
    autoSuggested.current[key] = next
    setter(next)
  }

  // 工作檔一換（裁切／疊構／背鑽／清理／Port 任一步完成），所有還沒被使用者
  // 開場先確認後端不是舊的。這個檢查放在最前面，因為版本對不上時後面每一個
  // 症狀都會指向錯的方向（405、按鈕灰掉、欄位被安靜忽略）。
  useEffect(() => {
    void (async () => {
      try {
        const status = await api('/api/status')
        const version = Number(status?.api_contract_version ?? 0)
        setStaleBackend(version === API_CONTRACT_VERSION ? null : version)
        // 後端是新的一次啟動 → 報告工作區從頭開始，不帶上一輪的舊快照。
        // 例外：使用者關窗時選了「儲存並關閉」，這次是還原那個工作階段。
        if (resetReportWorkspaceIfNewInstance(String(status?.instance_id || ''))
            && !hasRestoredFields()) {
          setReportWorkspace('')
        }
      } catch { /* 連不上就讓其他地方去報，不在這裡疊一層 */ }
    })()
  }, [])

  // 版本與建置資訊：標題列顯示、「關於本工具」列全部、支援包 manifest 也帶。
  const [backendVersion, setBackendVersion] = useState<any>(null)
  useEffect(() => {
    void api('/api/version').then(v => {
      // 安裝版沒有 start.bat：記住型態，之後連不上後端也說得出怎麼重開。
      rememberInstallKind(v?.install_kind)
      setBackendVersion(v)
    }).catch(() => { /* 舊後端沒有這個端點 */ })
  }, [])

  const [aboutOpen, setAboutOpen] = useState(false)
  const [aboutText, setAboutText] = useState('')
  const showAbout = () => {
    const v = backendVersion
    const lines = [
      t.appFlow.pcbSi3dSimulationToolkitV(__APP_VERSION__),
      '',
    ]
    if (v) {
      if (v.app_version !== __APP_VERSION__) {
        lines.push(t.appFlow.backendVersionDiffersFromFrontendCloseThe(v.app_version, __APP_VERSION__, restartHint(lang)))
      }
      lines.push(t.appFlow.build(v.build_id || t.appFlow.unknown, ''))
      lines.push(t.appFlow.aedtVersionThisWorkflow(v.aedt_version_in_use || '?'))
    }
    lines.push(t.appFlow.providedByJeffHongSeniorTechnicalEngineer)
    setAboutText(lines.join('\n'))
    setAboutOpen(true)
  }

  /** 一鍵支援包：日誌、設定摘要、版本 manifest 與 pyaedt 記錄打成 zip（AEDT 傾印要另外勾選），
   *  然後在檔案總管開它所在的資料夾。不含模型檔與求解結果。 */
  const [supportDialogOpen, setSupportDialogOpen] = useState(false)
  const makeSupportBundle = async (plaintextReview = false, includeAedtDumps = false) => {
    setSupportDialogOpen(false)
    try {
      const result = await api('/api/support/bundle', { plaintext_review: plaintextReview, include_aedt_dumps: includeAedtDumps })
      const failure = await revealPath(result.path)
      const skipped = (result.skipped || []).length
      alert(
        t.appFlow.supportBundleCreated(result.path) +
        t.appFlow.attachments((result.included || []).length) + (skipped ? t.appFlow.skippedSeeManifestJson(skipped) : '') +
        t.appFlow.excludesModelFilesAedbTouchstoneFilesAnd +
        (failure ? t.appFlow.failedToOpenFolder(failure) : ''),
        'success',
      )
    } catch (e) {
      alert(t.appFlow.failedToCreateSupportBundle + errorText(e, lang), 'error')
    }
  }

  // 工具視窗只有一個視窗；要多開分頁對照時，由後端帶著 token 開系統預設瀏覽器
  // 。純瀏覽器模式本來就能自己開分頁，選單不顯示這一項。
  const desktopShell = useDesktopShell()
  const openInBrowser = async () => {
    try {
      await api('/api/open_in_browser', {})
    } catch (e) {
      alert(t.appFlow.failedToOpenInBrowser + errorText(e, lang), 'error')
    }
  }


  // 動過的輸出路徑建議都要跟著長出新的一節，檔名才完整記錄做過哪些加工。
  useEffect(() => {
    if (!workingPath) return
    suggestOutputPath('stackup', '_stackup.aedb', stackupOutputPath, setStackupOutputPath)
    suggestOutputPath('backdrill', '_backdrill.aedb', bdOutputPath, setBdOutputPath)
    suggestOutputPath('cleanup', '_cleaned.aedb', cleanupOutputPath, setCleanupOutputPath)
    suggestOutputPath('ports', '_ports.aedb', portsOutputPath, setPortsOutputPath)
    // 分段輸出資料夾走同一套規則。之前它是每個步驟各自無條件覆寫，而輸出路徑
    // 又受「使用者改過就不動」保護——兩種政策並存，於是同一畫面上「設 Port 的
    // 輸出」與「分段輸出資料夾」會少掉不同的加工節，看起來像壞掉。
    suggestOutputPath('segments', '_segments', segOutputDir, setSegOutputDir)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingPath])

  const handleBrowseStackup = async () => {
    try {
      const data = await api('/api/browse_stackup')
      // 換了疊構檔，舊的差異分析就不作數了。
      if (data.path) { setStackupFilePath(data.path); invalidateStackupDiff() }
    } catch (e) { reportBrowseFailure('stackupFile', e) }
  }

  const invalidateStackupDiff = () => {
    stackupDiffEpoch.current += 1
    setStackupDiff(null)
    setStackupConfirmRemoval(false)
  }

  const invalidateBoardAnalysis = () => {
    boardAnalysisEpoch.current += 1
    setDdrResult(null)
    setDdrRoles([])
    setDdrBusy(false)
    setRefSuggestions(null)
    invalidateStackupDiff()
    setBdResult(null)
  }

  const applyLoadResult = (data: any, path: string) => {
    invalidateBoardAnalysis()
    reportBoardEpoch.current += 1
    setReportBoardPath(path)
    setReportWorkSources(rememberedWorkSources(path))
    setReportLineage(startLineage(path))
    reportJobBindings.current = {}
    reportGeometryBindings.current = {}
    setReportCutoutRecord(null)
    setReportCleanupRecord(null)
    setReportQualityRecord(null)
    setSchedMetaPath('')
    setCascadeResult(null)
    setSchematicGraph(null)
    setEyeJob(null)
    setTdrJob(null)
    setXsJob(null)
    setXsCompare(null)
    setAllNets(data.nets)
    setComponents(data.components || [])
    // 自動建議參考網路（GND / VSS / GROUND，精確匹配優先）
    const suggestedRefs = suggestReferenceNets(data.nets as string[])
    setRefNets(suggestedRefs)
    // 板上已經有元件端 Port：Port 已經講清楚是哪幾條訊號，
    // 不用再手動選一次（原本沒選就被「請先選擇訊號網路」擋下）。
    const ports = readExistingPorts(data.existing_ports)
    const prefilled = signalNetsFromPorts(ports, data.nets as string[], suggestedRefs)
    setExistingPorts(ports)
    setNetsPrefilledFromPorts(prefilled)
    setSignalNets(prefilled)
    setCheckedComps({})
    setCutScene(null)
    setActualCutoutExtentType('')
    setPreciseBoundaryPreview(null)
    setPreciseBoundaryPreviewKey('')
    setCleanupAnalysis(null)
    setCleanupBeforeScene(null)
    setCleanupAfterScene(null)
    setSegAnalysis(null)
    setSegRun(null); setSegFollowPlan(null)
    setActiveView('full')
    if (path) {
      setInputPath(path)
      setCleanupOutputPath(path.replace(/\.aedb$/i, '') + '_cleaned.aedb')
      if (!outputPath) setOutputPath(stripExtension(path) + '_Cutout.aedb')
    }
  }

  // 載入會先關掉舊 EDB；開始嘗試時就撤掉舊板，失敗也不能繼續使用 A 的畫面。
  const clearLoadedBoard = () => {
    applyLoadResult({ nets: [], components: [] }, '')
    setFullScene(null)
    setWorkingPath('')
    setBdResult(null)
    segmentModeSyncer.setBackend(null)
  }

  /** `direct` 預設跟著入口勾選；「切換成不裁切並重新載入」那顆鈕會明講 true，
   *  因為同一個事件裡改的入口勾選要到下一次重繪才反映到 directSegmentMode。 */
  /** `opts.resume`：重新開窗還原工作階段，後端還開著同一片板就直接接回、
   *  不重開 EDB。`opts.quiet`：失敗不跳 alert，改回傳錯誤文字（還原流程自己顯示）。 */
  const handleLoadFile = async (direct: boolean = directSegmentMode, path: string = inputPath,
                                opts: { resume?: boolean; quiet?: boolean;
                                        restoreOriginalPath?: string; restoreIsCut?: boolean } = {})
    : Promise<{ ok: true; data: any } | { ok: false; error: string }> => {
    if (!path) { alert(t.appFlow.enterAFilePath); return { ok: false, error: t.appFlow.enterAFilePath } }
    clearLoadedBoard()
    setLoadingMsg((t) => direct
      ? t.appFlow.loadingFileAsAChannelWithoutCutout
      : t.appFlow.loadingEdbLargeFilesMayTakeSeveral)
    setIsLoading(true)
    try {
      const started = await api('/api/load', {
        path, for_segmentation: direct, resume: opts.resume === true,
        restore_original_path: opts.restoreOriginalPath ?? null,
        restore_is_cut: opts.restoreIsCut ?? null,
      })
      const jobId = started.job_id as string
      let data: any = null
      let transientErrors = 0
      while (!data) {
        await new Promise(resolve => window.setTimeout(resolve, 2000))
        try {
          const state = await api(`/api/load/status?job_id=${encodeURIComponent(jobId)}`)
          transientErrors = 0
          const elapsed = state.started_at ? Math.max(0, Date.now() / 1000 - state.started_at) : 0
          setLoadingMsg((t, lang) => t.appFlow.jobProgress(pickText(state, 'message', lang) || t.appFlow.loadingInBackground, state.progress || 0, formatElapsed(elapsed)))
          if (state.status === 'error') {
            throw fatalJobError(describeJobFailure({ message: pickText(state, 'message', lang), error: pickText(state, 'error', lang) }, t.appFlow.edbImportFailed))
          }
          if (state.status === 'done') data = state.result
        } catch (error) {
          // 工作本身失敗（終局）就立刻放棄；只有連線抖動才重試。
          if (isFatalJobError(error)) throw error
          transientErrors += 1
          if (transientErrors >= 3) throw error
        }
      }
      applyLoadResult(data, data.path || path)
      segmentModeSyncer.setBackend(backendDirectAfterLoad(data, direct))
      const normalized = data.path || path
      setWorkingPath(normalized)
      if (direct) {
        // 直接分段模式：預設清理與分段輸出路徑，載入後可直接到「Layout 清理」／8
        setCleanupOutputPath(normalized.replace(/\.aedb$/i, '') + '_cleaned.aedb')
          // 「設定 Port 與求解器」的輸出（另存新檔，不覆寫使用者自己裁切好的來源）
        setPortsOutputPath(normalized.replace(/\.aedb$/i, '') + '_ports.aedb')
      } else {
        setOutputPath(stripExtension(normalized) + '_Cutout.aedb')
      }
      // Preview 已在同一個背景工作內完成，避免第二個長 HTTP 請求再次逾時。
      setFullScene(data.preview)
      // 載入之後版本就鎖住了，把選單狀態同步過來，免得它看起來還能改。
      setAedtLocked(true)
      return { ok: true, data }
    } catch (e) {
      // 載入失敗時後端可能已關掉上一片板：模式改回未知，不拿它來比入口。
      segmentModeSyncer.setBackend(null)
      if (!opts.quiet) alert(t.appFlow.loadFailed + errorText(e, lang), 'error')
      return { ok: false, error: errorText(e, lang) }
    } finally {
      setIsLoading(false)
    }
  }

  /** 勾著「局部裁切」載入、板上卻已經有元件端 Port：一鍵取消局部
   *  裁切、記住這個選擇，再以不裁切模式重新載入（後端同路徑捷徑，不重開 EDB）。 */
  const switchToNoCutoutAndReload = async () => {
    const next = enabledTasks.filter(key => key !== 'cutout')
    setEnabledTasks(next)
    saveTasks(next)
    // 用目前載入的那片板：載入後輸入框可能又被換成別的檔案。
    await handleLoadFile(true, workingPath || inputPath)
  }

  const handleReloadOriginal = async () => {
    clearLoadedBoard()
    setLoadingMsg((t) => t.appFlow.reloadingOriginalFile)
    setIsLoading(true)
    try {
      // 帶入口模式：不裁切時原始檔本身就是通道，後端要跟著維持「可分段」。
      const data = await api('/api/reload_original', { for_segmentation: directSegmentMode })
      // 後端 session 已經回到原始板，工作檔也要跟著回去。少了這一行，
      // workingPath 會停在 …_Cutout_backdrill.aedb，之後每一步的輸出建議
      // 都繼續掛著那串已經不成立的加工節（檔名是這條加工鏈唯一的紀錄）。
      const original = String(data.path || '')
      applyLoadResult(data, original)
      segmentModeSyncer.setBackend(backendDirectAfterLoad(data, directSegmentMode))
      setWorkingPath(original)
      const full = await api('/api/preview', { nets: [] })
      setFullScene(full)
    } catch (e) {
      alert(t.appFlow.reloadFailed + errorText(e, lang), 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCutout = async () => {
    if (edbActionRef.current) return
    if (!validLengths()) return
    if (signalNets.length === 0) { alert(t.appFlow.selectSignalNetsFirst); return }
    if (refNets.length === 0) { alert(t.appFlow.selectReferenceNetsFirstEGGnd); return }
    if (!outputPath) { alert(t.appFlow.setAnOutputPath); return }
    const comps = Object.keys(checkedComps).filter(c => checkedComps[c])
    edbActionRef.current = true
    setLoadingMsg((t) => t.appFlow.preparingCutout)
    setIsLoading(true)
    setCutoutStopping(false)
    try {
      let overwriteExisting: boolean | null
      try {
        overwriteExisting = await confirmOutputOverwrite(outputPath, t.appFlow.cutout)
      } catch (e) {
        alert(t.appFlow.unableToCheckOutputPath + errorText(e, lang), 'error'); return
      }
      if (overwriteExisting === null) return
      const beforeScene = cutScene || fullScene
      const reportEvidence = await captureBeforeAnalysis('cutout', [workingPath],
        [signalNets, refNets, expansionMm, extentType, comps])
      const started = await api('/api/cutout', {
        signal_nets: signalNets,
        reference_nets: refNets,
        expansion_mm: Number(expansionMm),
        extent_type: extentType,
        port_components: comps,
        port_type: portType,
        // 裁切一律不兼建 Port。Port 必須建立在**最終幾何**上，而背鑽與
        // Layout 清理都排在裁切之後、也都會移除銅箔與 Via——先建好的 Port
        // 參考可能因此默默失效（實測 SIwave 會整批判為 invalid port）。
        // 建 Port 改由「分析」區的〈設定 Port 與求解器〉負責。
        create_ports: false,
        output_path: outputPath,
        overwrite_existing: overwriteExisting,
        solution_freq: parseFloat(solutionFreq) || 25,
        sweep_type: sweepType,
        sweeps: sweeps,
        error_tolerance_pct: parseFloat(errorTolerance) || 0.1,
        max_passes: parseInt(maxPasses, 10) || 20,
        max_delta_s: parseFloat(maxDeltaS) || 0.02,
        adaptive_mode: adaptiveMode,
        parallel_refinement: parallelRefinement,
        max_refinement_per_pass: parseInt(maxRefinementPerPass, 10) || 15,
        min_converged_passes: parseInt(minConvergedPasses, 10) || 2,
      })
      const jobId = started.job_id as string
      setCutoutJobId(jobId)
      let data: any = null
      let transientErrors = 0
      while (!data) {
        await new Promise(resolve => window.setTimeout(resolve, 2000))
        try {
          const state = await api(`/api/cutout/status?job_id=${encodeURIComponent(jobId)}`)
          transientErrors = 0
          const elapsed = state.started_at ? Math.max(0, Date.now() / 1000 - state.started_at) : 0
          const countText = state.total ? t.appFlow.processedCount(state.processed || 0, state.total) : ''
          setLoadingMsg((t, lang) => t.appFlow.jobProgressWithCount(pickText(state, 'message', lang) || t.appFlow.cutoutInBackground, state.progress || 0, countText, formatElapsed(elapsed)))
          if (state.status === 'error') {
            throw fatalJobError(describeJobFailure({ message: pickText(state, 'message', lang), error: pickText(state, 'error', lang) }, t.appFlow.cutoutFailed))
          }
          if (state.status === 'cancelled') {
            setCutoutStopping(false)
            alert(pickText(state, 'message', lang) || t.appFlow.cutoutStopped)
            return
          }
          if (state.status === 'done') data = state.result
        } catch (error) {
          if (isFatalJobError(error)) throw error
          transientErrors += 1
          if (transientErrors >= 3) throw error
        }
      }
      reportGeometryBindings.current.cut = reportGeometryContext
      invalidateBoardAnalysis()
      setCutScene(data.preview)
      const actualExtent = String(data.actual_extent_type || extentType)
      setReportCutoutRecord({ context: reportGeometryContext, source_evidence: reportEvidence,
        data: { before: beforeScene, boundary: data.estimated_boundary_mm || null, extent_type: actualExtent } })
      setActualCutoutExtentType(actualExtent)
      if (actualExtent !== extentType) {
        setExtentType(actualExtent)
        setPreciseBoundaryPreview(data.estimated_boundary_mm || null)
        setPreciseBoundaryPreviewKey(
          cutoutBoundaryKey(signalNets, refNets, expansionMm, actualExtent),
        )
        alert(t.appFlow.theSelectedCouldNotBeCompleted(EXTENT_LABEL[extentType] || extentType)
          + t.appFlow.safelyFellBackTo(EXTENT_LABEL[actualExtent] || actualExtent)
          + String(data.fallback_reason || ''))
      }
      setActiveView('cut')
      setWorkingPath(data.output_path)
      // 裁切直接在 session 目前開著的檔上做，輸入就是發出請求時的 workingPath。
      setReportLineage(previous => appendLineage(previous, 'cutout', workingPath, data.output_path))
      setCleanupAnalysis(null)
      setCleanupBeforeScene(null)
      setCleanupAfterScene(null)
      // 分段狀態重置與預設輸出資料夾
      setSegAnalysis(null)
      setSegRun(null); setSegFollowPlan(null)
    } catch (e) {
      alert(t.appFlow.cutoutFailed77 + errorText(e, lang), 'error')
    } finally {
      edbActionRef.current = false
      setCutoutJobId('')
      setCutoutStopping(false)
      setIsLoading(false)
    }
  }

  // 已裁切好的檔案：跳過裁切，只建立元件端 Port 與求解器設定。
  // 直接匯入模式若不做這一步，通道頭尾不會有元件端 Port，分段與求解都白做。
  const handlePortsSetup = async () => {
    if (edbActionRef.current) return
    if (signalNets.length === 0) { alert(t.appFlow.selectSignalNetsFirst); return }
    if (refNets.length === 0) { alert(t.appFlow.selectReferenceNetsFirstEGGnd); return }
    const comps = Object.keys(checkedComps).filter(c => checkedComps[c])
    if (comps.length === 0) { alert(t.appFlow.selectEndpointComponentsForPortCreationFirst); return }
    if (!portsOutputPath) { alert(t.appFlow.setAnOutputPath); return }
    edbActionRef.current = true
    setLoadingMsg((t) => t.appFlow.preparingPortCreation)
    setIsLoading(true)
    setCutoutStopping(false)
    try {
      let overwriteExisting: boolean | null
      try {
        overwriteExisting = await confirmOutputOverwrite(portsOutputPath, t.appFlow.portAndSolverSetup)
      } catch (e) {
        alert(t.appFlow.unableToCheckOutputPath + errorText(e, lang), 'error'); return
      }
      if (overwriteExisting === null) return
      const started = await api('/api/ports_setup', {
        signal_nets: signalNets,
        reference_nets: refNets,
        port_components: comps,
        port_type: portType,
        output_path: portsOutputPath,
        overwrite_existing: overwriteExisting,
        solution_freq: parseFloat(solutionFreq) || 25,
        sweep_type: sweepType,
        sweeps: sweeps,
        error_tolerance_pct: parseFloat(errorTolerance) || 0.1,
        max_passes: parseInt(maxPasses, 10) || 20,
        max_delta_s: parseFloat(maxDeltaS) || 0.02,
        adaptive_mode: adaptiveMode,
        parallel_refinement: parallelRefinement,
        max_refinement_per_pass: parseInt(maxRefinementPerPass, 10) || 15,
        min_converged_passes: parseInt(minConvergedPasses, 10) || 2,
      })
      const jobId = started.job_id as string
      setCutoutJobId(jobId)
      let data: any = null
      let transientErrors = 0
      while (!data) {
        await new Promise(resolve => window.setTimeout(resolve, 2000))
        try {
          const state = await api(`/api/cutout/status?job_id=${encodeURIComponent(jobId)}`)
          transientErrors = 0
          const elapsed = state.started_at ? Math.max(0, Date.now() / 1000 - state.started_at) : 0
          const countText = state.total ? t.appFlow.processedCount(state.processed || 0, state.total) : ''
          setLoadingMsg((t, lang) => t.appFlow.jobProgressWithCount(pickText(state, 'message', lang) || t.appFlow.creatingPorts, state.progress || 0, countText, formatElapsed(elapsed)))
          if (state.status === 'error') {
            throw fatalJobError(describeJobFailure({ message: pickText(state, 'message', lang), error: pickText(state, 'error', lang) }, t.appFlow.portCreationFailed))
          }
          if (state.status === 'cancelled') {
            setCutoutStopping(false)
            alert(pickText(state, 'message', lang) || t.appFlow.portCreationStopped)
            return
          }
          if (state.status === 'done') data = state.result
        } catch (error) {
          if (isFatalJobError(error)) throw error
          transientErrors += 1
          if (transientErrors >= 3) throw error
        }
      }
      reportGeometryBindings.current.cut = reportGeometryContext
      invalidateBoardAnalysis()
      setCutScene(data.preview)
      setActiveView('cut')
      setWorkingPath(data.output_path)
      setReportLineage(previous => appendLineage(previous, 'ports', data.source_path || workingPath, data.output_path))
      setCleanupAnalysis(null)
      setCleanupBeforeScene(null)
      setCleanupAfterScene(null)
      setSegAnalysis(null)
      setSegRun(null); setSegFollowPlan(null)
      const names: string[] = data.component_port_names || []
      alert(
        t.appFlow.createdComponentPortsComponents(names.length, data.port_component_count)
        + t.appFlow.output(data.output_path)
        + t.appFlow.theNextNSegmentSplitAndSolve,
        'success',
      )
    } catch (e) {
      alert(t.appFlow.portCreationFailed93 + errorText(e, lang), 'error')
    } finally {
      edbActionRef.current = false
      setCutoutJobId('')
      setCutoutStopping(false)
      setIsLoading(false)
    }
  }

  // ── 6c 疊構更換 ─────────────────────────────────────
  const handleStackupExport = async () => {
    if (allNets.length === 0) { alert(t.appFlow.loadAnEdbFirst); return }
    const suggested = stripExtension(inputPath || 'stackup')
      + `_stackup.${stackupExportFormat}`
    setIsLoading(true); setLoadingMsg((t) => t.appFlow.exportingStackup)
    try {
      const data = await api('/api/stackup/export',
        { output_path: suggested, file_format: stackupExportFormat })
      alert(t.appFlow.exportedLayers(data.layer_count, data.output_path), 'success')
      if (!stackupFilePath) setStackupFilePath(data.output_path)
    } catch (e) {
      alert(t.appFlow.stackupExportFailed + errorText(e, lang), 'error')
    } finally { setIsLoading(false) }
  }

  const handleStackupAnalyze = async () => {
    if (!stackupFilePath) { alert(t.appFlow.specifyAStackupFileFirst); return }
    const epoch = boardAnalysisEpoch.current
    const diffEpoch = ++stackupDiffEpoch.current
    setIsLoading(true); setLoadingMsg((t) => t.appFlow.comparingStackupDifferences)
    try {
      const data = await api('/api/stackup/analyze', { file_path: stackupFilePath })
      if (epoch !== boardAnalysisEpoch.current || diffEpoch !== stackupDiffEpoch.current) return
      setStackupDiff(data)
      setStackupConfirmRemoval(false)
      suggestOutputPath('stackup', '_stackup.aedb',
                        stackupOutputPath, setStackupOutputPath)
    } catch (e) {
      if (epoch !== boardAnalysisEpoch.current || diffEpoch !== stackupDiffEpoch.current) return
      setStackupDiff(null)
      alert(t.appFlow.stackupAnalysisFailed + errorText(e, lang), 'error')
    } finally { if (epoch === boardAnalysisEpoch.current) setIsLoading(false) }
  }

  const handleStackupApply = async () => {
    if (!stackupDiff) { alert(t.appFlow.analyzeTheDifferencesFirst); return }
    if (!stackupOutputPath) { alert(t.appFlow.setAnOutputPath); return }
    if (stackupDiff.requires_confirmation && !stackupConfirmRemoval) {
      alert(t.appFlow.thisStackupFileDeletesExistingLayersCheck); return
    }
    setLoadingMsg((t) => t.appFlow.preparingStackupReplacement); setIsLoading(true); setCutoutStopping(false)
    try {
      const started = await api('/api/stackup/apply', {
        file_path: stackupFilePath,
        output_path: stackupOutputPath,
        confirm_layer_removal: stackupConfirmRemoval,
      })
      const jobId = started.job_id as string
      setCutoutJobId(jobId)
      let data: any = null
      let transientErrors = 0
      while (!data) {
        await new Promise(resolve => window.setTimeout(resolve, 1500))
        try {
          const state = await api(`/api/cutout/status?job_id=${encodeURIComponent(jobId)}`)
          transientErrors = 0
          const elapsed = state.started_at ? Math.max(0, Date.now() / 1000 - state.started_at) : 0
          setLoadingMsg((t, lang) => t.appFlow.jobProgress(pickText(state, 'message', lang) || t.appFlow.replacingStackup, state.progress || 0, formatElapsed(elapsed)))
          if (state.status === 'error') {
            throw fatalJobError(describeJobFailure({ message: pickText(state, 'message', lang), error: pickText(state, 'error', lang) }, t.appFlow.stackupReplacementFailed))
          }
          if (state.status === 'cancelled') { alert(pickText(state, 'message', lang) || t.appFlow.stackupReplacementStopped); return }
          if (state.status === 'done') data = state.result
        } catch (error) {
          if (isFatalJobError(error)) throw error
          transientErrors += 1
          if (transientErrors >= 3) throw error
        }
      }
      reportGeometryBindings.current.cut = reportGeometryContext
      invalidateBoardAnalysis()
      setCutScene(data.preview)
      setActiveView('cut')
      setWorkingPath(data.output_path)
      setReportLineage(previous => appendLineage(previous, 'stackup', data.source_path || workingPath, data.output_path))
      setStackupDiff(null)
      setSegAnalysis(null); setSegRun(null); setSegFollowPlan(null)
      alert(t.appFlow.stackupReplacedLayersLayers(data.layer_count_before, data.layer_count_after)
        + t.appFlow.outputReport(data.output_path, data.report_path), 'success')
    } catch (e) {
      alert(t.appFlow.stackupReplacementFailed111 + errorText(e, lang), 'error')
    } finally {
      setCutoutJobId(''); setCutoutStopping(false); setIsLoading(false)
    }
  }

  // ── 6d 背鑽 ────────────────────────────────────────
  const handleBackdrillAnalyze = async () => {
    if (!validLengths()) return
    if (signalNets.length === 0) { alert(t.appFlow.selectSignalNetsFirst); return }
    // 不能用 `parseFloat(x) || 5`：使用者填的 0 會被靜默改成 5 mil。
    const stubMil = Number(bdTargetStubMil)
    if (bdTargetStubMil.trim() === '' || !Number.isFinite(stubMil) || stubMil < 0) {
      alert(t.appFlow.retainedStubMustBeANumber0); return
    }
    const incMil = Number(bdDiameterIncMil)
    if (bdDrillOversize && (bdDiameterIncMil.trim() === '' || !Number.isFinite(incMil) || incMil < 0)) {
      alert(t.appFlow.drillDiameterIncrementMustBeANumber); return
    }
    const epoch = boardAnalysisEpoch.current
    const inputKey = backdrillInputKey
    const isCurrent = () => epoch === boardAnalysisEpoch.current
      && inputKey === backdrillInputKeyRef.current
    setBdResult(null)
    setIsLoading(true); setLoadingMsg((t) => t.appFlow.analyzingSignalViaStubs)
    try {
      const data = await api('/api/backdrill/analyze', {
        signal_nets: signalNets,
        target_stub_mil: stubMil,
        diameter_increment_mil: bdDrillOversize ? incMil : 0,
      })
      if (!isCurrent()) return
      setBdResult({ ...data, input_key: inputKey })
      suggestOutputPath('backdrill', '_backdrill.aedb',
                        bdOutputPath, setBdOutputPath)
    } catch (e) {
      if (!isCurrent()) return
      setBdResult(null)
      alert(t.appFlow.backdrillAnalysisFailed + errorText(e, lang), 'error')
    } finally { if (epoch === boardAnalysisEpoch.current) setIsLoading(false) }
  }

  const toggleBackdrillStub = (entryIndex: number, stubIndex: number) => {
    if (!bdResult) return
    const entries = bdResult.entries.map((entry: any, i: number) => {
      if (i !== entryIndex) return entry
      return {
        ...entry,
        stubs: entry.stubs.map((stub: any, j: number) =>
          j === stubIndex ? { ...stub, selected: !stub.selected } : stub),
      }
    })
    setBdResult({ ...bdResult, entries })
  }

  const handleBackdrillApply = async () => {
    if (!validLengths()) return
    if (!bdResult || !bdResult.analysis_key || bdResult.input_key !== backdrillInputKeyRef.current) {
      setBdResult(null)
      alert(t.appFlow.runAnalysisFirst); return
    }
    if (!bdOutputPath) { alert(t.appFlow.setAnOutputPath); return }
    if ((bdResult.warnings || []).length > 0
        && !await confirm(t.appFlow.applyBackdrillWithThisRetainedStubAnyway(pickList(bdResult, 'warnings', lang, unit).join('\n')))) return
    // F3：覆寫既有背鑽一律走工具自己的置中確認窗（await），取消就不送；後端另有 StrictBool 旗標把關
    const requiresExistingOverride = bdResult.entries.some((entry: any) => (entry.stubs || []).some((stub: any) => {
      const existing = stub.existing_backdrill
      if (stub.selected === false || !existing?.exists) return false
      return stub.drill_depth_mm == null || existing.depth_mm == null
        || stub.drill_diameter_mm == null || existing.drill_diameter_mm == null
        || Number(stub.drill_depth_mm) < Number(existing.depth_mm) - 1e-9
        || Number(stub.drill_diameter_mm) < Number(existing.drill_diameter_mm) - 1e-9
    }))
    if (requiresExistingOverride && !await confirm(t.appFlow.confirmExistingBackdrillOverride)) return
    // 確認框開著時頁面仍在跑（不像原生 confirm 會凍結）：回答後再核一次分析仍對應目前輸入。
    if (bdResult.input_key !== backdrillInputKeyRef.current) { setBdResult(null); alert(t.appFlow.runAnalysisFirst); return }
    setLoadingMsg((t) => t.appFlow.preparingBackdrill); setIsLoading(true); setCutoutStopping(false)
    try {
      const started = await api('/api/backdrill/apply', {
        output_path: bdOutputPath, entries: bdResult.entries,
        analysis_key: bdResult.analysis_key,
        signal_nets: signalNets,
        target_stub_mil: Number(bdTargetStubMil),
        diameter_increment_mil: bdDrillOversize ? Number(bdDiameterIncMil) : 0,
        confirm_existing_backdrill_override: requiresExistingOverride,
      })
      const jobId = started.job_id as string
      setCutoutJobId(jobId)
      let data: any = null
      let transientErrors = 0
      while (!data) {
        await new Promise(resolve => window.setTimeout(resolve, 1500))
        try {
          const state = await api(`/api/cutout/status?job_id=${encodeURIComponent(jobId)}`)
          transientErrors = 0
          const elapsed = state.started_at ? Math.max(0, Date.now() / 1000 - state.started_at) : 0
          setLoadingMsg((t, lang) => t.appFlow.jobProgress(pickText(state, 'message', lang) || t.appFlow.backdrilling, state.progress || 0, formatElapsed(elapsed)))
          if (state.status === 'error') {
            throw fatalJobError(describeJobFailure({ message: pickText(state, 'message', lang), error: pickText(state, 'error', lang) }, t.appFlow.backdrillFailed))
          }
          if (state.status === 'cancelled') { alert(pickText(state, 'message', lang) || t.appFlow.backdrillStopped); return }
          if (state.status === 'done') data = state.result
        } catch (error) {
          if (isFatalJobError(error)) throw error
          transientErrors += 1
          if (transientErrors >= 3) throw error
        }
      }
      reportGeometryBindings.current.cut = reportGeometryContext
      invalidateBoardAnalysis()
      setCutScene(data.preview)
      setActiveView('cut')
      setWorkingPath(data.output_path)
      setReportLineage(previous => appendLineage(previous, 'backdrill', data.source_path || workingPath, data.output_path))
      setBdResult(null)
      setSegAnalysis(null); setSegRun(null); setSegFollowPlan(null)
      alert(t.appFlow.backdrillCompleteSectionsSucceededFailed(data.applied_count, data.failed_count)
        + t.appFlow.outputReport(data.output_path, data.report_path),
        Number(data.failed_count) > 0 ? 'warning' : 'success')
    } catch (e) {
      alert(t.appFlow.backdrillFailed127 + errorText(e, lang), 'error')
    } finally {
      setCutoutJobId(''); setCutoutStopping(false); setIsLoading(false)
    }
  }

  const handleStopCutout = async () => {
    if (!cutoutJobId || cutoutStopping) return
    setCutoutStopping(true)
    setLoadingMsg((t) => t.appFlow.stopRequestedWaitingForTheCurrentPyedb)
    try {
      await api(`/api/cutout/stop?job_id=${encodeURIComponent(cutoutJobId)}`, {})
    } catch (e) {
      setCutoutStopping(false)
      alert(t.appFlow.failedToStopCutout + errorText(e, lang), 'error')
    }
  }

  // ── Layout 保守清理 ────────────────────────────────────
  const applyCleanupRecommendedSettings = () => {
    resetLengths({ cleanupGuardMm: '0.2' })
    setCleanupMode('em_field')
    setCleanupGuardMm('0.2')
    setCleanupIsolationDb('40')
    setCleanupAnalysis(null)
    setCleanupBeforeScene(null)
    setCleanupAfterScene(null)
  }

  const handleCleanupAnalyze = async () => {
    if (!validLengths()) return
    if (!canSegment) { alert(t.appFlow.completeCutoutFirstOrLoadTheChannel); return }
    if (signalNets.length === 0 || refNets.length === 0) {
      alert(t.appFlow.selectSignalAndReferenceNetsFirst); return
    }
    setLoadingMsg((t) => t.appFlow.analyzingLayoutCleanupCandidates)
    setIsLoading(true)
    try {
      const data = await api('/api/cleanup/analyze', {
        signal_nets: signalNets,
        reference_nets: refNets,
        guard_mm: Number(cleanupGuardMm),
        mode: cleanupMode,
        isolation_db: parseFloat(cleanupIsolationDb) || 40,
      })
      setCleanupAnalysis(data)
      setActiveView(cutScene ? 'cut' : 'full')
    } catch (e) {
      alert(t.appFlow.layoutCleanupAnalysisFailed + errorText(e, lang), 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCleanupRun = async () => {
    if (!validLengths()) return
    if (!cleanupAnalysis) { alert(t.appFlow.analyzeCleanupCandidatesFirst); return }
    if (!cleanupOutputPath) { alert(t.appFlow.setACleanupOutputPath); return }
    let overwriteExisting: boolean | null
    try {
      overwriteExisting = await confirmOutputOverwrite(cleanupOutputPath, t.appFlow.layoutCleanup)
    } catch (e) {
      alert(t.appFlow.unableToCheckOutputPath + errorText(e, lang), 'error'); return
    }
    if (overwriteExisting === null) return
    setLoadingMsg((t) => t.appFlow.savingACopyAndCleaningLayoutThis)
    setIsLoading(true)
    try {
      const beforeScene = cutScene || fullScene
      const reportEvidence = await captureBeforeAnalysis('cleanup', [workingPath],
        [signalNets, refNets, cleanupMode, cleanupGuardMm, cleanupIsolationDb])
      const data = await api('/api/cleanup/run', {
        signal_nets: signalNets,
        reference_nets: refNets,
        guard_mm: Number(cleanupGuardMm),
        mode: cleanupMode,
        isolation_db: parseFloat(cleanupIsolationDb) || 40,
        output_path: cleanupOutputPath,
        overwrite_existing: overwriteExisting,
      })
      reportGeometryBindings.current.cut = reportGeometryContext
      invalidateBoardAnalysis()
      setCutScene(data.preview)
      reportGeometryBindings.current.cleanup = reportGeometryContext
      setCleanupBeforeScene(beforeScene)
      setCleanupAfterScene(data.preview)
      setCleanupAnalysis(data)
      setReportCleanupRecord({ context: reportGeometryContext, source_evidence: reportEvidence, data })
      setCleanupCompareMode('overlay')
      setCleanupDiffKind('all')
      setCleanupDiffLayer('')
      setCleanupFocusRegion(null)
      setWorkingPath(data.output_path)
      setReportLineage(previous => appendLineage(previous, 'cleanup', data.source_path || workingPath, data.output_path))
      setSegAnalysis(null)
      setSegRun(null); setSegFollowPlan(null)
      setActiveView('cleanup')
    } catch (e) {
      alert(t.appFlow.layoutCleanupFailed + errorText(e, lang), 'error')
    } finally {
      setIsLoading(false)
    }
  }

  // ── N 段分割 ───────────────────────────────────
  /** manualCuts 為空＝用自動位置（「回到自動刀線」走的就是這條路）。
   *  allowRelease＝使用者已在確認框接受「手動放行 D 級」。 */
  const runComplexityAnalyze = async (
    manualCuts?: { axis: number; position_mm: number }[],
    allowRelease = false,
  ) => {
    if (!canSegment) { alert(t.appFlow.completeCutoutFirstOrLoadTheChannel140); return }
    if (signalNets.length === 0) { alert(t.appFlow.selectSignalNetsInSelectNetsFirst); return }
    setLoadingMsg((t) => manualCuts?.length
      ? t.appFlow.rescoringTheNewCutPositions
      : t.appFlow.detectingComplex3dRegionsAndPlanningCuts)
    setIsLoading(true)
    try {
      const reportEvidence = await captureBeforeAnalysis('segment-quality', [workingPath],
        [signalNets, refNets, segmentQuality, targetFmaxGHz, solverBandwidth.ghz, manualCuts, allowRelease])
      const data: ComplexityAnalysis = await api(
        '/api/segment/analyze-complexity', {
          signal_nets: signalNets,
          reference_nets: refNets,
          quality_threshold: segmentQuality,
          // 兩個頻率分開送：切面以掃頻上限驗收，判斷頻寬只給求解器建議。
          target_fmax_ghz: targetFmaxGHz,
          required_bandwidth_ghz: solverBandwidth.ghz,
          cuts: manualCuts || [],
          allow_stitch_release: allowRelease,
        })
      setComplexityAnalysis(data)
      setReportQualityRecord({ context: reportGeometryContext, source_evidence: reportEvidence, data })
      setSegAnalysis(null)          // 兩種分析互斥，避免畫面同時出現兩組刀
      // 新的分析取代上一次的執行結果（等分分析一向如此）：留著的話整體視圖
      // 畫新刀、分段頁籤卻還是舊段；整片求解之後預覽也回不到分段。
      setSegRun(null); setSegFollowPlan(null)
      setActiveView('segments')
      // 拖曳時不彈視窗——面板上的紅字已經說明白了，每拖一次跳一個 modal
      // 只會讓人沒辦法連續微調。
      if (!data.feasible && !manualCuts?.length && !allowRelease) {
        alert(t.appFlow.unableToCreateAnExecutableSegmentation + pickText(data, 'reason', lang, unit))
      }
    } catch (e) {
      alert(t.appFlow.complexityBasedSegmentationAnalysisFailed + errorText(e, lang), 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleComplexityAnalyze = () => runComplexityAnalyze()

  /** 在預覽圖上把某把刀拖到新位置：整份重算，等級與分段都會跟著更新。
   *  已確認過的放行設定沿用，不必每拖一次再確認。 */
  const handleCutDrag = (cutIndex: number, positionMm: number) => {
    if (!complexityAnalysis) return
    runComplexityAnalyze(moveComplexityCut(complexityAnalysis, cutIndex, positionMm),
      Boolean(complexityAnalysis.allow_stitch_release))
  }

  /** 手動放行 D 級（縫合不足）：一定先跳確認、講清楚可信頻率。
   *  按「分析」重新來過會回到不放行，要放行得再確認一次。 */
  const handleStitchRelease = async (mode: 'axis' | 'complexity', allow: boolean) => {
    const analysis = mode === 'axis' ? segAnalysis : complexityAnalysis
    if (!analysis) return
    if (allow) {
      const { limit, target } = releaseConfirmNumbers(analysis, targetFmaxGHz)
      if (!await confirm(t.appView.stitchReleaseConfirm(limit, target))) return
    }
    if (mode === 'axis') runSegmentAnalyze(allow)
    else runComplexityAnalyze(undefined, allow)
  }

  const handleSegmentAnalyze = () => runSegmentAnalyze(false)

  const runSegmentAnalyze = async (allowRelease: boolean) => {
    const n = parseInt(nSegments, 10)
    if (!canSegment) { alert(t.appFlow.runLocalCutoutFirstOrLoadAn); return }
    if (signalNets.length === 0) { alert(t.appFlow.selectSignalNetsInSelectNetsFirst147); return }
    if (!n || n < 2) { alert(t.appFlow.segmentCountNMustBeAtLeast); return }
    setLoadingMsg((t) => t.appFlow.analyzingCutPositions)
    setIsLoading(true)
    try {
      const reportEvidence = await captureBeforeAnalysis('segment-quality', [workingPath],
        [n, signalNets, refNets, segmentQuality, targetFmaxGHz, allowRelease])
      const data = await api('/api/segment/analyze', {
        n_segments: n,
        signal_nets: signalNets,
        reference_nets: refNets,
        quality_threshold: segmentQuality,
        // 網格方法不在這裡送：`/api/segment/analyze` 只算切點，不寫任何檔，
        // 後端的 SegmentAnalyzeRequest 也沒有這個欄位（pydantic 安靜丟掉）。
        // 真正會把它寫進 segments.json 的是 /api/segment/run 與 run-single。
        target_fmax_ghz: targetFmaxGHz,
        allow_stitch_release: allowRelease,
      })
      setSegAnalysis(data)
      setReportQualityRecord({ context: reportGeometryContext, source_evidence: reportEvidence, data })
      setComplexityAnalysis(null)
      setShowSegmentSafetyOverlay(true)
      setShowSegmentCutDiagnostics(true)
      setSegRun(null); setSegFollowPlan(null)
      setActiveView('segments')
    } catch (e) {
      alert(t.appFlow.segmentationAnalysisFailed + errorText(e, lang), 'error')
    } finally {
      setIsLoading(false)
    }
  }

  // ── 遠端求解包 ──────────────────────────────────────
  // 求解機通常不能裝 Python、也未必有相同版本 AEDT，因此不走 PyAEDT 遠端，
  // 改成把 EDB 與 PowerShell 腳本打包成資料夾讓使用者複製過去執行。
  const handleBuildRemotePack = async () => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert(t.appFlow.runNSegmentSplittingFirstOrEnter); return }
    const outDir = normalizeUserPath(packDir)
    if (!outDir) { alert(t.appFlow.specifyANewOutputFolderForThe); return }
    if (solverCoresValue === null) { alert(t.solverCores.invalid); return }
    setPackBusy(true)
    try {
      // 走 api：它會先取文字再解析，非 JSON 的回應（舊後端讓 POST 撞上
      // StaticFiles 得到 405 的那種）才不會變成「Unexpected token '<'」，
      // 422 的 detail 陣列也才不會印成 [object Object]。
      const data = await api('/api/remote/pack', {
        metadata_path: metadataPath,
        output_dir: outDir,
        sweep_type: sweepType,
        sweeps,
        error_tolerance_pct: parseFloat(errorTolerance) || 0.1,
        siwave_num_interp_points: 150,
        num_cores: solverCoresValue,
        segment_indices: [],
      })
      const packedTxt = (data.packed || [])
        .map((x: any) => t.appFlow.segmentPorts(x.index, x.port_count)).join(t.appFlow.listSeparator)
      const skippedTxt = (data.skipped || []).length
        ? t.appFlow.excluded + (data.skipped as any[])
            .map((x: any) => t.appFlow.segment(x.index, pickText(x, 'reason', lang))).join('\n')
        : ''
      alert(
        t.appFlow.solvePackageCreated + data.output_dir +
        t.appFlow.included + packedTxt + skippedTxt +
        t.appFlow.next +
        t.appFlow.step1WaitForCopyingToFinishThen +
        t.appFlow.step2DoubleClickRunAllBatOn +
        t.appFlow.step3CopyTheResultsFolderBackWhen,
        'success',
      )
      // 換成新的時間戳：同一個資料夾再匯出一次會被後端擋下。
      setPackDir(suggestPackDir(metadataPath))
    } catch (e: any) {
      alert(t.appFlow.failedToCreateSolvePackage + (e?.message || errorText(e, lang)), 'error')
    } finally {
      setPackBusy(false)
    }
  }

  // 收回求解包結果：驗證 Port 數與格式後寫回 segments.json，
  // 之後串接與眼圖都能直接用，不必再走「外部 S 參數檔」。
  const handleIngestResults = async () => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert(t.appFlow.runNSegmentSplittingFirstOrEnter); return }
    const dir = normalizeUserPath(ingestDir)
    if (!dir) { alert(t.appFlow.specifyTheSolveResultsFolderTheSolve); return }
    setIngestBusy(true)
    try {
      const data = await api('/api/remote/ingest',
        { metadata_path: metadataPath, results_path: dir })
      const okTxt = (data.ingested || [])
        .map((x: any) => t.appFlow.segmentPorts166(x.index, x.port_count, x.stale ? t.appFlow.stale : ''))
        .join(t.appFlow.listSeparator)
      const badTxt = (data.failed || []).length
        ? t.appFlow.validationFailed + (data.failed as any[])
            .map((x: any) => t.appFlow.segment(x.index, pickText(x, 'reason', lang))).join('\n')
        : ''
      // 收回了但不能沿用（例如沒有設定指紋）：不算收回成功，要重新求解。
      const unusableTxt = (data.unusable || []).length
        ? t.appFlow.retrievedButCannotBeReusedSolveAgain + (data.unusable as any[])
            .map((x: any) => t.appFlow.segment(x.index, pickText(x, 'reason', lang))).join('\n')
        : ''
      const missTxt = (data.missing || []).length
        ? t.appFlow.missingSegments + (data.missing as any[]).join(t.appFlow.listSeparator)
        : ''
      alert(t.appFlow.retrieved + (okTxt || t.appFlow.none) + badTxt + unusableTxt + missTxt,
        okTxt && !badTxt && !unusableTxt && !missTxt ? 'success' : 'warning')
      await loadSegmentSolverPlan(metadataPath, false)
    } catch (e: any) {
      alert(t.appFlow.failedToRetrieveResults + (e?.message || errorText(e, lang)), 'error')
    } finally {
      setIngestBusy(false)
    }
  }

  // ── 排程模擬：啟動 / 停止 / 輪詢 ──────────────────────
  // 這次排程「可能」會用到哪些求解器：有分段規劃就照每段的求解器，沒有就是 HFSS。
  // 只拿來標示；能沿用快取的段不需要授權，哪些段要求解只有後端知道，所以不據此
  // 停用按鈕，由後端開工前檢查（repo 審查第 11 輪）。
  const scheduleFunctions: AnsysFunction[] = segmentSolverPlans.length > 0
    ? Array.from(new Set(segmentSolverPlans.map(plan =>
        plan.requested_solver === 'siwave' ? 'siwave_solve' as const : 'hfss3dlayout_solve' as const)))
    : ['hfss3dlayout_solve']
  const scheduleBlock = licenseBlock(licenseStatus, scheduleFunctions)
  const hfssExportBlock = licenseBlock(licenseStatus, ['hfss3dlayout_export'])
  // 載入：ODB++（.tgz）要轉檔，會 checkout al4odb++；.aedb 不占授權（實測）。
  const loadFunctions: AnsysFunction[] = /\.tgz\s*"?$/i.test(inputPath) ? ['odbpp_import'] : []
  const loadBlock = licenseBlock(licenseStatus, loadFunctions)
  const handleScheduleStart = async () => {
    if (schedStartRef.current || schedStatus?.running || cascadeBusy || circuitBusyRef.current) return
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert(t.appFlow.runNSegmentSplittingFirstOrEnter); return }
    if (solverCoresValue === null) { alert(t.solverCores.invalid); return }
    setSchedMetaPath(metadataPath)
    // 同步 ref 擋下同一影格的重複點擊；狀態立即顯示，涵蓋讀取計畫的等待。
    schedStartRef.current = true
    setSchedStartingAt(Date.now() / 1000)
    setSchedStartPhase((t) => t.operationFeedback.loadingPlan)
    try {
      let plans = segmentSolverPlans
      if (plans.length === 0 || (loadedPlanPath.current !== metadataPath
          && normalizeUserPath(segRun?.metadata_path || '') !== metadataPath)) {
        const loaded = await loadSegmentSolverPlan(metadataPath, false)
        if (!loaded) return
        plans = loaded?.segments || []
      }
      const segmentSolvers = Object.fromEntries(
        plans.map((plan: SegmentSolverPlan) => [plan.index, plan.requested_solver])
      )
      setSchedStartPhase((t) => t.operationFeedback.startingSchedule)
      const s = await api('/api/schedule/start', {
        metadata_path: metadataPath,
        solver: plans.length > 0 ? 'mixed' : 'hfss',
        segment_solvers: segmentSolvers,
        sweep_type: sweepType,
        sweeps,
        error_tolerance_pct: parseFloat(errorTolerance) || 0.1,
        siwave_num_interp_points: 150,
        hfss_mesh_method: hfssMeshMethod,
        num_cores: solverCoresValue,
        memory_percent: parseInt(solverMemoryPercent, 10) || 90,
        solution_freq: parseFloat(solutionFreq) || 25,
        max_passes: parseInt(maxPasses, 10) || 20,
        max_delta_s: parseFloat(maxDeltaS) || 0.02,
        adaptive_mode: adaptiveMode,
        parallel_refinement: parallelRefinement,
        max_refinement_per_pass: parseInt(maxRefinementPerPass, 10) || 15,
        min_converged_passes: parseInt(minConvergedPasses, 10) || 2,
      })
      setSchedStatus(s)
    } catch (e) {
      alert(t.appFlow.failedToStartSchedule + errorText(e, lang), 'error')
    } finally {
      schedStartRef.current = false
      setSchedStartingAt(null)
    }
  }

  const handleScheduleStop = async () => {
    try {
      const s = await api('/api/schedule/stop', {})
      setSchedStatus(s)
      // SIwave 段沒有中途停止的方法，要等它解完：照實告訴使用者在等什麼。
      if (s?.stop_message) alert(t.appFlow.stopRequested + s.stop_message)
    } catch (e) {
      alert(t.appFlow.stopFailed + errorText(e, lang), 'error')
    }
  }

  /** 只保留最近一次成功載入的路徑；過時回應不得覆蓋較新的分段來源。 */
  const loadedPlanPath = useRef('')
  const segPlanLoadRequest = useRef(0)
  const [segPlanLoadError, setSegPlanLoadError] = useState<unknown>(null)

  const loadSegmentSolverPlan = async (metadataPath = schedMetaPath, showError = true,
                                       _opts: { restoring?: boolean } = {}) => {
    const path = normalizeUserPath(metadataPath)
    const request = ++segPlanLoadRequest.current
    setSegPlanLoadError(null)
    // 檔案重載是新的呈現來源，不能沿用舊刀位或舊 EDB 的分段按鈕。
    // 先撤銷整組狀態，失敗時也不會留下「新路徑＋舊執行結果」。
    loadedPlanPath.current = ''
    setSegAnalysis(null)
    setComplexityAnalysis(null)
    setSegRun(null)
    setActiveSegIdx(-1)
    setSegmentSolverPlans([])
    setSegPlanBandwidthGHz(undefined)
    setSegFollowPlan(null)
    if (!path) return null
    try {
      const data = await api(`/api/schedule/plan?metadata_path=${encodeURIComponent(path)}`)
      if (request !== segPlanLoadRequest.current) return null
      if (!Array.isArray(data.segments) || data.segments.length === 0) {
        throw flowError(t => t.appFlow.noUsableSegments)
      }
      loadedPlanPath.current = path
      setSegmentSolverPlans(data.segments || [])
      setSegPlanBandwidthGHz(data.segments?.length
        ? (data.segments[0].required_bandwidth_ghz ?? undefined) : undefined)
      setShowSolverRegionOverlay(true)
      // 載入的檔案就是要求解的東西，預覽改跟著它；畫面上的分析段數對不上時
      // 改畫檔案自己的切點，不留舊段。
      setSegFollowPlan({ source: 'file', direction: data.direction, positions_mm: data.positions_mm || [] })
      return data
    } catch (error) {
      if (request !== segPlanLoadRequest.current) return null
      setSegPlanLoadError(error)
      if (showError) alert(t.appFlow.failedToLoadMixedSolverPlan + errorText(error, lang), 'error')
      return null
    }
  }

  // 只送「使用者這次真的動過的那幾段」。
  //
  // 後端的 overridden 語意是「曾經明確指派」（不是「指派 != 建議」），而
  // 明確指派過的段之後就不再跟著自動重評走（例如改了頻寬）。所以每次儲存
  // 都把全部分段送出去，等於使用者只改一段、其餘各段的自動重評全被凍結。
  const saveSegmentSolverPlans = async (
    plans: SegmentSolverPlan[],
    changedIndices: number[],
    // false＝「這幾段交還給自動評估」（後端會清掉指派並回到建議值）。
    overridden = true,
  ) => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) return
    setSegmentSolverPlans(plans)
    if (changedIndices.length === 0) return
    const changed = new Set(changedIndices)
    try {
      const data = await api('/api/schedule/plan', {
        metadata_path: metadataPath,
        assignments: plans
          .filter(plan => changed.has(plan.index))
          .map(plan => ({
            index: plan.index,
            solver: plan.requested_solver,
            overridden,
          })),
      })
      setSegmentSolverPlans(data.segments || plans)
    } catch (error) {
      await loadSegmentSolverPlan(metadataPath, false)
      alert(t.appFlow.failedToSaveMixedSolverPlan + errorText(error, lang), 'error')
    }
  }

  const handleSegmentSolverChange = async (
    index: number,
    requestedSolver: 'hfss' | 'siwave',
  ) => {
    const current = segmentSolverPlans.find(plan => plan.index === index)
    if (!current || current.requested_solver === requestedSolver) return
    if (
      requestedSolver === 'siwave'
      && current.recommended_solver === 'hfss'
      && !await confirm(t.publicUi.changeSolver)
    ) return
    const next = segmentSolverPlans.map(plan => plan.index === index
      ? {
          ...plan,
          requested_solver: requestedSolver,
          // 按下去就是明確指派，即使剛好等於建議；語意與後端一致。
          overridden: true,
          result_stale: Boolean(plan.touchstone),
        }
      : plan)
    await saveSegmentSolverPlans(next, [index])
  }

  const applySegmentSolverPreset = async (
    preset: 'recommended' | 'hfss' | 'siwave',
  ) => {
    if (
      preset === 'siwave'
      && segmentSolverPlans.some(plan => plan.recommended_solver === 'hfss')
      && !await confirm(t.appFlow.hfssIsRecommendedForSomeSegmentsDue)
    ) return
    // 「全部改 HFSS／SIwave」是對每一段都下指令，整批都算明確指派。
    //
    // 「套用自動建議」不是——它的意思是「全部交還給自動評估」。以前整批送出
    // `overridden: true`，於是按了這顆「回到自動」的按鈕之後，自動評估反而
    // 從此凍結（overridden 的段不跟著頻寬重評走）。後端現在收得下
    // `overridden: false`，會清掉指派、把 requested 同步回 recommended，
    // 所以這裡整批送出、明講「這不是手動指派」。
    const auto = preset === 'recommended'
    const next = segmentSolverPlans.map(plan => {
      const requested = auto ? plan.recommended_solver : preset
      const changed = plan.requested_solver !== requested
      return {
        ...plan,
        requested_solver: requested,
        overridden: !auto,
        result_stale: changed && Boolean(plan.touchstone),
      }
    })
    await saveSegmentSolverPlans(next, next.map(plan => plan.index), !auto)
  }

  const handlePreciseBoundaryPreview = async () => {
    if (!validLengths()) return
    if (signalNets.length === 0) { alert(t.appFlow.selectSignalNetsFirst); return }
    if (refNets.length === 0) { alert(t.appFlow.selectReferenceNetsFirstEGGnd); return }
    setLoadingMsg((t) => t.appFlow.analyzingTheExactBoundaryWithThePyedb)
    setIsLoading(true)
    setCutoutStopping(false)
    setBoundaryPreviewStartedAt(Date.now() / 1000)
    try {
      const data = await runBoundaryPreviewJob(api, {
        signal_nets: signalNets,
        reference_nets: refNets,
        expansion_mm: Number(expansionMm),
        extent_type: extentType,
      }, { started: job => setCutoutJobId(job.job_id) })
      if (!data) return
      const actualExtent = String(data.actual_extent_type || extentType)
      setPreciseBoundaryPreview(data.estimated_boundary_mm || null)
      setPreciseBoundaryPreviewKey(
        cutoutBoundaryKey(signalNets, refNets, expansionMm, actualExtent),
      )
      setBoundaryAreaSaving(
        typeof data.area_saving_percent === 'number'
          ? data.area_saving_percent : null,
      )
      if (actualExtent !== extentType) {
        setExtentType(actualExtent)
        alert(
          t.appFlow.pyedbPreflightFoundThatCannotBeUsed(EXTENT_LABEL[extentType] || extentType)
          + t.appFlow.theExactPreviewNowUses(EXTENT_LABEL[actualExtent] || actualExtent)
          + String(data.fallback_reason || ''),
        )
      }
    } catch (e) {
      alert(t.appFlow.exactCutoutBoundaryAnalysisFailed + errorText(e, lang), 'error')
    } finally {
      setBoundaryPreviewStartedAt(null)
      setCutoutJobId('')
      setCutoutStopping(false)
      setIsLoading(false)
    }
  }

  const handleRetryTouchstoneExports = async (segmentIndex?: number) => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert(t.appFlow.provideASegmentsJsonPathFirst); return }
    try {
      const endpoint = segmentIndex === undefined
        ? '/api/schedule/retry_pending_exports'
        : '/api/schedule/retry_export'
      const status = await api(endpoint, {
        metadata_path: metadataPath,
        segment_index: segmentIndex,
      })
      setSchedStatus(status)
    } catch (e) {
      alert(t.appFlow.failedToStartTouchstoneReExport + errorText(e, lang), 'error')
    }
  }

  // ── 電路串接 ───────────────────────────────────
  const CASC_COLORS = ['#00e5ff', '#7ee787', '#ff8c00', '#e040fb', '#ffd600', '#ff5252']

  const handleCascadeRun = async () => {
    if (schedStartRef.current || schedStatus?.running) {
      alert(t.operationFeedback.waitForSolve)
      return
    }
    if (circuitBusyRef.current) {
      alert(t.appFlow.circuitQuickeyeIsProcessingWaitUntilIt)
      return
    }
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert(t.appFlow.completeNSegmentSplittingAndScheduledSimulation); return }
    // 分段求解器混用時，串接要把各段內插到共同頻點（B03，Beta）；請求本身看不出來，這裡先問。
    if (mixedSolverCascade && !await confirmBetaUse(['B03'])) return
    setSchedMetaPath(metadataPath)
    setCascadeBusy(true)
    try {
      const data = await api('/api/cascade/run', {
        metadata_path: metadataPath, output_path: '',
        // 混合求解報告的語言：報告中心選過就照選的，否則跟介面語言。
        report_locale: effectiveReportLocale(lang),
      })
      reportGeometryBindings.current.cascade = reportCascadeContext
      if (cascadeMode === 'tool' && schedMetaPath && data.output_path) {
        setReportWorkSources(previous => rememberWorkSource(previous, {
          metadata_path: normalizeUserPath(schedMetaPath), board_path: reportBoardPath,
          cascade_touchstone: data.output_path, channel_touchstone: data.output_path,
        }))
      }
      setCascadeResult(data)
      // 右側已經掛著的 IBIS／AMI／多道精靈要重讀「本階段的完整通道」，
      // 否則剛串好的這一份要等重新整理才會出現在捷徑裡。
      notifyCascadedChannelChanged()
    } catch (e) {
      alert(t.appFlow.circuitCascadeFailed + errorText(e, lang), 'error')
    } finally {
      setCascadeBusy(false)
    }
  }

  /** 單一外部 .sNp 直接當結果看，不接線。
   *
   *  整片板子一次解完拿到的檔就是這種——沒有段可接，但要看的東西（差動
   *  IL／RL／NEXT／FEXT）與串接結果完全相同。 */
  const handleLoadExternalSparam = async (path: string) => {
    if (!path) { alert(t.appFlow.addAnSParameterFileFirst); return }
    setCascadeBusy(true)
    try {
      const data = await api('/api/cascade/load_external', { path })
      reportGeometryBindings.current.cascade = reportCascadeContext
      if (cascadeMode === 'tool' && schedMetaPath && data.output_path) {
        setReportWorkSources(previous => rememberWorkSource(previous, {
          metadata_path: normalizeUserPath(schedMetaPath), board_path: reportBoardPath,
          cascade_touchstone: data.output_path, channel_touchstone: data.output_path,
        }))
      }
      setCascadeResult(data)
      notifyCascadedChannelChanged()
      setActiveView('sparam')
      if (!data.auto.ok) {
        alert(t.appFlow.loadedButPortRolesCouldNotBe + pickText(data.auto, 'reason', lang)
          + t.appFlow.singleEndedViewIsStillAvailableAutomatic
          + t.appFlow.andSymmetricPositiveNegativeNamesEG)
      }
    } catch (e) {
      alert(t.appFlow.failedToLoadSParameterFile + errorText(e, lang), 'error')
    } finally {
      setCascadeBusy(false)
    }
  }

  const [spExporting, setSpExporting] = useState(false)

  /** 匯出目前圖上顯示的那幾條曲線成 .xlsx。
   *
   *  資料由前端送上去而不是後端重算：使用者可能關掉某幾類、或手動加了指定
   *  Port 的曲線，重算會匯出跟畫面不一樣的東西。 */
  const handleExportSparamExcel = async (curves: SParamSeries[]) => {
    if (!curves.length) { alert(t.appFlow.noCurvesToExport); return }
    setSpExporting(true)
    try {
      const data = await api('/api/cascade/export_excel', {
        series: curves.map(c => ({ label: c.label, freq: c.freq, db: c.db })),
        mode: spMode,
        near: spData?.near || '',
        far: spData?.far || '',
        source: cascadeResult?.output_path || '',
      })
      alert(t.appFlow.exportedCurves(data.series_count, data.output_path), 'success')
    } catch (e) {
      alert(t.appFlow.excelExportFailed + errorText(e, lang), 'error')
    } finally {
      setSpExporting(false)
    }
  }

  const handleCascadeExportAs = async () => {
    const sourcePath = cascadeResult?.output_path
    if (cascadeBusy || !sourcePath) return
    setCascadeBusy(true)
    try {
      // 帶著這次串接的產出當預設檔名與目錄開啟——檔名裡的埠數與日期
      // 正是之後辨識這個檔的依據，每次要人自己想一個並不合理。
      const suggested = sourcePath
      const selected = await api(
        '/api/browse_touchstone_output'
        + (suggested ? `?suggested=${encodeURIComponent(suggested)}` : ''))
      if (!selected.path) return
      const data = await api('/api/cascade/export_touchstone', {
        source_path: sourcePath,
        output_path: selected.path,
      })
      alert(t.appFlow.touchstoneCopyExported(data.output_path), 'success')
    } catch (e) {
      alert(t.appFlow.touchstoneExportFailed + errorText(e, lang), 'error')
    } finally {
      setCascadeBusy(false)
    }
  }

  const handleCircuitExport = async () => {
    if (circuitBusyRef.current || cascadeBusy) return
    if (!cascadeResult?.output_path) {
      alert(t.appFlow.completeTheCircuitCascadeAndGenerateA)
      return
    }
    if (circuitExportMode === 'segments' && cascadeMode !== 'tool') {
      alert(t.appFlow.nSegmentDemonstrationModeRequiresThisTool)
      return
    }
    if (circuitExportMode === 'segments' && !normalizeUserPath(schedMetaPath)) {
      alert(t.appFlow.segmentDemonstrationModeRequiresASegmentsJson)
      return
    }
    circuitBusyRef.current = true
    setCircuitBusy(true)
    try {
      const selected = await api('/api/browse_circuit_output')
      if (!selected.path) return
      if (!await confirm(
        t.appFlow.startASeparateAedtCircuitSessionAnd(circuitExportMode === 'segments' ? t.appFlow.nSegmentDemonstration : t.appFlow.completeChannel, selected.path),
      )) return
      setCircuitResult(null)
      setCircuitError('')
      const data = await api('/api/circuit/export', {
        touchstone_path: cascadeResult.output_path,
        metadata_path: normalizeUserPath(schedMetaPath),
        output_path: selected.path,
        mode: circuitExportMode,
        overwrite: true,
      })
      setCircuitResult(data)
      alert(t.appFlow.pyaedtCircuitProjectExported(data.output_path), 'success')
    } catch (e) {
      setCircuitError((_t, lang) => errorText(e, lang))
      alert(t.appFlow.circuitExportFailed + errorText(e, lang), 'error')
    } finally {
      circuitBusyRef.current = false
      setCircuitBusy(false)
    }
  }

  const handleQuickEye = async () => {
    if (circuitBusyRef.current || cascadeBusy) return
    if (!cascadeResult?.output_path || !eyeSuggestion?.quick_eye_supported) {
      alert(eyeSuggestion?.note || t.appFlow.generateAComplete2PortOr4)
      return
    }
    const dataRate = Number(eyeDataRate)
    const riseTime = Number(eyeRiseTime)
    if (!(dataRate > 0) || !(riseTime > 0)) {
      alert(t.appFlow.dataRateAndRiseTimeMustBe)
      return
    }
    if (solverCoresValue === null) { alert(t.solverCores.invalid); return }
    const selectedPorts = eyeMode === 'differential'
      ? [eyeInputP, eyeInputN, eyeOutputP, eyeOutputN]
      : [eyeInputP, eyeOutputP]
    if (selectedPorts.some(port => !port) || new Set(selectedPorts).size !== selectedPorts.length) {
      alert(t.appFlow.quickeyeInputOutputPortsMustBeComplete)
      return
    }
    const mapping = eyeMode === 'differential'
      ? t.appFlow.label218(eyeInputP, eyeInputN, eyeOutputP, eyeOutputN)
      : `${eyeInputP} → ${eyeOutputP}`
    if (!await confirm(
      t.appFlow.confirmQuickeyeSettings +
      t.appFlow.mode(eyeMode === 'differential' ? t.appFlow.differential : t.appFlow.singleEnded) +
      t.appFlow.dataRateGbps(dataRate) +
      t.appFlow.riseFallTimePs(riseTime) +
      t.appFlow.ports(mapping) +
      t.appFlow.circuitWillBeCreatedAndSolvedOnly,
    )) return
    circuitBusyRef.current = true
    setCircuitBusy(true)
    try {
      // 一鍵眼圖：不再要求選輸出路徑，後端自動放在 Touchstone 同層的
      // eye_results；背景求解後由輪詢取回結果並切到「眼圖」分頁。
      setCircuitResult(null)
      setCircuitError('')
      setEyeImageRevision(0)
      const reportEvidence = await captureBeforeAnalysis('quickeye', [cascadeResult.output_path],
        [eyeMode, dataRate, riseTime, eyeInputP, eyeInputN, eyeOutputP, eyeOutputN])
      await api('/api/circuit/quick_eye', {
        touchstone_path: cascadeResult.output_path,
        mode: eyeMode,
        data_rate_gbps: dataRate,
        rise_time_ps: riseTime,
        input_p: eyeInputP,
        input_n: eyeInputN,
        output_p: eyeOutputP,
        output_n: eyeOutputN,
        confirmed: true,
        num_cores: solverCoresValue,
      })
      // 啟動回應沒有 started_at，立即讀取該次 job 身分；日後全域輪詢不能重新綁定。
      const reportEyeState = await api('/api/circuit/quick_eye/status')
      reportJobBindings.current.eye = { context: reportEyeContext, startedAt: reportEyeState.started_at, evidence: reportEvidence }
      setEyeJob(reportEyeState)
      setActiveView('eye')
    } catch (e) {
      setCircuitError((_t, lang) => errorText(e, lang))
      alert(t.appFlow.failedToStartEyeAnalysis + errorText(e, lang), 'error')
      circuitBusyRef.current = false
      setCircuitBusy(false)
    }
  }

  const handleCascadeModeChange = (mode: 'tool' | 'external') => {
    if (circuitBusyRef.current || cascadeBusy || mode === cascadeMode) return
    setCascadeMode(mode)
    setCascadeResult(null)
    setSchematicGraph(null)
    setCircuitResult(null)
    setCircuitError('')
    setEyeSuggestion(null)
    setEyeSuggestionError('')
  }

  // 串接預覽（本工具模式）：只讀 segments.json，解算前即可看接線示意圖
  const handleCascadePreview = async () => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert(t.appFlow.completeNSegmentSplittingFirstSegmentsJson); return }
    setSchedMetaPath(metadataPath)
    try {
      const g = await api('/api/cascade/preview', { metadata_path: metadataPath })
      reportGeometryBindings.current.schematic = reportCascadeContext
      setSchematicGraph(g)
      setActiveView('schematic')
    } catch (e) {
      alert(t.appFlow.previewFailed + errorText(e, lang), 'error')
    }
  }

  // 外部檔案：瀏覽多選 + 解析
  const handleBrowseTouchstone = async () => {
    try {
      const data = await api('/api/browse_touchstone')
      if (!data.paths?.length) return
      const allPaths = [...extFiles.map(f => f.path), ...data.paths.filter((p: string) => !extFiles.some(f => f.path === p))]
      const info = await api('/api/cascade/inspect_files', { paths: allPaths })
      setExtFiles(info.files)
    } catch (e) {
      alert(t.appFlow.fileParsingFailed + errorText(e, lang), 'error')
    }
  }

  const handleExtSuggest = async () => {
    if (extFiles.length < 2) { alert(t.appFlow.addAtLeastTwoSParameterFiles); return }
    try {
      const info = await api('/api/cascade/inspect_files', { paths: extFiles.map(f => f.path) })
      const s = info.suggestions
      setExtConns(s.connections)
      setExtShorts(s.shorts)
      if (s.connections.length === 0) {
        alert(t.appFlow.cannotSuggestConnectionsAutomaticallyPortNamesDo)
      }
    } catch (e) {
      alert(t.appFlow.automaticSuggestionFailed + errorText(e, lang), 'error')
    }
  }

  // 外部檔案：本地建立示意圖（不打後端）
  const handleExtPreview = () => {
    if (extFiles.length === 0) return
    reportGeometryBindings.current.schematic = reportCascadeContext
      setSchematicGraph({
      blocks: extFiles.map(f => ({ label: f.name, sub_label: `${f.n_ports} port`, ports: f.port_names })),
      connections: extConns.map(c => ({
        a: { block: c.a_file, port: c.a_port },
        b: { block: c.b_file, port: c.b_port },
      })),
      shorts: extShorts.map(s => ({ block: s.file, ports: s.ports })),
    })
    setActiveView('schematic')
  }

  const handleExtRun = async () => {
    if (schedStartRef.current || schedStatus?.running) {
      alert(t.operationFeedback.waitForSolve)
      return
    }
    if (circuitBusyRef.current) {
      alert(t.appFlow.circuitQuickeyeIsProcessingWaitUntilIt)
      return
    }
    if (extFiles.length < 2) { alert(t.appFlow.addAtLeastTwoSParameterFiles); return }
    if (extConns.length === 0) { alert(t.appFlow.addConnectionsFirstOrClickSuggestConnections); return }
    setCascadeBusy(true)
    try {
      const data = await api('/api/cascade/run_custom', {
        files: extFiles.map(f => f.path),
        connections: extConns,
        shorts: extShorts,
        output_path: '',
      })
      reportGeometryBindings.current.cascade = reportCascadeContext
      if (cascadeMode === 'tool' && schedMetaPath && data.output_path) {
        setReportWorkSources(previous => rememberWorkSource(previous, {
          metadata_path: normalizeUserPath(schedMetaPath), board_path: reportBoardPath,
          cascade_touchstone: data.output_path, channel_touchstone: data.output_path,
        }))
      }
      setCascadeResult(data)
    } catch (e) {
      alert(t.appFlow.circuitCascadeFailed + errorText(e, lang), 'error')
    } finally {
      setCascadeBusy(false)
    }
  }

  // S 參數分頁：向後端要自動曲線（近端／遠端與差動配對由 Port 名稱推斷）
  // `isCurrent` 讓已經被取代的那一次請求安靜退場。差動／單端連按兩下時，
  // 先發出的那一次可能後回來，圖上就變成與目前模式不符的曲線。
  const loadSparamCurves = async (
    mode: 'single' | 'diff',
    isCurrent: () => boolean = () => true,
  ) => {
    setSpBusy(true); setSpError('')
    try {
      const data = await api('/api/cascade/auto_curves',
        { mode, include_xtalk: true })
      if (!isCurrent()) return
      setSpData(data)
    } catch (e) {
      if (!isCurrent()) return
      if (mode === 'diff' && !spModePicked.current
          && isNoDiffPairsError(e)) {
        setSpMode('single')          // 觸發 useEffect 以單端重載
        return
      }
      setSpData(null)
      setSpError((_t, lang) => errorText(e, lang))
    } finally {
      if (isCurrent()) setSpBusy(false)
    }
  }

  // 切到 S 參數分頁或改變模式時自動載入
  useEffect(() => { spModePicked.current = false }, [cascadeResult])
  useEffect(() => {
    if (activeView !== 'sparam' || !cascadeResult) return
    let cancelled = false
    void loadSparamCurves(spMode, () => !cancelled)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, spMode, cascadeResult])

  // 一鍵眼圖：啟動後輪詢背景工作，完成或失敗時解除忙碌旗標並更新圖片
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const state = await api('/api/circuit/quick_eye/status')
        if (cancelled) return
        // 內容沒變就沿用舊物件：求解中每 2.5 秒換一個新物件，會讓報告的
        // 「結果已更新」偵測反覆誤觸。
        setEyeJob((previous: any) =>
          JSON.stringify(previous) === JSON.stringify(state) ? previous : state)
        if (!state.running && (state.status === 'done' || state.status === 'error')) {
          circuitBusyRef.current = false
          setCircuitBusy(false)
          if (state.status === 'done') {
            setCircuitResult(state.result)
            setEyeImageRevision(Date.now())   // 避免瀏覽器沿用舊圖快取
          } else if (state.error) {
            setCircuitError((_t, lang) => pickText(state, 'error', lang))
          }
        }
      } catch { /* 後端暫時忙碌時保留上次狀態 */ }
    }
    poll()
    const timer = window.setInterval(() => {
      if (eyeJob?.running || circuitBusyRef.current) poll()
    }, 2500)
    return () => { cancelled = true; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eyeJob?.running, circuitBusy])

  useEffect(() => {
    const touchstonePath = cascadeResult?.output_path
    setCircuitResult(null)
    setCircuitError('')
    setEyeSuggestion(null)
    setEyeSuggestionError('')
    if (!touchstonePath) {
      return
    }
    let cancelled = false
    api('/api/circuit/suggest', { touchstone_path: touchstonePath })
      .then(suggestion => {
        if (cancelled) return
        setEyeSuggestion(suggestion)
        if (suggestion.mode === 'single' || suggestion.mode === 'differential') {
          setEyeMode(suggestion.mode)
        }
        const rate = Number(suggestion.data_rate_gbps ?? 1)
        setEyeDataRate(String(rate))
        setEyeRiseTime(String(suggestion.rise_time_ps ?? riseTimePsFor(rate) ?? 200))
        setEyeInputP(suggestion.ports?.input_p || '')
        setEyeInputN(suggestion.ports?.input_n || '')
        setEyeOutputP(suggestion.ports?.output_p || '')
        setEyeOutputN(suggestion.ports?.output_n || '')
      })
      .catch(() => {
        if (!cancelled) {
          setEyeSuggestion(null)
          setEyeSuggestionError((t) => t.appFlow.cannotReadTouchstonePortSuggestionsCheckThat)
        }
      })
    return () => { cancelled = true }
  }, [cascadeResult, eyeSuggestionRevision])

  useEffect(() => {
    if (cascadeMode !== 'tool') {
      setCircuitExportMode('complete')
    }
  }, [cascadeMode])

  // ── TDR 阻抗定位 ─────────────────────────────────────
  // 從 2D 場景取出被探測 Net 的走線 polylines（mm）。標記映射與路徑長度
  // 都用這份資料，不需要為了 TDR 重開 EDB。
  const buildTdrPolylines = (data: PreviewData | null, net: string) => {
    if (!data || !net) return []
    const result: { net: string; layer: string; points_mm: number[][] }[] = []
    for (const [layerName, items] of Object.entries(data.layers)) {
      if (layerName === 'Ports' || layerName === 'Board') continue
      for (const item of items as any[]) {
        if (item.kind === 'path' && item.net === net
            && Array.isArray(item.points) && item.points.length >= 2) {
          result.push({ net, layer: layerName, points_mm: item.points })
        }
      }
    }
    return result
  }
  const tdrScene = cutScene || fullScene
  /** 「只顯示選取網路」的開關提到這一層共用。
   *
   *  每個 Preview2D 各有一份 `visibleNets`，所以在完整 Layout 篩到只剩要看的
   *  那條之後，切到 TDR 分頁仍然是整片板子——阻抗標記被其他銅箔蓋住，
   *  而使用者以為自己已經篩過了。共用一個開關，兩邊就會一起變。 */
  const [layoutOnlySelectedNets, setLayoutOnlySelectedNets] = useSessionState('layoutOnlySelectedNets', false)
  // 分段切面位置 → 排除區輸入（axis 0 = X 座標上的縱切）
  const tdrCuts = complexityAnalysis
    ? complexityAnalysis.cuts.map(c => ({
        axis: c.direction === 'x' ? 0 : 1, position_mm: c.position_mm }))
    : segAnalysis
      ? segAnalysis.cuts.map(c => ({
          axis: segAnalysis.direction === 'x' ? 0 : 1,
          position_mm: c.position_mm }))
      : []

  // 串接結果一變就重取 TDR 建議（上升時間、Port 清單與配對）
  useEffect(() => {
    const touchstonePath = cascadeResult?.output_path
    setTdrSuggestion(null)
    setTdrSuggestionError(null)
    setTdrSuggestionLoading(false)
    setTdrJob(null)
    setTdrMarkers(null)
    setTdrMapError('')
    setTdrAnalysisIdx(0)
    if (!touchstonePath || !show.tdr) return
    let cancelled = false
    setTdrSuggestionLoading(true)
    api('/api/tdr/suggest', { touchstone_path: touchstonePath })
      .then(suggestion => {
        if (cancelled) return
        setTdrSuggestion(suggestion)
        if (suggestion.suggested_mode === 'single'
            || suggestion.suggested_mode === 'differential') {
          setTdrMode(suggestion.suggested_mode)
        }
        setTdrInputP(suggestion.suggested_mapping?.input_p || '')
        setTdrInputN(suggestion.suggested_mapping?.input_n || '')
        setTdrOutputP(suggestion.suggested_mapping?.output_p || '')
        setTdrOutputN(suggestion.suggested_mapping?.output_n || '')
      })
      .catch(error => {
        if (!cancelled) setTdrSuggestionError(error)
      })
      .finally(() => { if (!cancelled) setTdrSuggestionLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cascadeResult, show.tdr, tdrSuggestionRevision])

  // 介電常數由疊構自動取得（厚度加權平均），不讓使用者填——
  // 填錯的 Dk 會給出看起來很篤定、位置卻整段平移的標記。
  useEffect(() => {
    if (!show.tdr) return
    if (!fullScene) { setTdrDkHint(''); return }
    let cancelled = false
    api('/api/tdr/dk')
      .then(data => {
        if (cancelled) return
        setTdrDkHint(data?.available && data?.dk ? String(data.dk) : '')
      })
      .catch(() => { if (!cancelled) setTdrDkHint('') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.tdr, fullScene])

  // 預設探測第一條訊號網路
  useEffect(() => {
    if (!tdrNet && signalNets.length > 0) setTdrNet(signalNets[0])
    if (tdrNet && signalNets.length > 0 && !signalNets.includes(tdrNet)) {
      setTdrNet(signalNets[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalNets.join(',')])

  // 通道實體長度：群延遲法（A 法）的必要輸入，也決定標記的起點端
  useEffect(() => {
    setTdrPath(null)
    if (!show.tdr || !tdrNet || !tdrScene) return
    const polylines = buildTdrPolylines(tdrScene, tdrNet)
    if (polylines.length === 0) return
    let cancelled = false
    const fetchPath = async () => {
      try {
        const canonical = await api('/api/tdr/path', {
          polylines, net: tdrNet, start_xy_mm: [0, 0] })
        if (cancelled) return
        if (tdrFlipStart) {
          const flipped = await api('/api/tdr/path', {
            polylines, net: tdrNet, start_xy_mm: canonical.end_mm })
          if (!cancelled) setTdrPath(flipped)
        } else {
          setTdrPath(canonical)
        }
      } catch { /* 走線資料不足時不顯示長度 */ }
    }
    fetchPath()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.tdr, tdrNet, tdrFlipStart, tdrScene])

  // TDR 背景工作輪詢（仿眼圖）
  useEffect(() => {
    if (!show.tdr) return
    let cancelled = false
    const poll = async () => {
      try {
        const state = await api('/api/tdr/status')
        if (cancelled) return
        // 同上：內容一樣就沿用舊物件，免得下游（例如與 Q2D 的對照）白算一次。
        setTdrJob((previous: any) => {
          // 匯入的量測波形借用同一個結果槽，而它不是後端的工作——被
          // 後端的閒置快照蓋掉，分頁就會整個變灰，看起來像匯入沒成功。
          // （在入口把「TDR 阻抗定位」關掉再開就會重跑這個 effect。）
          if (previous?.result?.source === 'measured_waveform') return previous
          return JSON.stringify(previous) === JSON.stringify(state) ? previous : state
        })
      } catch { /* 後端暫時忙碌時保留上次狀態 */ }
    }
    poll()
    const timer = window.setInterval(() => {
      if (tdrJob?.running) poll()
    }, 2500)
    return () => { cancelled = true; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.tdr, tdrJob?.running])

  // 求解完成後把選定分析法的劇變位置映射到 Layout
  useEffect(() => {
    setTdrMarkers(null)
    setTdrMapError('')
    const analysis = tdrJob?.result?.analyses?.[tdrAnalysisIdx]
    if (tdrJob?.status !== 'done' || !analysis || !tdrPath || !tdrScene) return
    const polylines = buildTdrPolylines(tdrScene, tdrNet)
    if (polylines.length === 0) return
    const distances = (analysis.discontinuities || [])
      .slice(0, 8)                          // 只標最強的前幾個，畫面才讀得懂
      .map((d: any) => d.distance_mm)
      .filter((d: number) => d <= (tdrPath.length_mm || Infinity) * 1.05)
    if (distances.length === 0) return
    let cancelled = false
    api('/api/tdr/map', {
      polylines, net: tdrNet,
      start_xy_mm: tdrPath.start_mm,
      resolution_mm: analysis.resolution_mm,
      marker_distances_mm: distances,
      cuts: tdrCuts,
    })
      .then(result => {
        if (cancelled) return
        const methodTag = analysis.method === 'group_delay' ? 'A'
          : analysis.method === 'end_anchor' ? t.appFlow.anchor : 'B'
        reportMarkerBinding.current = reportMarkerContext
        setTdrMarkers(result.markers.map((m: any, i: number): TdrMarkerSpan => ({
          points: m.points,
          distance_mm: m.distance_mm,
          excluded: m.excluded,
          label: `${methodTag}${i + 1}`
            + (m.excluded ? t.appFlow.cutPlaneSeam : ''),
        })))
      })
      .catch(e => { if (!cancelled) setTdrMapError((_t, lang) => errorText(e, lang)) })
    return () => { cancelled = true }
    // 相依含 result 本體：量測波形匯入直接塞一個 status 已是 done 的
    // 結果進來，只看 status 的話標記不會重算。輪詢端在內容相同時沿用
    // 舊物件，所以不會因此白跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tdrJob?.status, tdrJob?.result, tdrAnalysisIdx, tdrPath, tdrScene, tdrNet])

  const handleTdrRun = async () => {
    if (!cascadeResult?.output_path || !tdrSuggestion?.supported) {
      alert(tdrSuggestion?.note || t.appFlow.completeACircuitCascadeFirst2Port)
      return
    }
    const selected = tdrMode === 'differential'
      ? [tdrInputP, tdrInputN, tdrOutputP, tdrOutputN]
      : [tdrInputP, tdrOutputP]
    if (selected.some(name => !name) || new Set(selected).size !== selected.length) {
      alert(t.appFlow.tdrInputOutputPortsMustBeComplete)
      return
    }
    const dk = tdrDkHint.trim() ? Number(tdrDkHint) : null
    if (dk !== null && (!Number.isFinite(dk) || dk <= 0)) {
      alert(t.appFlow.dielectricConstantMustBePositive)
      return
    }
    const lengthMm = tdrPath?.length_mm || null
    if (!lengthMm && dk === null) {
      alert(t.appFlow.unableToDeterminePropagationVelocityLoadThe
        + t.appFlow.channelLengthFromTracesMethodAAnd)
      return
    }
    const mapping = tdrMode === 'differential'
      ? t.appFlow.label218(tdrInputP, tdrInputN, tdrOutputP, tdrOutputN)
      : `${tdrInputP} → ${tdrOutputP}`
    const ok = await confirm(
      t.appFlow.confirmTdrSettings +
      t.appFlow.mode(tdrMode === 'differential' ? t.appFlow.differential : t.appFlow.singleEnded) +
      t.appFlow.probe(mapping) +
      t.appFlow.riseTimePsDerivedFromBandwidth(Number(tdrSuggestion.rise_time_ps).toFixed(2)) +
      (lengthMm ? t.appFlow.channelLengthMmMethodAGroupDelay(length(Number(lengthMm))) : '') +
      (dk !== null ? t.appFlow.dielectricConstantMethodBStackupDk(dk) : '') +
      t.appFlow.startBackgroundSolving)
    if (!ok) return
    try {
      const reportEvidence = await captureBeforeAnalysis('tdr', [cascadeResult.output_path],
        [tdrMode, tdrInputP, tdrInputN, tdrOutputP, tdrOutputN, dk, lengthMm, tdrSuggestion.rise_time_ps])
      const snapshot = await api('/api/tdr/start', {
        touchstone_path: cascadeResult.output_path,
        mode: tdrMode,
        input_p: tdrInputP,
        output_p: tdrOutputP,
        input_n: tdrInputN,
        output_n: tdrOutputN,
        dk_hint: dk,
        path_length_mm: lengthMm,
        confirmed: true,
      })
      reportJobBindings.current.tdr = { context: reportTdrContext, startedAt: snapshot.started_at, evidence: reportEvidence }
      setTdrJob(snapshot)
      setTdrMarkers(null)
      setActiveView('tdr')
    } catch (e) {
      alert(t.appFlow.failedToStartTdr + errorText(e, lang), 'error')
    }
  }

  // ── 量測波形匯入（乙路）─────────────────────────────────
  const handleTmLoad = async () => {
    setTmError('')
    setTmPreview(null)
    setTmBusy(true)
    try {
      const preview = await api('/api/tdr/measured/load',
        { csv_path: tmCsvPath.trim(), time_unit: tmTimeUnit })
      setTmPreview(preview)
    } catch (e) {
      setTmError((_t, lang) => errorText(e, lang))
    } finally {
      setTmBusy(false)
    }
  }

  const handleTmAnalyze = async () => {
    const t0 = Number(tmT0)
    if (!Number.isFinite(t0)) { setTmError((t) => t.appFlow.t0MustBeANumberNs); return }
    const tEnd = tmTEnd.trim() ? Number(tmTEnd) : null
    if (tEnd !== null && (!Number.isFinite(tEnd) || tEnd <= t0)) {
      setTmError((t) => t.appFlow.endReflectionTimeMustBeLaterThan); return
    }
    setTmError('')
    setTmBusy(true)
    try {
      const reportEvidence = await captureBeforeAnalysis('tdr-measured', [tmCsvPath.trim()],
        [t0, tEnd, tdrPath?.length_mm, tdrDkHint, tmRise, tmTimeUnit])
      const result = await api('/api/tdr/measured/analyze', {
        csv_path: tmCsvPath.trim(),
        t0_ns: t0,
        t_end_ns: tEnd,
        path_length_mm: tdrPath?.length_mm || null,
        dk_hint: tdrDkHint.trim() ? Number(tdrDkHint) : null,
        rise_time_ps: tmRise.trim() ? Number(tmRise) : null,
        time_unit: tmTimeUnit,
      })
      reportJobBindings.current.tdr = { context: reportTdrContext, evidence: reportEvidence }
      // 塞進與模擬路同一個結果槽：曲線、劇變表、Layout 標記與
      // 「取此處截面」全部重用。輪詢只在 running 時覆寫，不會蓋掉它。
      setTdrAnalysisIdx(0)
      setTdrMarkers(null)
      setTdrMapError('')
      setTdrJob({
        running: false, status: 'done', phase: t.appFlow.measuredWaveform,
        message: t.appFlow.measuredWaveformAnalysisComplete, result,
      })
      setActiveView('tdr')
    } catch (e) {
      setTmError((_t, lang) => errorText(e, lang))
    } finally {
      setTmBusy(false)
    }
  }

  // ── 截面阻抗（Q2D）───────────────────────────────────────
  //
  // 掃描不呼叫 AEDT：花掉一份 Q2D 授權才發現截面不能用，是最貴的學法。

  // 換板子就把上一片的標註清掉，再讀回這一片自己的。留著舊的
  // 會讓人以為新板已經標註過。
  //
  // 相依要看 `fullScene` 而不是只看 `inputPath`：路徑欄一填好 inputPath 就變了，
  // 但那時使用者還沒按「載入檔案」，後端手上沒有板子，切線集只會回空的——
  // 結果是存過切線的板子載進來，畫面上一條都沒有。
  useEffect(() => {
    setXsRegion(null)
    setXsCut(null)
    setXsScan(null)
    setXsRoleOverrides({})
    setXsError('')
    setXsSavedCuts([])
    setXsCutsSource('')
    setXsCutsLoaded(false)
    if (!show.crosssection || !inputPath || !fullScene) return
    let cancelled = false
    api('/api/cross-section/cuts')
      .then(data => {
        if (cancelled) return
        setXsSavedCuts(data.cuts || [])
        setXsCutsSource(data.source || '')
        setXsCutsLoaded(true)
      })
      .catch(error => {
        // 「還沒標註過」後端回的是空清單，走的是上面那條。掉到這裡的是真的
        // 讀失敗（sidecar 壞了、後端 500、舊後端回 405）——此時畫面上的空
        // 清單並不代表這片板子沒有切線，存檔會把既有的整份蓋掉。
        if (cancelled) return
        setXsError((t, lang) => t.appFlow.cannotReadThisBoardSCutSet + errorText(error, lang))
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputPath, fullScene, show.crosssection])

  // 範圍或切線一改，上一次的截面就不再對應畫面上的東西了。留著它會讓人拿舊
  // 截面的判斷去看新的切線。
  const handleXsRegionDrawn = (region: CrossSectionRegion) => {
    setXsRegion(region)
    setXsCut(null)
    setXsScan(null)
    setXsRoleOverrides({})
    setXsMode('cut')
  }

  const handleXsCutDrawn = (cut: CrossSectionCut) => {
    setXsCut(cut)
    setXsScan(null)
    setXsRoleOverrides({})
    setXsMode('none')
  }

  const runCrossSectionScan = async (
    overrides: Record<string, string> = xsRoleOverrides,
  ) => {
    if (!validLengths()) return
    if (!xsRegion || !xsCut) {
      setXsError((t) => t.appFlow.drawAWorkingRegionOnLayoutThen)
      return
    }
    setXsBusy(true)
    setXsError('')
    try {
      const height = xsHeightUm.trim() ? Number(xsHeightUm) : 0
      const scan: CrossSectionScan = await api('/api/cross-section/scan', {
        axis: xsCut.axis,
        coordinate_mm: xsCut.coordinateMm,
        x0_mm: xsRegion.x0Mm, y0_mm: xsRegion.y0Mm,
        x1_mm: xsRegion.x1Mm, y1_mm: xsRegion.y1Mm,
        name: `XS_${xsCut.axis.toUpperCase()}_${length(xsCut.coordinateMm)}`,
        reference_nets: refNets,
        excluded_nets: [],
        role_overrides: overrides,
        resolution_um: Number(xsResolutionUm) || 2,
        conductor_to_reference_um: Number.isFinite(height) ? height : 0,
      })
      setXsScan(scan)
    } catch (e) {
      setXsScan(null)
      setXsError((_t, lang) => errorText(e, lang))
    } finally {
      setXsBusy(false)
    }
  }

  // 改身分會改變導體的組成（參考的段全部併成一個 GND），所以要重新掃描才
  // 看得到新的 ImpedancePlan。直接跟著重掃，不要求使用者自己記得按。
  const handleXsRoleOverride = (key: string, role: string) => {
    const next = { ...xsRoleOverrides, [key]: role }
    setXsRoleOverrides(next)
    runCrossSectionScan(next)
  }

  const handleXsSaveCut = async () => {
    if (!xsRegion || !xsCut) return
    if (!xsCutsLoaded) {
      setXsError((t) => t.appFlow.theCutSetHasNotLoadedSuccessfully)
      return
    }
    // 與「求解這條」送出的規格用同一個來源，包含導體到參考面的高度——
    // 少了它，批次求解（解全部已存）就跳過側向截斷判定，而那正是整條
    // Z₀(x) 剖面最需要它的場合。
    const entry = xsCutSpec()
    if (!entry) return
    // 同名就覆蓋——同一條切線重標一次是修正，不是新增一條。
    const cuts = [...xsSavedCuts.filter(c => c.name !== entry.name), entry]
    try {
      const result = await api('/api/cross-section/cuts', { cuts })
      setXsSavedCuts(cuts)
      setXsCutsSource(result.path || '')
    } catch (e) {
      setXsError((t, lang) => t.appFlow.failedToSaveCuts + errorText(e, lang))
    }
  }

  const xsReadable = Boolean(xsJob?.result || xsJob?.running)

  // 背景求解狀態輪詢（仿眼圖與 TDR）。開頁時也問一次：工作是後端在跑的，
  // 重新整理之後前端沒有這一下就接不上，進度會整個消失。
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const state = await api('/api/cross-section/status')
        if (cancelled) return
        // 內容一樣就不要換狀態。輪詢回來的永遠是一個**新物件**，而 React 認的是
        // 物件識別不是內容——照單全收會讓下游每 8 秒重跑一次，畫面整塊閃掉再回來。
        setXsJob((previous: any) =>
          JSON.stringify(previous) === JSON.stringify(state) ? previous : state)
      } catch { /* 後端還沒起來就下次再問 */ }
    }
    poll()
    // 沒有工作在跑就不要一直問。開頁那一次（上面的 `poll`）已經接上後端
    // 既有的工作；之後 running 為 false 還每 8 秒問一次，是在對一個永遠不會
    // 變的答案發請求——實測閒置 17 分鐘打了 132 次，後端日誌整片都是它，
    // 真正在發生的事反而看不到。TDR 與眼圖那兩條輪詢本來就是這個形狀。
    const timer = window.setInterval(() => { if (xsJob?.running) poll() }, 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.crosssection, xsJob?.running])

  // Q2D 與 TDR 兩邊都有結果時自動對照。任一邊沒有就不算——把一條 TDR 曲線
  // 跟零個 Q2D 點畫在一起沒有意義。
  useEffect(() => {
    // 這裡刻意**不先清空**。重算只要一百毫秒，先清空會讓整塊對照消失再出現，
    // 在輪詢的節奏下就是規律的閃爍。算好再換掉，畫面才不會跳。
    if (!betaEnabled || !show.crosssection || !show.tdr) return
    const solved = ((xsJob?.result?.cuts || []) as any[])
      .filter(c => c.solved && c.single_ended
        && Object.keys(c.single_ended).length > 0)
    const analysis = tdrJob?.result?.analyses?.[tdrAnalysisIdx]
    if (solved.length === 0 || tdrJob?.status !== 'done' || !analysis) {
      setXsCompare(null)
      return
    }
    if (!tdrScene || !tdrNet || !tdrPath) return
    const distances = analysis.distance_mm || []
    const impedance = tdrJob.result.impedance_ohm || []
    if (distances.length < 2 || impedance.length !== distances.length) return
    let cancelled = false
    api('/api/cross-section/compare', {
      polylines: buildTdrPolylines(tdrScene, tdrNet),
      net: tdrNet,
      start_xy_mm: tdrPath.start_mm,
      cuts: solved,
      tdr_distance_mm: distances,
      tdr_impedance_ohm: impedance,
      // 解析度是每一個分析各自的（A 法與 B 法速度不同，解析度就不同），
      // 不在 result 頂層。取錯會讓橫帶寬度與實際不符。
      resolution_mm: analysis.resolution_mm || 0,
      signal_nets: [tdrNet],
    })
      .then(data => { if (!cancelled) {
        reportComparisonBinding.current = reportCompareContext
        setXsCompare(data)
      } })
      .catch(() => { /* 對不起來就不顯示，不用打擾使用者 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xsJob?.result, tdrJob?.result, tdrAnalysisIdx, tdrPath, tdrNet,
      show.crosssection, show.tdr, betaEnabled])

  /** 截面阻抗快照要帶進報告的數字。圖上的字縮小後未必讀得出來。 */
  const crossSectionReportMetadata = (): Record<string, any> => {
    // source_metadata 的鍵與既有報告／後端相依，保持原始中文；顯示值仍隨語言切換。
    const metadataLabels = messagesFor('zh-TW').appFlow
    const meta: Record<string, any> = {}
    const cuts = (xsJob?.result?.cuts || []) as any[]
    const solved = cuts.filter(c => c.solved)
    if (solved.length) {
      meta[metadataLabels.solvedCuts] = solved.length
      meta[metadataLabels.solveAccuracy] = solved[0].solve_mode || ''
      const impedances: string[] = []
      for (const cut of solved) {
        for (const [name, value] of Object.entries(cut.single_ended || {})) {
          impedances.push(`${cut.name} ${name} ${Number(value).toFixed(3)} Ω`)
        }
      }
      if (impedances.length) meta[metadataLabels.singleEndedImpedance] = impedances.join(t.appFlow.label269)
      const converged = solved.filter(c => c.convergence)
      if (converged.length) {
        meta[metadataLabels.lateralConvergence] = converged
          .map(c => t.appFlow.maximumChangeAfterWideningBy(c.name, (c.convergence.factor - 1) * 100)
            + `${(c.convergence.worst_relative * 100).toFixed(2)}%`
            + t.appFlow.label(c.convergence.converged ? t.appFlow.converged : t.appFlow.notConverged))
          .join(t.appFlow.label269)
      }
      const pairs = solved.flatMap(c => (c.pairs || [])
        .filter((p: any) => p.Zdiff != null)
        .map((p: any) => t.appFlow.differentialPairLabel(c.name, p.positive, p.negative)
          + t.appFlow.zdiff(p.Zdiff.toFixed(3), p.exact ? t.appFlow.exact : t.appFlow.approximate)))
      if (pairs.length) meta[metadataLabels.differentialImpedance] = pairs.join(t.appFlow.label269)
    }
    if (xsScan) {
      meta[metadataLabels.currentCuts] = `${xsScan.cut.name || ''} `
        + `${xsScan.cut.axis.toUpperCase()} = ${length(xsScan.cut.coordinate_mm)} ${unit}`
      meta[metadataLabels.sampleSpacing] = `${length(xsScan.resolution_um, 'um')} ${unit}`
      meta[metadataLabels.conductorCount] = xsScan.plan.conductor_count
    }
    if (xsCompare?.summary?.comparable) {
      const s = xsCompare.summary
      meta[metadataLabels.comparisonWithTdr] = t.appFlow.comparableCuts(s.comparable)
        + t.appFlow.medianDifference((s.median_delta_ohm ?? 0).toFixed(4))
        + t.appFlow.maximum(((s.worst_relative ?? 0) * 100).toFixed(2), s.worst ?? '')
      meta[metadataLabels.tdrSpatialResolution] = `${length(s.resolution_mm)} ${unit}`
    }
    return meta
  }

  const xsCutSpec = () => {
    if (!xsRegion || !xsCut) return null
    return {
      name: xsScan?.cut?.name
        || `XS_${xsCut.axis.toUpperCase()}_${length(xsCut.coordinateMm)}`,
      axis: xsCut.axis,
      coordinate_mm: xsCut.coordinateMm,
      region: {
        x0_mm: xsRegion.x0Mm, y0_mm: xsRegion.y0Mm,
        x1_mm: xsRegion.x1Mm, y1_mm: xsRegion.y1Mm,
      },
      resolution_um: Number(xsResolutionUm) || 2,
      conductor_to_reference_um: Number(xsHeightUm) || 0,
      role_overrides: xsRoleOverrides,
    }
  }

  const handleXsSolve = async (cuts: any[]) => {
    if (cuts.length === 0) return
    // 求解要開 AEDT、要花授權，所以把「解幾條、用什麼精度」講清楚再問一次。
    // 這不是禮貌性確認：accurate 在導體內部解場，時間是 standard 的三倍以上。
    const label = { fast: t.appFlow.quick, standard: t.appFlow.standard, accurate: t.appFlow.highAccuracy }[xsSolveMode]
      || xsSolveMode
    if (!await confirm(
      t.appFlow.solveCuts(cuts.length)
      + cuts.map(c => t.appFlow.mm294(c.name, c.axis.toUpperCase(), length(c.coordinate_mm))).join('\n')
      + t.appFlow.accuracyAdaptiveFrequency(label, xsFrequency)
      + t.appFlow.aedtWillOpenAndUseOneQ2d)) return
    try {
      const reportEvidence = await captureBeforeAnalysis('crosssection', [workingPath],
        [cuts, refNets, xsFrequency, xsSolveMode, xsWidenCheck])
      const snapshot = await api('/api/cross-section/solve', {
        cuts,
        reference_nets: refNets,
        frequency: xsFrequency,
        solve_mode: xsSolveMode,
        widen_factor: xsWidenCheck ? WIDEN_FACTOR : 0,
      })
      reportJobBindings.current.xs = { context: reportXsContext, startedAt: snapshot.started_at, evidence: reportEvidence }
      setXsJob(snapshot)
      setXsResultIdx(0)
      setActiveView('crosssection')
    } catch (e) {
      setXsError((t, lang) => t.appFlow.failedToStartSolve + errorText(e, lang))
    }
  }

  const handleXsStop = async () => {
    try {
      setXsJob(await api('/api/cross-section/stop', {}))
    } catch (e) {
      setXsError((t, lang) => t.appFlow.failedToTerminate + errorText(e, lang))
    }
  }

  // ── TDR 捷徑：把距離換成切線 ────────────────────────
  //
  // 手拉也拉得到，但拉得準不準看手感——切線斜個 20° 寬度就虛胖 6%、阻抗偏低，
  // 而畫面上完全看不出來。這裡改成算出來的。

  const tdrShortcutPayload = () => {
    if (!tdrScene || !tdrNet || !tdrPath) return null
    return {
      polylines: buildTdrPolylines(tdrScene, tdrNet),
      net: tdrNet,
      start_xy_mm: tdrPath.start_mm,
      half_width_um: Number(xsHalfWidthUm) || 7000,
    }
  }

  /** 劇變表逐列的「取此處截面」。 */
  const handleCutHere = async (distanceMm: number, label: string) => {
    const base = tdrShortcutPayload()
    if (!base) { alert(t.appFlow.loadTheBoardAndCalculateTheTdr); return }
    setXsFromTdrBusy(true)
    try {
      const data = await api('/api/cross-section/from-tdr', {
        ...base, distances_mm: [distanceMm], names: [label],
      })
      const row = data.rows?.[0]
      if (!row?.accepted) {
        alert(t.appFlow.thisLocationCannotBeAnalyzedWithA(pickText(row, 'reason', lang) || t.appFlow.unknownReason))
        return
      }
      handleXsLoadCut(row.cut)
      setActiveView('crosssection')
      if (row.severity === 'risk') {
        setXsError((t, lang) => t.appFlow.cutPositionedBut(pickText(row, 'reason', lang)))
      } else {
        setXsError('')
      }
    } catch (e) {
      alert(t.appFlow.failedToCreateCut + errorText(e, lang), 'error')
    } finally {
      setXsFromTdrBusy(false)
    }
  }

  /** 「沿線取樣 N 條」：一次鋪一排，角度過不了的跳過並回報。 */
  const handleSampleAlongTrace = async () => {
    if (!validLengths()) return
    const base = tdrShortcutPayload()
    if (!base) { alert(t.appFlow.loadTheBoardAndCalculateTheTdr); return }
    const spacing = Number(xsSampleSpacingMm)
    if (!(spacing > 0)) { alert(t.appFlow.sampleSpacingMustBeGreaterThan0); return }
    setXsFromTdrBusy(true)
    try {
      const data = await api('/api/cross-section/from-tdr', {
        ...base, spacing_mm: spacing,
      })
      const cuts = data.cuts || []
      const skipped = data.skipped || []
      if (cuts.length === 0) {
        alert(t.appFlow.noLocationsAlongThePathAreSuitable +
          (skipped.length ? t.appFlow.samplePointsWereSkippedDueToTheir(skipped.length) : ''))
        return
      }
      // 存進切線集，之後「解全部已存」就能整批送出。
      // 同樣先確認切線集讀回來過：合併是拿畫面上的清單去覆寫整個 sidecar。
      if (!xsCutsLoaded) {
        alert(t.appFlow.theCutSetHasNotLoadedSuccessfully308)
        return
      }
      const merged = [...xsSavedCuts.filter(
        (c: any) => !cuts.some((n: any) => n.name === c.name)), ...cuts]
      const written = await api('/api/cross-section/cuts', { cuts: merged })
      setXsSavedCuts(merged)
      setXsCutsSource(written.path || '')
      handleXsLoadCut(cuts[0])
      setActiveView('crosssection')
      // 跳過幾條一定要講出來——靜靜略過會讓人以為那一段沒問題，
      // 而那一段正好是最可能有問題的地方。
      setXsError((t, lang) => {
        const parts = [t.appFlow.createdCutsAlongThePathActualSpacing(cuts.length, length(data.actual_spacing_mm))]
        if (data.note) parts.push(pickText(data, 'note', lang, unit))
        if (skipped.length) {
          parts.push(t.appFlow.samplePointsWereSkippedBecauseTheAngle(skipped.length)
            + skipped.map((s: any) => t.appFlow.mm311(length(s.distance_mm), s.angle_deg?.toFixed(0) ?? '?')).join(t.appFlow.listSeparator)
            + t.appFlow.theseLocationsAreBendsA2dCross)
        }
  return parts.join('\n')
      })
    } catch (e) {
      alert(t.appFlow.samplingAlongThePathFailed + errorText(e, lang), 'error')
    } finally {
      setXsFromTdrBusy(false)
    }
  }

  const handleXsLoadCut = (entry: any) => {
    if (!entry?.region) return
    setXsRegion({
      x0Mm: entry.region.x0_mm, y0Mm: entry.region.y0_mm,
      x1Mm: entry.region.x1_mm, y1Mm: entry.region.y1_mm,
    })
    setXsCut({ axis: entry.axis === 'x' ? 'x' : 'y', coordinateMm: entry.coordinate_mm })
    setXsRoleOverrides(entry.role_overrides || {})
    if (entry.resolution_um) setXsResolutionUm(String(entry.resolution_um))
    // 導體到參考面也要跟著回來，否則叫回一條存過的切線再按「求解這條」，
    // 側向截斷判定會因為高度是 0 而整個略過（欄位看起來也像沒填過）。
    // `!= null` 而不是真值判斷：存下來的 0 是「量到貼著參考面」，用真值判斷
    // 會把它跟「沒存過」混為一談。沒有這個欄位就清成空字串，別留著上一條
    // 切線的高度冒充這一條的。
    setXsHeightUm(entry.conductor_to_reference_um != null
      ? String(entry.conductor_to_reference_um) : '')
    setXsScan(null)
    setXsMode('none')
  }

  // 任何長時間工作執行中都每秒觸發重繪，讓「已耗時」平滑跳動（不打 API）。
  //
  // 原本只看分段排程，於是眼圖、TDR 與截面求解的「已耗時」永遠顯示 0 秒——
  // nowTick 停在開頁那一刻，減去比它晚的 started_at 得到負數，再被
  // Math.max(0, …) 夾成 0。看起來像計時器壞了，實際上是它根本沒在跳。
  const anyJobRunning = Boolean(
    scheduleBusy || eyeJob?.running || tdrJob?.running || xsJob?.running
    || boundaryPreviewStartedAt !== null)
  useEffect(() => {
    if (!anyJobRunning) return
    setNowTick(Date.now() / 1000)          // 立刻對時，不要先顯示一秒的 0
    const t = window.setInterval(() => setNowTick(Date.now() / 1000), 1000)
    return () => window.clearInterval(t)
  }, [anyJobRunning])

  // 開頁（或求解中重新整理）時先問一次：排程是後端在跑的，前端沒有這一下
  // 就接不上下面的輪詢，進度會整個消失。已經停掉或跑完的也照樣接管——那份
  // 快照裡有各段的結果與待重新匯出的項目，重新整理後不該憑空消失；jobs 為
  // 空時面板本來就不會顯示，不會有殘影。
  useEffect(() => {
    let cancelled = false
    api('/api/schedule/status')
      .then(s => { if (!cancelled && s) setSchedStatus(s) })
      .catch(() => { /* 後端還沒起來，忽略 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 關窗保存／放棄工作階段────────────────────────────────────────
  //
  // 開窗：main.tsx 已讀回快照，各欄位初值就是快照的值；這裡再把板子接回來
  // （後端還開著就不重開 EDB），載入流程會重設網路與輸出路徑，所以載完再
  // 整批套回一次，最後讀分段計畫顯示各段求解狀態。排程還在跑的話，上面的
  // /api/schedule/status 已經接上輪詢。還原完成前不自動保存，免得半途的狀態
  // 蓋掉完整的快照。
  const [sessionNotices, setSessionNotices] = useState<
    { kind: 'ok' | 'warn'; text: (t: Messages) => string }[]>([])
  const pushSessionNotice = (kind: 'ok' | 'warn', text: (t: Messages) => string) =>
    setSessionNotices(list => [...list, { kind, text }])
  const [autosaveError, setAutosaveError] = useState('')
  const [closeRequest, setCloseRequest] = useState<CloseRequestPayload | null>(null)
  const sessionReady = useRef(false)
  const sessionClosing = useRef(false)
  const sessionOwnerLost = useRef(false)
  const restoreStarted = useRef(false)
  const autosaver = useMemo(() => createAutosaver(async () => {
    try {
      await putSessionSnapshot(sessionData())
      setAutosaveError('')
    } catch (error) {
      if ((error as { status?: number })?.status === 409) {
        // 另一個視窗後來連上，快照歸它；這個視窗不再寫（後端也會擋）。
        if (!sessionOwnerLost.current) {
          sessionOwnerLost.current = true
          pushSessionNotice('warn', tt => tt.closeSession.otherWindow)
        }
        return
      }
      setAutosaveError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }, SESSION_AUTOSAVE_MS), [])
  useEffect(() => onSessionChange(() => {
    if (sessionReady.current && !sessionClosing.current && !sessionOwnerLost.current) autosaver.markDirty()
  }), [autosaver])

  // 分段結果：存的時候拿掉預覽幾何。
  const segRunRef = useRef(segRun)
  segRunRef.current = segRun
  useEffect(() => registerSessionField('segRun', () => {
    const run = segRunRef.current
    return run ? { ...run, previews: run.previews.map(() => null) } : null
  }, value => setSegRun(value as SegmentRunResult | null), null), [])
  useEffect(() => { notifySessionChange() }, [segRun])

  // ：S 參數結果路徑存進快照，重開時以檢視端點接回（到期也可看）。
  useSparamViewPersistence(cascadeResult, sessionReady)

  // 心跳：背景工作做完時，後端要等連著的視窗都不在了才收尾（重開的視窗、
  // 瀏覽器分頁都靠這個留住後端）。關窗流程開始後就不再送。
  useEffect(() => {
    const beat = () => {
      if (!sessionClosing.current) void sendSessionHeartbeat().catch(() => undefined)
    }
    const timer = window.setInterval(beat, HEARTBEAT_MS)
    return () => window.clearInterval(timer)
  }, [])

  // 純瀏覽器模式攔不到 X：離開頁面時把最新狀態送出去（keepalive，頁面關了也送得到）。
  useEffect(() => {
    const onPageHide = () => {
      if (!sessionReady.current || sessionClosing.current || sessionOwnerLost.current) return
      autosaver.stop()
      void putSessionSnapshot(sessionData(), true).catch(() => undefined)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [autosaver])

  useEffect(() => {
    if (restoreStarted.current) return   // StrictMode 開發模式會跑兩次，板子只接一次
    restoreStarted.current = true
    const attach = getAttachResult()
    void (async () => {
      try {
        if (attach.status === 'corrupt' || attach.status === 'unsupported') {
          pushSessionNotice('warn', tt => tt.closeSession.snapshotUnusable(
            attach.error || attach.status, attach.set_aside || ''))
        }
        if (attach.was_detached && attach.jobs?.length) {
          const names = attach.jobs.map(job => (lang === 'en' && job.label_en) || job.label)
          pushSessionNotice('ok', tt => tt.closeSession.backgroundJobs(names.join(tt.appFlow.listSeparator)))
        }
        if (attach.status !== 'ok' || !attach.snapshot) return
        const snapshot = attach.snapshot
        const fields = snapshot.data?.fields || {}
        const savedAt = new Date(snapshot.saved_at)
        const when = Number.isNaN(savedAt.getTime()) ? snapshot.saved_at : savedAt.toLocaleString(lang)
        pushSessionNotice('ok', tt => tt.closeSession.restoredAt(when))
        const board = typeof fields.workingPath === 'string' ? fields.workingPath : ''
        if (board) {
          const direct = typeof snapshot.board?.segment_ready === 'boolean'
            ? snapshot.board.segment_ready : fields.directSegmentMode === true
          const loaded = await handleLoadFile(direct, board, {
            resume: true, quiet: true,
            // 後端重啟過時照快照接回裁切狀態，「重新載入原始檔」才回得到最初的板子。
            restoreOriginalPath: snapshot.board?.original_path,
            restoreIsCut: snapshot.board?.is_cut,
          })
          if (!loaded.ok) {
            const reason = loaded.error
            pushSessionNotice('warn', tt => tt.closeSession.restoreBoardFailed(reason))
          }
          // 載入會重設網路、元件勾選、輸出路徑與頁面：套回快照。
          applySessionFields(fields)
          if (loaded.ok && (snapshot.board?.is_cut || fields.activeView === 'cut')) {
            setCutScene(loaded.data.preview)
          }
        }
        // 板子接不回（例如授權到期）也照樣接回既有 S 參數；只讀檔，不重跑串接。
        const sparam = await restoreSparamView(fields, (url, body) => api(url, body))
        if (sparam?.ok) {
          setCascadeResult(sparam.data)
          notifyCascadedChannelChanged()
        } else if (sparam) {
          const reason = errorText(sparam.error, lang)
          pushSessionNotice('warn', tt => tt.closeSession.restoreSparamFailed(reason))
        }
        const plan = typeof fields.schedMetaPath === 'string' ? fields.schedMetaPath : ''
        if (plan) await loadSegmentSolverPlan(plan, false, { restoring: true })
      } finally {
        sessionReady.current = true
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 視窗外殼按 X：顯示儲存／放棄對話框（純瀏覽器模式不會被呼叫）。
  useEffect(() => installCloseRequestHandler(payload => {
    setCloseRequest(payload)
    return true
  }), [])

  const closeWindowWith = async (action: 'save' | 'discard') => {
    sessionClosing.current = true
    autosaver.stop()
    try {
      const { keep_backend, preferences_saved } = await closeSession(action, action === 'save' ? sessionData() : undefined)
      // 訊息視窗不會擋住程式往下走：要等使用者按確定再關窗，不然還沒看到視窗就沒了。
      if (preferences_saved === false) await alertMessageAndWait(t.userPreferences.saveError)
      if (!(await finishShellClose(keep_backend))) throw new Error('pywebview finish_close')
    } catch (error) {
      // 視窗留著：重新連上（後端已讓這個視窗退休，不重連就不能再自動保存）。
      sessionClosing.current = false
      await attachSession()
      autosaver.resume()
      throw error
    }
  }

  const cancelWindowClose = () => {
    setCloseRequest(null)
    cancelShellClose()
  }

  // 段的狀態要靠輪詢才會更新：setSchedStatus 原本只在啟動、停止與重新匯出
  // 時被呼叫，畫面因此一直停在啟動當下的快照（每一段都「等待中」），要按了
  // 停止才看到真正的進度——看起來就像求解沒動或已經失敗。跑完時也是靠這裡
  // 把 running 收掉，否則會一直卡在「執行中…」。
  useEffect(() => {
    if (!schedStatus?.running) return
    let cancelled = false
    let inFlight = false
    const poll = async () => {
      if (inFlight) return          // 後端忙的時候不要疊加請求
      inFlight = true
      try {
        const s = await api('/api/schedule/status')
        if (!cancelled) {
          // 這個輪詢每 2 秒跑一次而且不分閒忙。照單全收的話，即使什麼都沒發生
          // 也會每 2 秒換一個新物件、重繪一次，並讓所有相依於它的效應白跑。
          setSchedStatus((previous: any) =>
            JSON.stringify(previous) === JSON.stringify(s) ? previous : s)
        }
      } catch {
        /* 後端暫時忙碌時保留上次狀態，下一輪再試 */
      } finally {
        inFlight = false
      }
    }
    poll()
    const timer = window.setInterval(poll, 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedStatus?.running])

  // 排程跑完：分段表重讀 segments.json，各段的失敗原因才會出現。
  const schedWasRunning = useRef(false)
  useEffect(() => {
    const running = Boolean(schedStatus?.running)
    const finished = schedWasRunning.current && !running
    schedWasRunning.current = running
    const path = schedStatus?.metadata_path
    if (finished && path && path === schedMetaPath) loadSegmentSolverPlan(path, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedStatus?.running])

  const handleComplexityRun = async () => {
    if (!complexityAnalysis?.feasible) {
      alert(t.appFlow.completeAnExecutableComplexityAnalysisFirst); return
    }
    if (!segOutputDir) { alert(t.appFlow.setASegmentOutputFolder); return }
    const releases = complexityAnalysis.manual_d_release || []
    if (releases.length && !await confirm(releaseHasNoGuarantee(releases)
      ? t.appFlow.stitchReleaseNoGuaranteeRunConfirm(releases.length)
      : t.appFlow.stitchReleaseRunConfirm(releases.length, releaseRunLimit(releases)))) return
    setLoadingMsg(
      (t) => t.appFlow.splittingIntoSegmentsEachSegmentRequiresA(complexityAnalysis.segments.length))
    setIsLoading(true)
    try {
      const data = await runSegmentJob('/api/segment/run', {
        mode: 'complexity',
        signal_nets: signalNets,
        reference_nets: refNets,
        // 執行前重驗證要和分析同一個切面頻率；判斷頻寬寫進每段建議。
        target_fmax_ghz: targetFmaxGHz,
        required_bandwidth_ghz: solverBandwidth.ghz,
        bandwidth_source: solverBandwidth.source,
        cuts: complexityCutRequests(complexityAnalysis),
        output_dir: segOutputDir,
        quality_threshold: segmentQuality,
        hfss_mesh_method: hfssMeshMethod,
        // 重驗證要用分析時同一個放行設定；放行紀錄由後端重算後寫進 segments.json。
        allow_stitch_release: Boolean(complexityAnalysis.allow_stitch_release),
      })
      if (!data) return               // 使用者不想覆寫舊結果
      reportGeometryBindings.current.segment = reportGeometryContext
      setReportQualityRecord(current => current?.context === reportGeometryContext
        ? { ...current, data: { ...current.data, metadata_path: data.metadata_path } } : null)
      // 分段在 session 當時開著的檔（workingPath）上做；鏈尾對得上才記 lineage。
      setReportWorkSources(previous => rememberWorkSource(previous, segmentedWorkSource(
        reportBoardPath, data.metadata_path, reportLineage, workingPath, refNets)))
      setSegRun(data)
      setActiveSegIdx(-1)
      setActiveView('segments')
      setSchedMetaPath(data.metadata_path || '')
      // 依複雜度分段更需要這張表：每段的求解器本來就不一樣，不讓人看到就
      // 只能相信它。2026-08-18 之前這裡少了下面兩行，等分分段有表、依複雜度
      // 沒有——而後者才是混合求解真正的入口。
      setSegmentSolverPlans((data.segments || []).map((segment: any) => ({
        index: segment.index,
        path: segment.path,
        ...(segment.solver_plan || {}),
        box_mm: segment.box_mm,
        manual_d_release: segmentReleases(data.cut_pairs, segment.index),
      })))
      setSegPlanBandwidthGHz(solverBandwidth.ghz)
      setSegFollowPlan({ source: 'run' })
      setShowSolverRegionOverlay(true)
    } catch (e) {
      alert(t.appFlow.complexityBasedSplittingFailed + errorText(e, lang), 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const bandwidthSourceText = (_resolved: ResolvedBandwidth) => specName
    ? t.appView.bandwidthSourceSpec(lang === 'en'
      ? simulationResolved?.spec_label_en || specName
      : simulationResolved?.spec_label || specName)
    : t.appView.bandwidthSourceSweep

  /** 依目前的頻寬重算每段的求解器建議。
   *
   *  分段當下使用者常常還不知道自己要用到幾 GHz——那要等他選好 IBIS 模型
   *  才定得下來，而選模型在分段之後。原本頻寬只在按下分段按鈕那一刻被讀到，
   *  事後再填等於白填：畫面上什麼都不會變。 */
  const reassessSolverBandwidth = async (metadataPath?: string) => {
    const path = normalizeUserPath(metadataPath || schedMetaPath)
    if (!path) { alert(t.appFlow.runSegmentationFirstOrEnterASegments); return }
    try {
      const data = await api('/api/schedule/bandwidth', {
        metadata_path: path,
        required_bandwidth_ghz: solverBandwidth.ghz,
      })
      setSegmentSolverPlans((data.segments || []).map((segment: any) => ({
        index: segment.index, path: segment.path, ...segment,
      })))
      setSegPlanBandwidthGHz(data.required_bandwidth_ghz ?? null)
      return data
    } catch (e) {
      alert(t.appFlow.solverReassessmentFailed + errorText(e, lang), 'error')
    }
  }

  /** 不分割：整條通道當成一段，直接產生 segments.json。
   *
   *  分段是為了讓大通道分頭求解，但常常只是想知道「整片解出來長什麼樣」
   *  ——當作分段結果的基準，或通道本來就小到不必切。這條路徑不需要先分析
   *  切割位置，也不會建立任何切面 Port。 */
  const handleSingleSegmentRun = async () => {
    if (!canSegment) { alert(t.appFlow.completeCutoutFirstOrLoadAChannel); return }
    if (!segOutputDir) { alert(t.appFlow.setAnOutputFolder); return }
    if (!signalNets.length) { alert(t.appFlow.selectSignalNetsFirst); return }
    setLoadingMsg((t) => t.appFlow.creatingWholeChannelSolveSetup)
    setIsLoading(true)
    try {
      // 不分割寫出的也是 segment_1.aedb，撞到舊結果的方式與分段完全一樣，
      // 所以走同一條「先問過再覆寫」的路，不要各問各的。
      const data = await runSegmentJob('/api/segment/run-single', {
        signal_nets: signalNets,
        reference_nets: refNets,
        output_dir: segOutputDir,
        hfss_mesh_method: hfssMeshMethod,
        // 不分割沒有切面：這個欄位在這條路徑上就是判斷頻寬（後端沿用舊鍵名）。
        target_fmax_ghz: solverBandwidth.ghz,
        bandwidth_source: solverBandwidth.source,
      })
      if (!data) return               // 使用者不想覆寫舊結果
      reportGeometryBindings.current.segment = reportGeometryContext
      setReportQualityRecord(current => current?.context === reportGeometryContext
        ? { ...current, data: { ...current.data, metadata_path: data.metadata_path } } : null)
      // 分段在 session 當時開著的檔（workingPath）上做；鏈尾對得上才記 lineage。
      setReportWorkSources(previous => rememberWorkSource(previous, segmentedWorkSource(
        reportBoardPath, data.metadata_path, reportLineage, workingPath, refNets)))
      setSegRun(data)
      setActiveSegIdx(-1)
      setActiveView('segments')
      setSchedMetaPath(data.metadata_path || '')
      setSegmentSolverPlans((data.segments || []).map((segment: any) => ({
        index: segment.index,
        path: segment.path,
        ...(segment.solver_plan || {}),
        box_mm: segment.box_mm,
        manual_d_release: segmentReleases(data.cut_pairs, segment.index),
      })))
      setSegPlanBandwidthGHz(solverBandwidth.ghz)
      // 整片也要看得到求解器：預覽改成整塊一個區域，跟著表格 S1 的「指定」
      // 變色；上一次分析的段與切面線不再疊上來。
      setSegFollowPlan({ source: 'run' })
      setShowSolverRegionOverlay(true)
    } catch (e) {
      alert(t.appFlow.wholeChannelSetupFailed + errorText(e, lang), 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSegmentRun = async () => {
    if (!segAnalysis) { alert(t.appFlow.analyzeCutPositionsFirst); return }
    if (!segOutputDir) { alert(t.appFlow.setASegmentOutputFolder); return }
    if (!segAnalysis.threshold_feasible) {
      const looser = segAnalysis.threshold_report.filter(r => r.feasible)
      alert(looser.length
        ? t.appFlow.noFeasibleCombinationOfCutsMeetsGrade(segAnalysis.quality_threshold)
          + t.appFlow.relaxingTo(looser.map(r => t.appFlow.gradeMaximumSegmentMm(r.grade, length(r.max_segment_mm!))).join(t.appFlow.listSeparator))
          + t.appFlow.isFeasibleChangeAcceptableGradeAndAnalyze
        : t.appFlow.noFeasibleCutsExistEvenAtGrade)
      return
    }
    if (!segAnalysis.requested_safe || segAnalysis.cuts.some(c => c.hard_blocked)) {
      alert(t.appFlow.theHardSafetyGateFailedCannotSplit(segAnalysis.n_segments, segAnalysis.max_safe_segments))
      return
    }
    if (segAnalysis.balance_warning
        && !await confirm(t.appFlow.segmentsAreSolvedSequentiallyTheLargestSegment(pickText(segAnalysis, 'balance_warning', lang, unit)))) {
      return
    }
    if (segAnalysis.cuts.some(c => !c.valid || c.clearance_ok === false || c.poly_hit || c.risk_hit)) {
      if (!await confirm(t.appFlow.someCutPositionsHaveWarningsNonUnique)) return
    }
    const releases = segAnalysis.manual_d_release || []
    if (releases.length && !await confirm(releaseHasNoGuarantee(releases)
      ? t.appFlow.stitchReleaseNoGuaranteeRunConfirm(releases.length)
      : t.appFlow.stitchReleaseRunConfirm(releases.length, releaseRunLimit(releases)))) return
    setLoadingMsg((t) => t.appFlow.splittingIntoSegmentsEachSegmentRequiresA341(segAnalysis.cuts.length + 1))
    setIsLoading(true)
    try {
      const data = await runSegmentJob('/api/segment/run', {
        signal_nets: signalNets,
        reference_nets: refNets,
        direction: segAnalysis.direction,
        positions_mm: segAnalysis.cuts.map(c => c.position_mm),
        output_dir: segOutputDir,
        quality_threshold: segmentQuality,
        hfss_mesh_method: hfssMeshMethod,
        // 原本兩個頻率都沒送：重驗證退回顆數規則，建議要靠事後重評補。
        target_fmax_ghz: targetFmaxGHz,
        required_bandwidth_ghz: solverBandwidth.ghz,
        bandwidth_source: solverBandwidth.source,
        allow_stitch_release: Boolean(segAnalysis.allow_stitch_release),
      })
      if (!data) return               // 使用者不想覆寫舊結果
      reportGeometryBindings.current.segment = reportGeometryContext
      setReportQualityRecord(current => current?.context === reportGeometryContext
        ? { ...current, data: { ...current.data, metadata_path: data.metadata_path } } : null)
      // 分段在 session 當時開著的檔（workingPath）上做；鏈尾對得上才記 lineage。
      setReportWorkSources(previous => rememberWorkSource(previous, segmentedWorkSource(
        reportBoardPath, data.metadata_path, reportLineage, workingPath, refNets)))
      setSegRun(data)
      setActiveSegIdx(-1)   // 執行完先顯示整體視圖（完整板 + 切割線），方便確認每段位置
      setActiveView('segments')
      setSchedMetaPath(data.metadata_path || '')
      setSegmentSolverPlans((data.segments || []).map((segment: any) => ({
        index: segment.index,
        path: segment.path,
        ...(segment.solver_plan || {}),
        box_mm: segment.box_mm,
        manual_d_release: segmentReleases(data.cut_pairs, segment.index),
      })))
      setSegPlanBandwidthGHz(solverBandwidth.ghz)
      setSegFollowPlan({ source: 'run' })
      setShowSolverRegionOverlay(true)
    } catch (e) {
      alert(t.appFlow.segmentSplittingFailed + errorText(e, lang), 'error')
    } finally {
      setIsLoading(false)
    }
  }

  // ── 網路選取操作 ──────────────────────────────────────
  // 一律用 functional update：快速連續點擊時才不會拿到過期的 state 而漏掉選取
  const addSignal = (net: string) => {
    setSignalNets(prev => prev.includes(net) ? prev : [...prev, net])
    setRefNets(prev => prev.filter(n => n !== net))
  }
  const addRef = (net: string) => {
    setRefNets(prev => prev.includes(net) ? prev : [...prev, net])
    setSignalNets(prev => prev.filter(n => n !== net))
  }
  const removeSignal = (net: string) => setSignalNets(prev => prev.filter(n => n !== net))
  const removeRef = (net: string) => setRefNets(prev => prev.filter(n => n !== net))

  // ── 設定檔（HANDOFF 乙6）──────────────────────────────────────────
  const [profileNames, setProfileNames] = useState<string[]>([])
  /** 內建規格（DDR、PCIe…，後端 settings_profiles.BUILTIN_PROFILES）：唯讀、不能刪。 */
  const [builtinProfiles, setBuiltinProfiles] = useState<ProfileListItem[]>([])
  const [selectedProfile, setSelectedProfile] = useSessionState('selectedProfile', '')
  const [profileMsg, setProfileMsg] = useFlowMessage('')
  const refreshProfiles = async () => {
    try {
      const data = await api('/api/settings-profiles')
      const all = data.profiles || []
      setBuiltinProfiles(all.filter((p: any) => p.builtin))
      const names = all.filter((p: any) => !p.builtin).map((p: any) => p.name)
      setProfileNames(names)
      if (selectedProfile && !names.includes(selectedProfile)) setSelectedProfile('')
    } catch { /* 清單失敗不打斷畫面 */ }
  }
  useEffect(() => { void refreshProfiles() }, [])
  const saveProfile = async () => {
    if (!simulationReady) return
    if (solverCoresValue === null) { alert(t.solverCores.invalid); return }
    const name = (await promptMessage(t.appFlow.profileNameEGDdr3l1866Standard))?.trim()
    if (!name) return
    const settings = { specName, maxFrequencyGHz: Number(maxFrequencyGHz), solverCores }
    const fieldCount = 3
    try {
      // 先新增，由後端在鎖內判同名；不信任可能過期的前端選單。
      try {
        await api('/api/settings-profiles/save', { name, settings })
      } catch (error) {
        if ((error as { code?: string }).code !== 'settings.exists') throw error
        const saved = await confirmProfileOverwrite(api, message => confirm(message),
          name, settings, t.simulationSetup, builtinProfiles, lang)
        if (!saved) return
      }
      await refreshProfiles()
      setSelectedProfile(name)
      setProfileMsg((t) => t.appFlow.savedFields(name, fieldCount))
    } catch (e) { alert(t.appFlow.saveFailed + errorText(e, lang), 'error') }
  }
  const applyProfile = async (name: string) => {
    const epoch = ++simulationChoiceEpoch.current
    try {
      const data = await api('/api/settings-profiles/get', { name })
      if (epoch !== simulationChoiceEpoch.current) return
      const settings = data.settings || {}
      setSpecName(String(settings.specName || ''))
      setMaxFrequencyGHz(String(settings.maxFrequencyGHz))
      setSolverCores(String(settings.solverCores ?? DEFAULT_SOLVER_CORES))
      setProfileMsg((t) => t.appFlow.appliedFieldsFrom(name, 3))
    } catch (e) { alert(t.appFlow.applyFailed + errorText(e, lang), 'error') }
  }
  const chooseSpec = async (name: string) => {
    if (!name) { simulationChoiceEpoch.current++; setSpecName(''); return }
    // get 等待期間不改兩欄；成功後一起套用，避免新規範搭配舊上限。
    await applyProfile(name)
  }
  const deleteProfile = async (name: string) => {
    if (!await confirm(t.appFlow.deleteProfile(name))) return
    try {
      await api('/api/settings-profiles/delete', { name })
      setSelectedProfile('')
      await refreshProfiles()
      setProfileMsg((t) => t.appFlow.deleted(name))
    } catch (e) { alert(t.appFlow.deleteFailed + errorText(e, lang), 'error') }
  }

  /** 依平面銅面積建議參考網路（HANDOFF 第 9 條）。
   *  名稱猜得到 GND，猜不到 1V35 這種電源參考；面積是看得到的證據。 */
  const [refSuggestions, setRefSuggestions] = useState<
    { net: string; area_cm2: number; polygons: number }[] | null>(null)
  const suggestRefsByCopper = async () => {
    const epoch = boardAnalysisEpoch.current
    try {
      const data = await api('/api/nets/reference-suggestions', {})
      if (epoch !== boardAnalysisEpoch.current) return
      setRefSuggestions(data.suggestions || [])
    } catch (e) {
      if (epoch !== boardAnalysisEpoch.current) return
      alert(t.appFlow.suggestionFailed + errorText(e, lang), 'error')
    }
  }

  // DDR 自動分類。純字串處理，後端不開 AEDT、不讀 EDB，所以按下去就回來。
  const handleClassifyNets = async () => {
    if (allNets.length === 0) { alert(t.appFlow.loadABoardFirst); return }
    const epoch = boardAnalysisEpoch.current
    setDdrBusy(true)
    try {
      const data = await api('/api/nets/classify', { nets: allNets })
      if (epoch !== boardAnalysisEpoch.current) return
      setDdrResult(data)
      // 預設只勾資料、選通與遮罩：那是一個位元組通道實際要一起分析的東西。
      // 時脈與位址不預設勾選——它們是命令匯流排，跟資料的分析方式不同。
      setDdrRoles(['DQ', 'DQS_P', 'DQS_N', 'DM'])
    } catch (err: any) {
      if (epoch !== boardAnalysisEpoch.current) return
      alert(t.appFlow.ddrAutomaticClassificationFailed + (err?.message || err), 'error')
    } finally {
      if (epoch === boardAnalysisEpoch.current) setDdrBusy(false)
    }
  }

  // 只加進訊號網路，不動參考網路。參考網路要選哪些是另一個判斷，
  // 自動替使用者決定 GND／電源會讓人以為工具確認過回流路徑。
  const applyDdrRoles = () => {
    if (!ddrResult) return
    const picked = (ddrResult.rows || [])
      .filter((r: any) => ddrRoles.includes(r.role))
      .map((r: any) => r.net)
      .filter((net: string) => allNets.includes(net))
    if (picked.length === 0) { alert(t.appFlow.noNetsMatchTheSelectedRoles); return }
    setSignalNets(prev => {
      const merged = [...prev]
      for (const net of picked) if (!merged.includes(net)) merged.push(net)
      return merged
    })
    setRefNets(prev => prev.filter(n => !picked.includes(n)))
  }

  /** 只選一個位元組通道：資料＋遮罩＋選通，剛好是一次分析的單位。
   *
   *  角色勾選會把兩個位元組的 DQ 一起加進來（DQ0–15 共 16 條），那不是
   *  一次分析的範圍——DDR 是一個位元組通道配一組選通，量到的時序裕度
   *  以那一組的選通為基準。混在一起裁切與求解只是把模型做大。 */
  const applyDdrLane = (lane: any) => {
    const picked: string[] = [
      ...(lane.data || []), ...(lane.mask || []),
      ...(lane.strobe_p || []), ...(lane.strobe_n || []),
    ].filter(net => allNets.includes(net))
    if (picked.length === 0) return
    setSignalNets(picked)
    setRefNets(prev => prev.filter(n => !picked.includes(n)))
  }

  const handleExportSignalNets = () => {
    if (signalNets.length === 0) { alert(t.appFlow.noSignalNetsAreSelected); return }
    const header = [
      t.appFlow.pcbSi3dSimulationToolkitSignalNet,
      t.appFlow.oneNetPerLineLinesStartingWith,
    ]
    const blob = new Blob([[...header, ...signalNets, ''].join('\r\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'selected_signal_nets.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleImportSignalFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const requested = Array.from(new Set((await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))))
    // EDB／ODB 匯入後可能把 Net 名稱統一轉成大寫。清單比對不分大小寫，
    // 但寫入 state 時使用目前 EDB 的正式名稱，後續 PyEDB 才能精確找到 Net。
    const availableByLower = new Map(allNets.map(net => [net.toLocaleLowerCase(), net]))
    const matched = Array.from(new Set(requested
      .map(net => availableByLower.get(net.toLocaleLowerCase()))
      .filter((net): net is string => !!net)))
    const missing = requested.filter(net => !availableByLower.has(net.toLocaleLowerCase()))
    setSignalNets(matched)
    setRefNets(prev => prev.filter(net => !matched.includes(net)))
    if (missing.length > 0) {
      alert(t.appFlow.importedSignalNetsWereNotFoundIn(matched.length, missing.length, missing.slice(0, 12).join('\n'), missing.length > 12 ? '\n…' : ''))
    } else {
      alert(t.appFlow.importedSignalNets(matched.length), 'success')
    }
  }

  const availableFiltered = allNets
    .filter(n => !signalNets.includes(n) && !refNets.includes(n))
    .filter(n => n.toLowerCase().includes(filterText.toLowerCase()))

  // Port 候選元件：大型板禁止預設全選。只有候選端點不超過兩個時才自動勾選；
  // 候選較多時由使用者明確選擇，避免對大型 BGA 上大量非端點元件建立 Port。
  const candidateComps = components.filter(c => c.nets.some(n => signalNets.includes(n)))
  useEffect(() => {
    setCheckedComps(prev => {
      const next: Record<string, boolean> = {}
      for (const c of candidateComps) {
        next[c.name] = prev[c.name] !== undefined ? prev[c.name] : candidateComps.length <= 2
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalNets.join(','), components.length])

  const selectRecommendedPortComponents = () => {
    const ranked = [...candidateComps].sort((a, b) => {
      const aHits = a.nets.filter(net => signalNets.includes(net)).length
      const bHits = b.nets.filter(net => signalNets.includes(net)).length
      return bHits - aHits
    })
    const selected = new Set(ranked.slice(0, 2).map(c => c.name))
    setCheckedComps(Object.fromEntries(candidateComps.map(c => [c.name, selected.has(c.name)])))
  }

  // ── 選單列 ────────────────────────────────────────────
  // 畫面區讀英文 API 欄位；沒有英文的舊資料保留原文。
  const viewField = (item: unknown, key: string): string => {
    return pickText(item, key, lang, unit)
  }
  const viewList = (item: unknown, key: string): string[] => {
    return pickList(item, key, lang, unit)
  }
  /** 縫合上限、手動放行 D 級的狀態與按鈕；等分與複雜度兩個面板共用。 */
  const renderStitchRelease = (
    analysis: SegmentAnalysis | ComplexityAnalysis, mode: 'axis' | 'complexity',
  ) => {
    const releases = analysis.manual_d_release || []
    return (
      <>
        {analysis.stitch_ceiling && (
          <div className="status status--warn" style={{ marginTop: 6, fontSize: 11.5 }}
            title={viewField(analysis.stitch_ceiling, 'text')}>
            {t.appView.stitchCeilingShort(
              analysis.stitch_ceiling.best_limit_ghz.toFixed(1),
              Number(analysis.stitch_ceiling.target_fmax_ghz).toFixed(0))}
          </div>
        )}
        {analysis.allow_stitch_release && (
          <div className="status status--warn" style={{ marginTop: 6, fontSize: 11.5 }}
            title={releases.map(entry => `${entry.axis === 1 ? 'Y' : 'X'}=${measure(entry.position_mm ?? 0)} ${releaseWarning(entry, lang, unit)}`).join('\n')}>
            <b>{releases.length
              ? t.appView.stitchReleaseActive(releases.length, releaseHasNoGuarantee(releases)
                ? t.appView.stitchReleaseNoGuarantee
                : t.appView.stitchReleaseUpTo(releaseRunLimit(releases)))
              : t.appView.stitchReleaseNone}</b>
          </div>
        )}
        {analysis.allow_stitch_release && (
          <button className="btn" style={{ width: '100%', marginTop: 6 }}
            onClick={() => handleStitchRelease(mode, false)}>{t.appView.stitchReleaseCancel}</button>
        )}
        {canOfferStitchRelease(analysis) && (
          <button className="btn" style={{ width: '100%', marginTop: 6 }}
            onClick={() => handleStitchRelease(mode, true)}>{t.appView.stitchReleaseOffer}</button>
        )}
      </>
    )
  }
  const viewError = (error: unknown): string => safeUserMessage(error, lang)
    || (lang === 'en' ? viewField(error, 'message') : '')
    || (error instanceof Error ? error.message : String(error))
  // 用穩定 id 當鍵、文字查語言檔：以前拿中文標籤當物件鍵，切語言鍵就變了。
  type MenuEntry = { id: string; label: string; action: () => void; disabled?: boolean; checked?: boolean }
  type Menu = { id: string; label: string; entries: MenuEntry[]; tail?: { heading: string; entries: MenuEntry[] } }
  const menus: Menu[] = [
    { id: 'file', label: t.menu.file, entries: [
      { id: 'openBoard', label: t.menu.openBoard, action: handleBrowseInput },
      { id: 'loadNets', label: t.menu.loadNets, action: () => handleLoadFile(), disabled: !inputPath },
      { id: 'reloadOriginal', label: t.menu.reloadOriginal, action: handleReloadOriginal, disabled: allNets.length === 0 },
    ] },
    { id: 'run', label: t.menu.run, entries: [
      { id: 'runCutout', label: t.menu.runCutout, action: handleCutout,
        disabled: signalNets.length === 0 },
      { id: 'analyzeSegments', label: t.menu.analyzeSegments, action: handleSegmentAnalyze, disabled: !canSegment },
      { id: 'runSegments', label: t.menu.runSegments, action: handleSegmentRun, disabled: !segAnalysis },
      { id: 'solveWhole', label: t.menu.solveWhole, action: handleSingleSegmentRun, disabled: !canSegment },
      { id: 'cascade', label: t.menu.cascade, action: () => {}, disabled: true },
    ] },
    { id: 'view', label: t.menu.view, entries: [
      { id: 'logs', label: showLogs ? t.menu.hideLogs : t.menu.showLogs, action: () => setShowLogs(!showLogs) },
      { id: 'fullLayout', label: t.menu.fullLayout, action: () => setActiveView('full') },
      { id: 'cutLayout', label: t.menu.cutLayout, action: () => setActiveView('cut'), disabled: !cutScene },
      { id: 'cleanupCompare', label: t.menu.cleanupCompare, action: () => setActiveView('cleanup'), disabled: !cleanupAfterScene },
      { id: 'models', label: t.menu.models, action: () => setActiveView('models'), disabled: !show.models },
      { id: 'reportCenter', label: t.menu.reportCenter, action: () => setActiveView('report') },
    ], tail: {
      // 檢視 → Language／語言。語言名稱用該語言自己寫，切錯了也認得出來。
      heading: t.menu.language,
      entries: LANGS.map(code => ({
        id: `lang-${code}`, label: LANG_NAMES[code], action: () => setLang(code), checked: lang === code,
      })),
    } },
    { id: 'help', label: t.menu.help, entries: [
      { id: 'about', label: t.menu.about, action: showAbout },
      { id: 'licenses', label: t.menu.licenses, action: () => setLicensePanelOpen(true) },
      { id: 'supportBundle', label: t.menu.supportBundle, action: () => setSupportDialogOpen(true) },
      ...(desktopShell ? [{ id: 'openInBrowser', label: t.menu.openInBrowser, action: () => void openInBrowser() }] : []),
    ] },
  ]

  // 分段檢視：activeSegIdx === -1 代表「整體視圖」（完整板 + 切割線疊圖，
  // 分析完成後、執行後都可切回來看），>= 0 代表執行後的第 N 段實際 Layout
  const isOverviewMode = activeSegIdx === -1
  const segScene = (isOverviewMode || !segRun)
    ? (cutScene || fullScene)
    : (segRun.previews?.[activeSegIdx] || cutScene || fullScene)
  const scene = activeView === 'cut' ? cutScene
    : activeView === 'cleanup' ? cleanupAfterScene
    : activeView === 'segments' ? segScene
    // 截面要切在最終幾何上，所以裁切過就用裁切後的板；裁切外的東西也不會進
    // 求解，拿完整板來框範圍反而會框到後面根本不存在的銅。
    : activeView === 'crosssection' ? (cutScene || fullScene) : fullScene
  // 哪些分頁真的在畫 Layout。上方那條「左鍵平移、滾輪縮放…」提示與「請先載入
  // 電路板」浮水印都只對這些成立——原本兩處各自用「不是 A 也不是 B 也不是 C」
  // 的排除清單，新增分頁時必然漏掉：S 參數分頁就同時吃到了那條 Layout 提示
  // （疊在自己的標題上）與浮水印（壓在曲線圖中央）。
  const isLayoutView = (['full', 'cut', 'segments'] as ViewMode[])
    .includes(activeView)
  // 分段預覽、預覽標題與報告快照的段數共用同一份來源。
  const segOverlayInput = {
    complexity: complexityAnalysis,
    axis: segAnalysis,
    plans: segmentSolverPlans,
    followPlan: segFollowPlan,
  }
  const segWholeBoard = isWholeBoardPlan(segOverlayInput)

  // 每個分頁都要明確給一個標題，這裡刻意用 Record<ViewMode, string> 而不是
  // 一串 `? :`。原本最後落到「完整電路板 Layout」當預設，新增的「眼圖」分頁
  // 沒有自己的分支就掉進那個預設，報告快照因此被存成「完整電路板 Layout」
  // ——上面那段註解講的正是同一個坑，隔幾行就又踩一次。改成 Record 之後，
  // 漏掉任何一個分頁 TypeScript 會直接編不過。
  const sceneLabels: Record<ViewMode, string> = {
    full: t.appView.fullBoardLayout,
    cut: t.appView.cutoutLayout,
    cleanup: t.appView.layoutCleanupComparison,
    segments: segRun && !isOverviewMode
      ? t.appView.segmentLayout(activeSegIdx + 1, segRun.segments.length)
      : segWholeBoard
        ? t.appView.wholeBoardOverview
        : segmentOverlayCount(segOverlayInput) !== null
          ? t.appView.segmentOverview(segmentOverlayCount(segOverlayInput)!)
          : t.appView.nSegmentPreview,
    schematic: t.appView.cascadeSchematicYellowDotsShortedNodesDashed,
    sparam: t.appView.cascadedSParametersSwitchBetweenSingleEnded,
    eye: t.appView.quickeyeEyeHeightAndWidthMeasuredBy,
    models: t.appView.ibisModelsAndEyeAnalysis,
    tdr: t.appView.tdrImpedanceLocationDiscontinuitiesMarkedOnLayout,
    crosssection: t.appView.crossSectionImpedanceSelectAWorkArea,
    report: t.appView.htmlReportCenter,
  }
  const sceneLabel = sceneLabels[activeView]
  // 切割線疊圖：執行前（!segRun，此時無論 activeSegIdx 是什麼都要顯示）
  // 或執行後切回「整體視圖」時都要顯示
  const segCutsOverlay: SegmentCutsInfo | null =
    activeView === 'segments' && (!segRun || isOverviewMode)
      ? buildSegmentOverlay(segOverlayInput)
      : null
  const cleanupOverlay: CleanupOverlay | null =
    cleanupAnalysis && !cleanupAnalysis.deleted && (activeView === 'full' || activeView === 'cut')
      ? cleanupAnalysis.overlay
      : null
  const cleanupRemovedOverlay: CleanupOverlay | null =
    cleanupAnalysis?.deleted ? cleanupAnalysis.overlay : null
  const cleanupDifferenceLayers = cleanupAnalysis?.removed_geometry
    ? Object.keys(cleanupAnalysis.removed_geometry.layers).sort()
    : []
  const cleanupFocusedBounds = cleanupFocusRegion === null
    ? null
    : cleanupAnalysis?.difference_regions?.[cleanupFocusRegion]?.bounds || null
  const currentBoundaryKey = cutoutBoundaryKey(
    signalNets, refNets, expansionMm, extentType,
  )
  const fullEstimatedBoundary = preciseBoundaryPreviewKey === currentBoundaryKey
    ? preciseBoundaryPreview : null
  // 預估外框只在「完整 Layout」裁切前預覽用。裁切後分頁只畫裁切後的板子
  // （：預估與實際外框的比對填色實務上用不到，已移除）。
  const visibleEstimatedBoundary = activeView === 'full'
    ? fullEstimatedBoundary : null
  // 報告工作區的「預設位置」——只在還沒有工作區時用得到。
  //
  // 要跟著使用者現在在看的東西放，不要落到 C 槽的家目錄。依序取：分段輸出
  // 資料夾 → 裁切輸出 → 目前結果的 S 參數檔 → 輸入檔。cascadeResult 那一項
  // 是為了「只載入一個外部 .sNp 來看曲線」的情形——那時前三項都是空的，但那
  // 個 .sNp 就在使用者的專案目錄裡，正是該放報告的地方。
  // 後端會確保 .aedb 不被當成一般資料夾而寫入內部。
  //
  // 注意：實際傳給報告功能的是 `reportWorkspace || reportDefaultBasePath`。
  // 一旦工作區定下來就固定，不再隨載入的檔案漂移——否則同一個案子換個匯入
  // 來源就會各自長出一個 report_workspace，快照散在好幾個資料夾裡。
  const reportDefaultBasePath = segOutputDir || outputPath
    || cascadeResult?.output_path || inputPath
  const reportBasePath = reportWorkspace || reportDefaultBasePath
  const reportProjectName = (
    (inputPath || cascadeResult?.output_path || '').split(/[\\/]/).pop()
    || t.appView.pcbSiAnalysisProject
  ).replace(/\.(aedb|brd|tgz|s\d+p)$/i, '')
  const reportSectionByView: Record<ViewMode, string> = {
    full: 'board', cut: 'cutout', cleanup: 'cleanup', segments: 'segments',
    schematic: 'schematic', sparam: 'sparam', eye: 'eye', tdr: 'tdr',
    models: 'models', crosssection: 'crosssection',
    report: 'results',
  }
  const reportSourceRevision = activeView === 'segments'
    ? (schedMetaPath || segOutputDir)
    : activeView === 'schematic' || activeView === 'sparam'
      ? String(cascadeResult?.output_path || schedMetaPath || '')
      : activeView === 'eye'
        ? String(eyeJob?.result?.image_path || '')
        : activeView === 'models'
          ? 'ibis-model-eye-analysis-workspace'
        : activeView === 'tdr'
          ? String(tdrJob?.result?.project_path || '')
          : activeView === 'cut' || activeView === 'cleanup'
            ? outputPath
            : inputPath
  const reportSnapshotAvailable = activeView !== 'report' && Boolean(
    activeView === 'models'
    || scene
    || (activeView === 'schematic' && schematicGraph)
    || (activeView === 'sparam' && cascadeResult)
    || (activeView === 'eye' && eyeJob?.status === 'done')
    || (activeView === 'tdr' && tdrJob?.status === 'done')
    || (activeView === 'crosssection' && xsScan),
  )
  // 一鍵收納所有快照：報告中心自己畫、自己拍，不切使用者的分頁。
  // 段預覽只在屬於同一份 segments.json 時才交出去，其餘由後端讀段檔重建。
  const reportChosenMetadataPath = schedMetaPath || segRun?.metadata_path || ''
  const reportCollectMetadataPath = segRun
    && normalizeUserPath(segRun.metadata_path || '') === normalizeUserPath(reportChosenMetadataPath)
    && reportGeometryBindings.current.segment !== reportGeometryContext ? '' : reportChosenMetadataPath
  const reportTdrResult = boundJobResult(tdrJob, reportJobBindings.current.tdr, reportTdrContext)
  const reportEyeResult = boundJobResult(eyeJob, reportJobBindings.current.eye, reportEyeContext)
  const reportXsResult = boundJobResult(xsJob, reportJobBindings.current.xs, reportXsContext, true)
  const reportXsEvidence = reportXsResult ? reportJobBindings.current.xs?.evidence : undefined
  const reportTdrEvidence = reportTdrResult ? reportJobBindings.current.tdr?.evidence : undefined
  const reportEyeEvidence = reportEyeResult ? reportJobBindings.current.eye?.evidence : undefined
  const reportCollectSources: ReportCollectSources = {
    workSources: reportWorkSources.filter(row => sourcePathKey(row.board_path) === sourcePathKey(reportBoardPath)),
    contextKey: JSON.stringify([reportSourceContext, reportEyeContext, reportTdrContext, reportXsContext]),
    metadataPath: reportCollectMetadataPath,
    cascadeTouchstone: reportGeometryBindings.current.cascade === reportCascadeContext
      ? cascadeResult?.output_path || '' : '',
    signalNets, refNets,
    // 板子身分只在真的載入了板子時給；路徑欄打了字還沒載入不算。
    boardPath: fullScene ? reportBoardPath : '',
    board: fullScene,
    cutout: reportGeometryBindings.current.cut === reportGeometryContext ? cutScene : null,
    cleanupBefore: reportGeometryBindings.current.cleanup === reportGeometryContext ? cleanupBeforeScene : null,
    cleanup: reportGeometryBindings.current.cleanup === reportGeometryContext ? cleanupAfterScene : null,
    schematic: reportGeometryBindings.current.schematic === reportCascadeContext ? schematicGraph || null : null,
    segmentPreviews: segRun && normalizeUserPath(segRun.metadata_path || '')
      === normalizeUserPath(reportCollectMetadataPath)
      && reportGeometryBindings.current.segment === reportGeometryContext ? (segRun.previews || []) : [],
    tdrProfiles: reportTdrResult && reportTdrEvidence
      ? (reportTdrResult.analyses || [])
        .filter((analysis: any) => (analysis.distance_mm || []).length >= 2
          && analysis.distance_mm.length === (reportTdrResult.impedance_ohm || []).length)
        .map((analysis: any) => ({
          label: `${reportTdrResult.probe || 'TDR'} (${analysis.method || ''})`,
          distance_mm: analysis.distance_mm || [],
          impedance_ohm: reportTdrResult.impedance_ohm || [],
          source_evidence: reportTdrEvidence,
        }))
      : [],
    eyeImages: reportEyeResult?.image_path && reportEyeEvidence
      ? [{ label: 'QuickEye', path: String(reportEyeResult.image_path), source_evidence: reportEyeEvidence }] : [],
    crossSectionCuts: reportXsResult?.cuts || [],
    tdrResult: reportTdrResult,
    eyeResult: reportEyeResult,
    evidence: { xs: reportXsEvidence, tdr: reportTdrEvidence, eye: reportEyeEvidence },
    // 原生 job 沒有可證明的通用 run_id 時，不猜 manifest 的 ID，也不把舊條件補回。
    selectedRuns: Object.keys(reportJobBindings.current).length ? {} : null,
    preprocessing: {
      cutout: reportCutoutRecord?.context === reportGeometryContext ? reportCutoutRecord : null,
      cleanup: reportCleanupRecord?.context === reportGeometryContext ? reportCleanupRecord : null,
      quality: reportQualityRecord?.context === reportGeometryContext
        && normalizeUserPath(reportQualityRecord.data.metadata_path || '') === normalizeUserPath(reportCollectMetadataPath)
        ? reportQualityRecord : null,
      hasCutout: !!reportCutoutRecord || (!!cutScene && !directSegmentMode), hasCleanup: !!cleanupAfterScene,
      hasSegments: !!reportCollectMetadataPath, segmentCount: segRun?.segments.length,
    },
    views: supplementalViews(reportXsEvidence ? reportXsResult?.cuts || [] : [], reportXsEvidence && reportTdrEvidence
      && reportComparisonBinding.current === reportCompareContext ? xsCompare : null,
      reportTdrEvidence ? reportTdrResult : null, { scene: tdrScene,
        markers: reportMarkerBinding.current === reportMarkerContext ? tdrMarkers : null },
      effectiveReportLocale(lang), tdrAnalysisIdx).map(view => ({ ...view,
        source_evidence: view.type === 'tdr_location' ? reportTdrEvidence : view.type === 'comparison'
          ? { task_id: `${reportXsEvidence!.task_id}+${reportTdrEvidence!.task_id}`,
            condition_id: `${reportXsEvidence!.condition_id}+${reportTdrEvidence!.condition_id}`,
            files: [...reportXsEvidence!.files, ...reportTdrEvidence!.files] } : reportXsEvidence })),
  }
  useReportStaleRevision(reportWorkspace, ['board'], fullScene, t.appView.fullBoardDataReloaded)
  useReportStaleRevision(reportWorkspace, ['cutout'], cutScene, t.appView.cutoutResultsUpdated)
  useReportStaleRevision(reportWorkspace, ['cleanup'], cleanupAfterScene, t.appView.layoutCleanupResultsUpdated)
  useReportStaleRevision(reportWorkspace, ['segments'], segRun, t.appView.nSegmentResultsUpdated)
  useReportStaleRevision(reportWorkspace, ['schematic', 'sparam'], cascadeResult, t.appView.cascadeResultsUpdated)
  useReportStaleRevision(reportWorkspace, ['eye'], eyeJob?.result, t.appView.eyeResultsUpdated)
  useReportStaleRevision(reportWorkspace, ['tdr'], tdrJob?.result, t.appView.tdrResultsUpdated)
  const formatBytes = (value: number) => {
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / 1024 / 1024).toFixed(1)} MB`
  }

  const toggleTask = (key: TaskKey, checked: boolean) =>
    setEnabledTasks(prev => (checked
      ? (prev.includes(key) ? prev : [...prev, key])
      : prev.filter(item => item !== key)))

  // 入口是整個畫面，直接消失會像閃了一下。先播退場動畫，動畫結束才卸載。
  //
  // 保險絲：動畫理論上一定會結束（`prefers-reduced-motion` 也只是縮成 1ms，
  // 不是 `animation: none`），但入口卡住＝整個工具打不開，代價太高。所以
  // 另外掛一個逾時，動畫沒回報也照樣關掉。
  const finishClosingPicker = () => {
    if (pickerCloseTimer.current !== null) {
      window.clearTimeout(pickerCloseTimer.current)
      pickerCloseTimer.current = null
    }
    setPickerOpen(false)
    setPickerClosing(false)
    setPickerReturning(false)
  }

  const closePicker = () => {
    saveTasks(enabledTasks)
    setPickerClosing(true)
    pickerCloseTimer.current = window.setTimeout(finishClosingPicker, 600)
  }

  // 被隱藏但仍在執行的工作：不提示的話，長時間求解會變成黑箱。
  const hiddenRunning: string[] = []
  if (!show.schedule && schedStatus?.running) hiddenRunning.push(t.appView.scheduledSolve)
  // 眼圖已經整合進「IBIS 模型與眼圖分析」，入口沒有獨立的 eye 項目——
  // 看 show.eye 永遠是 undefined，於是眼圖一跑就冒出「項目已隱藏」，
  // 而點開的選單裡根本沒有可以勾的眼圖。要看的是它現在住的那一項。
  if (!show.models && eyeJob?.running) hiddenRunning.push(t.appView.eyeAnalysis)
  if (!show.tdr && tdrJob?.running) hiddenRunning.push('TDR')

  return (
    <div className="app-shell" onClick={() => setOpenMenu(null)}>
      {supportDialogOpen && <SupportBundleDialog onCreate={(plaintext, dumps) => void makeSupportBundle(plaintext, dumps)} onClose={() => setSupportDialogOpen(false)} />}
      {licensePanelOpen && <AnsysLicensePanel onClose={() => setLicensePanelOpen(false)} />}
      {confirmRequest && <ConfirmDialog request={confirmRequest} onSettle={settleConfirm} />}
      {closeRequest && (
        <CloseSessionDialog request={closeRequest}
          onSave={() => closeWindowWith('save')}
          onDiscard={() => closeWindowWith('discard')}
          onCancel={cancelWindowClose} />
      )}
      {aboutOpen && <div role="dialog" aria-modal="true" aria-label={t.menu.about}
        style={{ position: 'fixed', inset: '15% 20%', zIndex: 10000, background: 'var(--panel-solid)', color: 'var(--text)', padding: 24, overflow: 'auto' }}>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif' }}>{aboutText}</pre>
        <EulaPanel />

        <button type="button" onClick={() => setAboutOpen(false)}>×</button>
      </div>}
      {pickerOpen && (
        <TaskPicker
          flags={makeFlags(enabledTasks)}
          onToggle={toggleTask}
          onSetAll={keys => setEnabledTasks([...keys])}
          onStart={closePicker}
          returning={pickerReturning}
          closing={pickerClosing}
          onClosed={finishClosingPicker}
          legacyBeta={legacyBetaTasks}
        />
      )}
      {hiddenRunning.length > 0 && (
        <div
          className="app-banner"
          onClick={() => { setPickerReturning(true); setPickerOpen(true) }}
          title={t.appView.returnToTheTaskPickerAndSelectTip}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
            background: '#243b2a', color: '#b9f0c6', fontSize: 12,
            padding: '4px 12px', cursor: 'pointer',
            borderBottom: '1px solid #35603f',
            fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
          }}
        >{t.appView.hiddenRunning(t.appView.joinList(hiddenRunning))}</div>
      )}
      {isLoading && (
        <div className="app-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent)'
        }}>
          <div style={{ maxWidth: '70vw', textAlign: 'center' }}>
            {boundaryPreviewStartedAt !== null && cutoutStopping
              ? t.appFlow.stopRequestedWaitingForTheCurrentPyedb : loadingMsg}
            {boundaryPreviewStartedAt !== null
              && t.appView.elapsedS(Math.max(0, Math.floor(nowTick - boundaryPreviewStartedAt)))}
          </div>
          {cutoutJobId && (
            <button className="btn" onClick={handleStopCutout} disabled={cutoutStopping}
              style={{ minWidth: 150, borderColor: 'var(--danger)', color: 'var(--danger)', background: '#fff' }}>
              {/* 這個背景工作機制裁切、疊構更換、背鑽都共用，寫死「裁切」
                  在套用疊構時會變成錯的字。 */}
              {cutoutStopping ? t.appView.stopping : t.appView.stopCurrentJob}
            </button>
          )}
          {/* 遮罩擋住操作的期間，系統日誌本體也被蓋在下面看不到；這裡直接秀
              最新幾行，讓長時間操作（例如讀取大型 EDB）不是乾等一句籠統訊息。
              logs 是全域 websocket 狀態，遮罩顯示與否都持續即時更新。 */}
          <div
            ref={loadingLogBoxRef}
            style={{
              width: 'min(640px, 80vw)', maxHeight: '32vh', overflowY: 'auto',
              fontSize: 12, fontWeight: 400, fontFamily: '"Cascadia Mono", monospace',
              textAlign: 'left', color: 'var(--muted)',
              background: 'rgba(20,24,30,0.82)', padding: '10px 12px',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
            }}
          >
            {logs.slice(-60).map((l, i) => (
              <div key={i} style={{ color: logColor(l) }}>{logText(l, lang)}</div>
            ))}
            {logs.length === 0 && <div style={{ color: 'var(--faint)' }}>{t.appView.noLogsYet}</div>}
          </div>
        </div>
      )}
      {/* Beta 開關原本獨占標題上方一整列；1280×720 的筆電上每一列都在跟主要內容
          搶高度，所以併進標題列右側。 */}
      <header className="app-header">
        <div>
          <h1 className="app-title">{t.appView.pcbSiDSimulationToolkit}<span className="app-version" title={backendVersion?.build_id ? t.appView.buildTip(backendVersion.build_id) : t.appView.versionTip}>
              v{__APP_VERSION__}
            </span>
          </h1>
          <p className="app-sub">{t.appView.channelCutoutSegmentationAndEyeAnalysis}</p>
        </div>
        <div className="app-header__aside">
          <BetaSwitch />
          <img
            className="app-logo"
            src="/logo.png"
            alt={t.appView.cadmen}
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>
      </header>

      {/* 後端沒重啟。這條要擺在最上面而且不能關掉：版本對不上時後面每一個
          症狀都會指向錯的方向——新端點回 405、舊後端安靜忽略新欄位於是按鈕
          一直是灰的。看到這一條就不必再查其他東西了。 */}
      {staleBackend !== null && (
        <div className="app-banner" style={{
          background: 'var(--danger, #b3261e)', color: '#fff',
          padding: '10px 14px', borderRadius: 'var(--radius-sm)',
          margin: '8px 0', fontSize: 13, lineHeight: 1.6,
        }}>
          <strong>{t.appView.theBackendIsOutdatedRestartTheTool}</strong>
          <div>{t.appView.theUiRequiresVersionTheBackendReports(API_CONTRACT_VERSION, staleBackend ? ` ${staleBackend}` : t.appView.noVersionReportedOlderBackend)}</div>
          <div>{t.appView.newFeaturesMayReturnMethodNotAllowed}</div>
          <div>{t.appView.closeTheWindowAndRestart(restartHint(lang))}</div>
        </div>
      )}

      {/* 工作階段還原結果與背景工作。 */}
      {(sessionNotices.length > 0 || autosaveError) && (
        <div style={{ margin: '6px 0', display: 'grid', gap: 4 }}>
          {sessionNotices.map((notice, index) => (
            <div key={index} className={notice.kind === 'warn' ? 'status status--err' : 'status status--ok'}
              style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
              <span style={{ flex: 1 }}>{notice.text(t)}</span>
              <button className="btn--mini"
                onClick={() => setSessionNotices(list => list.filter((_, i) => i !== index))}>
                {t.closeSession.dismiss}
              </button>
            </div>
          ))}
          {autosaveError && (
            <div className="status status--err" style={{ fontSize: 12.5 }}>
              {t.closeSession.autosaveFailed(autosaveError)}
            </div>
          )}
        </div>
      )}

      {/* 選單列。入口畫面開著時隱藏——那些動作都要先選好項目才有意義。 */}
      <nav className="menubar" hidden={pickerOpen}
        onClick={(e) => e.stopPropagation()}>
        {menus.map(menu => (
          <div key={menu.id} className="menubar__item">
            <button
              className={'menubar__btn' + (openMenu === menu.id ? ' menubar__btn--open' : '')}
              onClick={() => setOpenMenu(openMenu === menu.id ? null : menu.id)}
              onMouseEnter={() => { if (openMenu) setOpenMenu(menu.id) }}
            >{menu.label}</button>
            {openMenu === menu.id && (
              <div className="menubar__dropdown" role="menu">
                {menu.entries.map(entry => (
                  <button
                    key={entry.id}
                    className="menubar__entry"
                    role="menuitem"
                    disabled={entry.disabled}
                    onClick={() => { setOpenMenu(null); entry.action() }}
                  >{entry.label}</button>
                ))}
                {menu.id === 'view' && <>
                  <div className="menubar__sep" />
                  <LengthUnitControl onSelect={() => setOpenMenu(null)} />
                </>}
                {menu.tail && <>
                  <div className="menubar__sep" />
                  <div className="menubar__heading">{menu.tail.heading}</div>
                  {menu.tail.entries.map(entry => (
                    <button
                      key={entry.id}
                      className={'menubar__entry' + (entry.checked ? ' menubar__entry--checked' : '')}
                      role="menuitemradio"
                      aria-checked={!!entry.checked}
                      onClick={() => { setOpenMenu(null); entry.action() }}
                    >{entry.label}</button>
                  ))}
                </>}
              </div>
            )}
          </div>
        ))}
      </nav>
      <LengthUnitError />

      <main style={{ flex: 1, minHeight: 0 }}>
        <Allotment defaultSizes={splitSizes} onChange={saveSplitSizes}>
          {/* 左側：設定面板。眼圖頁用不到電路板設定，收起來讓精靈有完整高度與寬度
              （走查：1600×950 視窗眼圖區只剩約 420 px）。 */}
          <Allotment.Pane minSize={320} visible={activeView !== 'models'}>
            <div style={{ paddingRight: 7, height: '100%' }}>
              <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%', gap: '12px', overflowY: 'auto' }}>

                {/* 入口：回去調整這次要顯示哪些項目。狀態一律保留。 */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  paddingBottom: 8,
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{t.appView.selectedTasks(enabledTasks.length)}</span>
                  <button
                    className="btn--mini"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => { setPickerReturning(true); setPickerOpen(true) }}
                    title={t.appView.returnToTheTaskPickerTheLoadedTip}
                  >{t.appView.changeTasks}</button>
                </div>

                {/* 輸入檔案 */}
                <div hidden={!(show.load)}>
                  <h3 className="panel-title">{t.appView.inputFileAedbBrdTgz}</h3>
                  {/* 只有一個可用版本時不顯示選單——一個選項的下拉是純噪音。
                      AEDT 出新版並納入支援後會自動出現。 */}
                  {aedtVersions.length > 1 && (
                    <>
                      <div className="field-row" style={{ marginTop: 6 }}>
                        <span className="field-label" style={{ margin: 0, minWidth: 78 }}>{t.appView.aedtVersion}</span>
                        <select aria-label={t.appView.aedtVersion} className="input" value={aedtVersion}
                          disabled={aedtLocked}
                          onChange={e => void handleSetAedtVersion(e.target.value)}>
                          {aedtVersions.map(v => (
                            <option key={v.version} value={v.version} disabled={!v.installed}>
                              {v.version.replace('.', ' R')}
                              {v.installed ? '' : t.appView.notInstalled}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>
                        {/* 「重新載入原始檔」不會解鎖：它自己就會把 EDB 重新
                            開起來，而後端只在沒有 EDB 時才允許換版本。 */}
                        {aedtLocked
                          ? t.appView.aBoardIsLoadedRestartTheTool
                          : t.appView.thisVersionIsUsedThroughoutTheWorkflow}
                      </div>
                    </>
                  )}
                  {aedtVersions.length === 1 && !aedtVersions[0].installed && (
                    <div className="status status--warn" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.aedtIsNotInstalledOnlyThisVersion(aedtVersion)}</div>
                  )}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label={t.appView.inputFilePath}
                      type="text"
                      className="input"
                      value={inputPath}
                      onChange={e => setInputPath(e.target.value)}
                      placeholder={t.appView.fieldPathToBoardAedb}
                    />
                    <button className="btn" onClick={handleBrowseInput}>{t.appView.browse}</button>
                  </div>
                  {/* 原本這裡有「直接匯入分段」勾選框。入口的「局部裁切」已經
                      決定了同一件事，再擺一個框只是要使用者把同樣的決定講第二遍。
                      模式改由按鈕文字與下方這行說明表達。 */}
                  <div className="panel-hint" style={{ marginTop: 6, fontSize: 11 }}>
                    {directSegmentMode
                      ? t.appView.localCutoutIsDisabledThisFileWill
                      : t.appView.localCutoutIsEnabledSetTheCutout}
                  </div>
                  <button className="btn--primary" onClick={() => handleLoadFile()} style={{ marginTop: 6 }}
                    disabled={Boolean(loadBlock)} title={loadBlock || undefined}>
                    {directSegmentMode ? t.appView.loadFileNoCutout : t.appView.loadBoard}
                  </button>
                  {loadFunctions.length > 0 && <LicenseTag functions={loadFunctions} />}
                  {/* ：勾著「局部裁切」載入了一塊已經設好 Port 的板——多半是
                      忘了去入口取消，接著會把已裁切的板再裁一次。 */}
                  {existingPorts.length > 0 && !directSegmentMode && !cutScene && (
                    <div className="panel-caveat" style={{ marginTop: 6 }} data-testid="existing-ports-switch">
                      {t.appView.existingPortsSwitchHint(existingPorts.length,
                        portComponents(existingPorts).join(t.appFlow.listSeparator))}
                      <button className="btn" style={{ marginTop: 6, display: 'block' }}
                        onClick={() => void switchToNoCutoutAndReload()} disabled={isLoading}>
                        {t.appView.existingPortsSwitchButton}
                      </button>
                    </div>
                  )}
                  {netsPrefilledFromPorts.length > 0 && (
                    <div className="panel-hint" style={{ marginTop: 6, fontSize: 11 }} data-testid="nets-prefilled-from-ports">
                      {t.appView.signalNetsPrefilledFromPorts(
                        netsPrefilledFromPorts.join(t.appFlow.listSeparator))}
                    </div>
                  )}
                  {/* 拿去給客戶用的時候，第一個被問的就是「我的板子檔會不會被傳走」。
                      這一段回答它，而且路徑是跟後端要的實際值，不是寫死的字串——
                      模型庫與設定檔的位置可由環境變數覆寫，寫死就會開始說謊。
                      收在 <details> 裡：這是要用的時候找得到，不是每次都要讀的東西。 */}
                  <details style={{ marginTop: 8 }}
                    onToggle={event => {
                      if (!(event.currentTarget as HTMLDetailsElement).open || storageInfo) return
                      void fetch('/api/storage/locations')
                        .then(res => (res.ok ? res.json() : null))
                        .then(data => { if (data) setStorageInfo(data) })
                        .catch(() => { /* 顯示不出來就算了，不要為了一段說明跳錯誤 */ })
                    }}>
                    <summary className="panel-hint" style={{ cursor: 'pointer' }}>{t.appView.whereDoesMyBoardFileGo}</summary>
                    <div className="panel-caveat" style={{ marginTop: 6 }}
                      title={t.appView.theBackendHasNoOutboundNetworkLibrariesTip}>
                      <b>{t.appView.boardFilesStayOnThisComputer}</b>{t.appView.parsingAndSolvingRunLocallyTheBackend}{storageInfo ? (
                        <>
                          <div style={{ marginTop: 6 }}>{viewField(storageInfo, 'board_outputs')}</div>
                          <div style={{ marginTop: 6 }}>{t.appView.theToolWritesTo}</div>
                          {storageInfo.locations.map(loc => (
                            <div key={loc.path} style={{ marginTop: 5 }}>
                              <div>
                                {viewField(loc, 'label')}
                                {!loc.exists && <span>{t.appView.notCreatedYet}</span>}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <code style={{ flex: 1, wordBreak: 'break-all', fontSize: 10 }}>
                                  {loc.path}
                                </code>
                                {loc.exists && (
                                  <button className="btn" style={{ fontSize: 10, padding: '0 6px' }}
                                    onClick={() => void revealInExplorer(loc.path)}>{t.appView.open}</button>
                                )}
                              </div>
                              <div style={{ opacity: 0.85 }}>{viewField(loc, 'note')}</div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div style={{ marginTop: 6 }}>{t.appView.readingActualPaths}</div>
                      )}
                    </div>
                  </details>
                </div>

                {/* 「選擇網路」：網路選擇 */}
                {/* 這一段的下限要涵蓋兩個網路清單，否則清單會溢出到下面的
                    「裁切設定」上。原本寫死 220 px，比清單本身還矮。 */}
                <div hidden={!(show.load)} style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  // 展開 DDR 分類結果時要把它的高度算進來。這一層是 overflow: visible，
                  // 不加的話網路清單會直接掛到外面，蓋住下方的「裁切設定」。
                  minHeight: NETLIST_MIN_HEIGHT + NETS_HEADER_HEIGHT
                    + (ddrResult ? DDR_PANEL_MAX_HEIGHT + 12 : 0),
                }}>
                  <h3 className="panel-title">{t.appView.selectNets}</h3>
                  <p className="panel-hint">{t.appView.doubleClickTheLeftListOrClick}</p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label={t.appView.signalNetListFile} ref={signalFileRef} type="file" accept=".txt,text/plain" hidden
                      onChange={handleImportSignalFile} />
                    <button className="btn" style={{ flex: 1 }} onClick={() => signalFileRef.current?.click()}
                      disabled={allNets.length === 0}>{t.appView.importNetList}</button>
                    <button className="btn" style={{ flex: 1 }} onClick={handleExportSignalNets}
                      disabled={signalNets.length === 0}>{t.appView.exportNetList}</button>
                  </div>

                  {/* DDR 自動分類。DDR 一組 8～16 條要手選，選錯只有等眼圖出來才知道。 */}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <button className="btn" style={{ flex: 1 }} onClick={handleClassifyNets}
                      disabled={allNets.length === 0 || ddrBusy}>
                      {ddrBusy ? t.appView.classifying : t.appView.classifyDdrNets}
                    </button>
                    {ddrResult && (
                      <button className="btn" style={{ flex: 1 }}
                        onClick={() => { setDdrResult(null); setDdrRoles([]) }}>{t.appView.hideResults}</button>
                    )}
                  </div>

                  {ddrResult && (
                    <div style={{
                      marginTop: 6, padding: '8px 10px', borderRadius: 6,
                      background: 'rgba(0,0,0,.04)', fontSize: 12, lineHeight: 1.7,
                      // 上限＋自己捲動：角色多的板子不會把這一塊撐到無限高，
                      // 外層才能用一個固定的數字保留空間。
                      maxHeight: DDR_PANEL_MAX_HEIGHT, overflowY: 'auto',
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.appView.selectRolesToAddToTheSignal}</div>
                      {Object.keys(ddrResult.counts || {})
                        .filter(role => role !== 'OTHER')
                        .map(role => (
                          <label key={role} style={{
                            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                          }}>
                            <input type="checkbox" checked={ddrRoles.includes(role)}
                              onChange={e => setDdrRoles(prev => e.target.checked
                                ? [...prev, role]
                                : prev.filter(r => r !== role))} />
                            <span>{lang === 'en' ? ddrResult.labels_en?.[role] || role : ddrResult.labels?.[role] || role}</span>
                            <span style={{ opacity: .6 }}>{t.appView.netCount(ddrResult.counts[role])}</span>
                          </label>
                        ))}

                      {(ddrResult.lanes || []).length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.appView.orSelectAByteLane}</div>
                          {(ddrResult.lanes || []).map((l: any) => {
                            const total = (l.data?.length || 0) + (l.mask?.length || 0)
                              + (l.strobe_p?.length || 0) + (l.strobe_n?.length || 0)
                            return (
                              <button key={l.lane} className="btn"
                                style={{ width: '100%', marginBottom: 4, textAlign: 'left' }}
                                onClick={() => applyDdrLane(l)}
                                title={t.appView.joinList([...(l.data || []), ...(l.mask || []),
                                        ...(l.strobe_p || []), ...(l.strobe_n || [])])}>{t.appView.byteNets(l.lane, total, l.has_strobe ? t.appView.withStrobe : t.appView.noStrobe)}</button>
                            )
                          })}
                        </div>
                      )}

                      {/* 沒有選通參考的組不能當位元組通道分析——組內資料訊號的
                          眼圖沒有共同的時間基準。這一定要講出來。 */}
                      {(ddrResult.lanes || []).some((l: any) => !l.has_strobe) && (
                        <div style={{ marginTop: 4, color: '#b45309' }}>{t.appView.aByteLaneWithoutAStrobeReference}</div>
                      )}

                      {(ddrResult.ambiguous || []).length > 0 && (
                        <div style={{ marginTop: 4, color: '#b45309' }}>{t.appView.netsMatchMultipleRolesCheckManually(ddrResult.ambiguous.length, t.appView.joinList(ddrResult.ambiguous.slice(0, 5).map((r: any) => r.net)), ddrResult.ambiguous.length > 5 ? ' …' : '')}</div>
                      )}

                      <div style={{ marginTop: 4, opacity: .7 }}>{t.appView.netsHaveNoIdentifiedRoleIncludingPower((ddrResult.unmatched || []).length)}</div>

                      <button className="btn--primary" style={{ marginTop: 8, width: '100%' }}
                        onClick={applyDdrRoles} disabled={ddrRoles.length === 0}>{t.appView.addSignalNets}</button>
                    </div>
                  )}
                  <input aria-label={t.appView.netNameFilter}
                    type="text"
                    className="input"
                    placeholder={t.appView.filter}
                    value={filterText}
                    onChange={e => setFilterText(e.target.value)}
                    style={{ margin: '6px 0' }}
                  />
                  <div style={{
                    display: 'flex', gap: 8, flex: 1,
                    minHeight: NETLIST_MIN_HEIGHT,
                  }}>
                    {/* 可選網路 */}
                    <div className="netlist" style={{ flex: 1 }}>
                      {/* 三個框只有這個沒有標題，空的時候就是一塊純白，看不出
                          它在等什麼。左右兩邊都標出來，一眼就知道是「從左邊挑
                          到右邊」。 */}
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', padding: '2px 6px' }}>{t.appView.availableNets(availableFiltered.length)}</div>
                      {availableFiltered.length === 0 && (
                        <div className="empty-hint" style={{ padding: '10px 8px', fontSize: 11.5, lineHeight: 1.6 }}>
                          {allNets.length === 0 ? t.appView.loadABoardToListItsNets : t.appView.noNetsMatchTheFilter}
                        </div>
                      )}
                      {availableFiltered.map(net => (
                        <div key={net} className="netlist__row" onDoubleClick={() => addSignal(net)}>
                          <span className="netlist__name" title={net}>{net}</span>
                          <button className="btn--mini" title={t.appView.addSignalNets} onClick={() => addSignal(net)}>{t.appView.s}</button>
                          <button className="btn--mini" title={t.appView.addReferenceNetsTip} onClick={() => addRef(net)}>{t.appView.r}</button>
                        </div>
                      ))}
                    </div>
                    {/* 已選：訊號 + 參考 */}
                    <div style={{
                      flex: 1, display: 'flex', flexDirection: 'column', gap: 6,
                      minHeight: NETLIST_MIN_HEIGHT,
                    }}>
                      <div className="netlist"
                        style={{ flex: 3, minHeight: NETLIST_SIGNAL_MIN_HEIGHT }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', padding: '2px 6px' }}>{t.appView.signalNets(signalNets.length)}</div>
                        {signalNets.map(net => (
                          <div key={net} className="netlist__row netlist__row--sig" onDoubleClick={() => removeSignal(net)} title={t.appView.doubleClickToRemoveTip}>
                            <span className="netlist__name">{net}</span>
                          </div>
                        ))}
                      </div>
                      <div className="netlist"
                        style={{ flex: 2, minHeight: NETLIST_REFERENCE_MIN_HEIGHT }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ok)', padding: '2px 6px',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{t.appView.referenceNets(refNets.length)}</span>
                          <button className="btn" style={{ fontSize: 10.5, padding: '1px 6px' }}
                            onClick={suggestRefsByCopper}
                            title={t.appView.rankByPlaneCopperAreaReturnPathsTip}>{t.appView.suggestByCopperArea}</button>
                        </div>
                        {refSuggestions && (
                          <div style={{ padding: '2px 6px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {refSuggestions.length === 0 && (
                              <span style={{ fontSize: 11, opacity: 0.7 }}>{t.appView.cannotReadPlaneCopperArea}</span>
                            )}
                            {refSuggestions.map(item => (
                              <button key={item.net} className="btn"
                                style={{ fontSize: 10.5, padding: '1px 6px',
                                  opacity: refNets.includes(item.net) ? 0.45 : 1 }}
                                disabled={refNets.includes(item.net)}
                                onClick={() => addRef(item.net)}
                                title={t.appView.planeCopperCmPolygonsClickToAddTip(item.area_cm2, item.polygons)}>{t.appView.netCopperArea(item.net, item.area_cm2)}</button>
                            ))}
                          </div>
                        )}
                        {refNets.map(net => (
                          <div key={net} className="netlist__row netlist__row--ref" onDoubleClick={() => removeRef(net)} title={t.appView.doubleClickToRemoveTip}>
                            <span className="netlist__name">{net}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 「裁切設定」：裁切設定（直接分段模式不需要） */}
                <div hidden={!(show.cutout)} style={directSegmentMode ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <h3 className="panel-title">{t.appView.cutoutSettings}</h3>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">{t.appView.expansionMm}</div>
                      <LengthInput aria-label={t.appView.expansionMm} className="input"
                        value={expansionMm} onValue={setExpansionMm} fieldKey="expansionMm" source="mm" min={0} step={0.5} showStepper />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">{t.appView.extentShape}</div>
                      <select aria-label={t.appView.extentShape} className="input" value={extentType} onChange={e => {
                        setExtentType(e.target.value)
                        setActualCutoutExtentType('')
                      }}>
                        <option value="Conforming">{t.appView.conforming}</option>
                        <option value="ConvexHull">{t.appView.convexHull}</option>
                        <option value="Bounding">{t.appView.boundingBox}</option>
                      </select>
                    </div>
                  </div>
                  <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>
                    {actualCutoutExtentType
                      ? t.appView.lastActualCutoutShape(EXTENT_LABEL[actualCutoutExtentType] || actualCutoutExtentType)
                      : extentType === 'Conforming'
                        ? t.appView.followsTraceBendsExpandingOnlyByThe
                        : extentType === 'ConvexHull'
                          ? t.appView.cutsAcrossTheInsideOfDiagonalOr
                          : t.appView.theMostConservativeAndLargestExtent}
                  </div>
                  {boundaryAreaSaving !== null && extentType === 'Conforming' && (
                    <div className="status" style={{ marginTop: 4, fontSize: 11.5, color: 'var(--accent)' }}>{t.appView.theConformingExtentCoversLessAreaThan(boundaryAreaSaving.toFixed(1))}</div>
                  )}
                  <button
                    className="btn"
                    style={{ width: '100%', marginTop: 7 }}
                    onClick={handlePreciseBoundaryPreview}
                    disabled={!fullScene || signalNets.length === 0 || refNets.length === 0 || isLoading}
                    title={t.appView.readOnlyPreviewUsingTheSamePyedbTip}>{t.appView.previewExactExtent}</button>
                  <div className="status" style={{ marginTop: 5, fontSize: 11.5 }}>
                    {preciseBoundaryPreview
                      && preciseBoundaryPreviewKey === cutoutBoundaryKey(signalNets, refNets, expansionMm, extentType)
                      ? t.appView.exactPyedbExtentPreviewShownPoints(preciseBoundaryPreview.length)
                      : t.appView.clickAboveToShowTheExtentUsing}
                  </div>
                </div>

                {/* 「執行裁切」：輸出與執行（直接分段模式不需要） */}
                <div hidden={!(show.cutout)} style={directSegmentMode ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <h3 className="panel-title">{t.appView.runCutout}</h3>
                  <p className="panel-hint">{t.appView.extractsTheChannelOnlyCreatePortsAfter}</p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label={t.appView.cutoutOutputPath}
                      type="text"
                      className="input"
                      value={outputPath}
                      onChange={e => setOutputPath(e.target.value)}
                      placeholder={t.appView.outputPath}
                    />
                    <button className="btn" onClick={handleBrowseOutput}>{t.appView.browse}</button>
                  </div>
                  <button
                    className="btn--primary"
                    onClick={handleCutout}
                    disabled={isLoading || signalNets.length === 0 || refNets.length === 0}
                    style={{ marginTop: 6 }}
                  >{t.appView.runCutout}</button>
                </div>

                {/* 「疊構更換」：疊構更換 */}
                <div hidden={!(show.stackup)} style={{ opacity: boardLoaded ? 1 : 0.5, pointerEvents: boardLoaded ? undefined : 'none' }}>
                  <h3 className="panel-title">{t.appView.replaceStackup}<BetaBadge feature="B05" /></h3>
                  <p className="panel-hint">{t.appView.supportsXmlCsvJson}<b>{t.appView.reviewChangesBeforeApplying}</b>{t.appView.alwaysSavesANewFile}</p>
                  <p className="panel-hint">
                    <b>{t.appView.runAfterCutoutBeforeBackdrillAndPort}</b>
                  </p>

                  <div className="field-label" style={{ marginTop: 6 }}>{t.appView.stackupFile}</div>
                  <div className="field-row">
                    <input aria-label={t.appView.stackupFile} type="text" className="input" value={stackupFilePath}
                      onChange={e => { setStackupFilePath(e.target.value); invalidateStackupDiff() }}
                      placeholder={t.appView.stackupFilePathXmlCsvJson} />
                    <button className="btn" onClick={handleBrowseStackup}>{t.appView.browse}</button>
                  </div>
                  <button className="btn--primary" style={{ width: '100%', marginTop: 6 }}
                    onClick={handleStackupAnalyze} disabled={!stackupFilePath}>{t.appView.compareStackups}</button>

                  {/* 匯出是選用的輔助功能，不是流程的第一步——手上已經有疊構檔
                      （例如來自其他工具）時完全不需要先匯出。
                      全站的操作按鈕都不加步驟編號：按鈕本來就照順序排，後續動作
                      也要前一步完成才會出現或啟用，編號沒有多給資訊，反而讓人以為
                      自己漏了某個步驟、或誤以為選用步驟是必經的。 */}
                  <div className="field-row" style={{ marginTop: 8 }}>
                    <span className="panel-hint" style={{ flex: 1, margin: 0 }}>{t.appView.noFileAvailableExportTheCurrentStackup}</span>
                    <select aria-label={t.appView.stackupTemplateExportFormat} className="input" style={{ width: 76 }} value={stackupExportFormat}
                      onChange={e => setStackupExportFormat(e.target.value as 'xml' | 'csv' | 'json')}>
                      <option value="xml">{t.appView.fieldXml}</option>
                      <option value="csv">{t.appView.fieldCsv}</option>
                      <option value="json">{t.appView.fieldJson}</option>
                    </select>
                    <button className="btn" onClick={handleStackupExport}>{t.appView.export}</button>
                  </div>

                  <PortWarning warning={stackupDiff?.port_warning} />
                  {stackupDiff && (
                    <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>
                      {stackupDiff.comparable === false ? (
                        <span style={{ color: '#ffb347' }}>{viewField(stackupDiff, 'reason')}</span>
                      ) : (
                        <>
                          <div>{t.appView.conductorLayersRenamedDielectricsRebuiltAddedChanged(stackupDiff.signal_layer_count, stackupDiff.incoming_signal_layer_count, stackupDiff.renames?.length || 0, stackupDiff.dielectric_rebuilt ?? 0, stackupDiff.added.length, stackupDiff.changed.length, stackupDiff.material_changes.length)}</div>
                          <div style={{ marginTop: 3, opacity: 0.8 }}>{t.appView.conductorLayersAreRenamedInOrderWith}</div>
                          {stackupDiff.signal_count_matches === false && (
                            <div style={{ marginTop: 4, color: '#ff6b6b', fontWeight: 650 }}>{t.appView.pyedbRefusesToApplyAStackupWith}</div>
                          )}
                          {stackupDiff.renames?.length > 0 && (
                            <div style={{ marginTop: 5 }}>
                              <div style={{ fontWeight: 650 }}>{t.appView.conductorLayersRenamedInOrderCopperPreserved}</div>
                              <div style={{ marginTop: 3, maxHeight: 132, overflowY: 'auto',
                                            fontFamily: '"Calibri", monospace', fontSize: 11 }}>
                                {stackupDiff.renames.map((item: any) => (
                                  <div key={item.index}>{t.appView.symbol(String(item.index).padStart(2, '0'), item.from)}<b>{item.to}</b>
                                  </div>
                                ))}
                              </div>
                              <div style={{ marginTop: 3, color: '#ffb347' }}>{t.appView.checkThisMappingAnUnexpectedOrderPuts}</div>
                            </div>
                          )}
                          {stackupDiff.removed.length > 0 && (
                            <div style={{ marginTop: 4, color: '#ff6b6b', fontWeight: 650 }}>{t.appView.applyingWillDeleteLayersAndTheirCopper(stackupDiff.removed.length, t.appView.joinList(stackupDiff.removed.slice(0, 8)), stackupDiff.removed.length > 8 ? '…' : '')}</div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {stackupDiff?.requires_confirmation && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6,
                                    marginTop: 6, fontSize: 11.5, cursor: 'pointer' }}>
                      <input type="checkbox" checked={stackupConfirmRemoval}
                        onChange={e => setStackupConfirmRemoval(e.target.checked)} />
                      {stackupDiff.signal_count_matches === false
                        ? t.appView.iUnderstandTheConductorLayerCountDiffers
                        : t.appView.iConfirmDeletionOfTheLayersListed}
                    </label>
                  )}

                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label={t.appView.stackupReplacementOutputPath} type="text" className="input" value={stackupOutputPath}
                      onChange={e => setStackupOutputPath(e.target.value)}
                      placeholder={t.appView.outputPathEGXxxStackupAedb} />
                    <button className="btn" onClick={async () => {
                      try {
                        const data = await api('/api/browse_output')
                        if (data.path) setStackupOutputPath(data.path)
                      } catch (e) { reportBrowseFailure(t.appView.outputPath138, e) }
                    }}>{t.appView.browse}</button>
                  </div>
                  <button className="btn--primary" style={{ width: '100%', marginTop: 6 }}
                    onClick={handleStackupApply}
                    disabled={!stackupDiff || stackupDiff.comparable === false
                      || (stackupDiff.requires_confirmation && !stackupConfirmRemoval)}>{t.appView.applyAndSaveAs}</button>
                </div>

                {/* 「背鑽」：背鑽 */}
                <div hidden={!(show.backdrill)} style={{ opacity: canSegment ? 1 : 0.5, pointerEvents: canSegment ? undefined : 'none' }}>
                  <h3 className="panel-title">{t.appView.backdrill}<BetaBadge feature="B06" /></h3>
                  <p className="panel-hint">{t.appView.deriveTheConnectedLayersAndDrillSide}</p>

                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <div className="field-label" style={{ minWidth: 66 }}>{t.appView.retainedStub}</div>
                    <LengthInput aria-label={t.appView.retainedStub} className="input" style={{ width: 70 }}
                      value={bdTargetStubMil} onValue={setBdTargetStubMil} fieldKey="bdTargetStubMil" source="mil" min={0} step={0.5} />
                    <span className="panel-hint" style={{ margin: 0, fontSize: 11 }}>{unit}</span>
                    <label className="field-label" style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                      title={t.appView.uncheckedDrillDiameterViaHoleCheckedViaTip}>
                      <input aria-label={t.appView.increaseDrillDiameter} type="checkbox" checked={bdDrillOversize}
                        onChange={e => setBdDrillOversize(e.target.checked)} />{t.appView.increaseDrillDiameter}</label>
                    <LengthInput aria-label={t.appView.drillDiameterIncrement} className="input" style={{ width: 70 }}
                      value={bdDiameterIncMil} onValue={setBdDiameterIncMil}
                      disabled={!bdDrillOversize} fieldKey="bdDiameterIncMil" source="mil" min={0} step={1} />
                    <span className="panel-hint" style={{ margin: 0, fontSize: 11 }}>{unit}</span>
                  </div>
                  <p className="panel-hint" style={{ marginTop: 2 }}>{t.appView.drillDiameter(bdDrillOversize ? t.appView.viaHoleMil(length(Number(bdDiameterIncMil), 'mil')) : t.appView.sameAsViaHole)}</p>
                  {backdrillStubWarning(bdTargetStubMil, unit) && (
                    <div className="status status--warn" style={{ marginTop: 6, fontSize: 11.5 }}>
                      ⚠ {backdrillStubWarning(bdTargetStubMil, unit)}
                    </div>
                  )}

                  <button className="btn" style={{ width: '100%', marginTop: 6 }}
                    onClick={handleBackdrillAnalyze} disabled={signalNets.length === 0}>{t.appView.analyzeStubs}</button>

                  <PortWarning warning={bdResult?.port_warning} />
                  {bdResult && (
                    <>
                      <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.signalViasBackdrillSectionsResonanceEstimateUses(bdResult.via_count, bdResult.stub_count, bdResult.dielectric_constant?.toFixed(2))}</div>
                      <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 6,
                                    border: '1px solid var(--border)', borderRadius: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead>
                            <tr style={{ color: 'var(--faint)' }}>
                              <th style={{ padding: '3px 5px' }}>{t.appView.drill}</th>
                              <th style={{ padding: '3px 5px', textAlign: 'left' }}>{t.appView.fieldNet}</th>
                              <th style={{ padding: '3px 5px' }}>{t.appView.connectedLayers}</th>
                              <th style={{ padding: '3px 5px' }}>{t.appView.side}</th>
                              <th style={{ padding: '3px 5px' }}>{t.appView.fieldTo}</th>
                              <th style={{ padding: '3px 5px' }}>{t.appView.stubMm}</th>
                              <th style={{ padding: '3px 5px' }}>{t.appView.resonanceGhz}</th>
                              <th style={{ padding: '3px 5px' }}>{t.appView.existingBackdrillDimensions}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bdResult.entries.map((entry: any, i: number) => (
                              <Fragment key={entry.id}>
                              {(entry.existing_backdrills || []).filter((existing: any) => existing.exists).map((existing: any) => (
                                <tr key={`${entry.id}-existing-${existing.side}`}>
                                  <td style={{ padding: '3px 5px' }}>{t.appView.existingBackdrill}</td>
                                  <td style={{ padding: '3px 5px' }}><span style={BD_NET_STYLE} title={entry.net}>{entry.net}</span></td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>{entry.connected_layers.join(',') || '—'}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>{existing.side === 'top' ? t.appView.top : t.appView.bottom}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>{existing.to_layer || '—'}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'right' }}>{existing.remaining_stub_mm == null ? '—' : length(existing.remaining_stub_mm)}</td>
                                  <td style={{ padding: '3px 5px' }}>—</td>
                                  <td style={{ padding: '3px 5px' }}>
                                    {existing.error ? t.appView.existingBackdrillUnknown : [existing.depth_mm, existing.drill_diameter_mm, existing.remaining_stub_mm].map(value => value == null ? '—' : length(value)).join(' / ')}
                                  </td>
                                </tr>
                              ))}
                              {entry.stubs.length === 0 && !(entry.existing_backdrills || []).some((existing: any) => existing.exists) ? (
                                <tr key={`${entry.id}-none`} style={{ opacity: 0.5 }}>
                                  <td style={{ padding: '3px 5px' }}>—</td>
                                  <td style={{ padding: '3px 5px' }}>
                                    <span style={BD_NET_STYLE} title={entry.net}>{entry.net}</span></td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    {entry.connected_layers.join(',') || '-'}</td>
                                  <td colSpan={5} style={{ padding: '3px 5px' }}>{entry.note}</td>
                                </tr>
                              ) : entry.stubs.map((stub: any, j: number) => (
                                <tr key={`${entry.id}-${j}`}>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    <input aria-label={t.appView.selectStubOf(entry.net, j + 1)} type="checkbox" checked={stub.selected !== false}
                                      onChange={() => toggleBackdrillStub(i, j)} />
                                  </td>
                                  <td style={{ padding: '3px 5px' }}>
                                    <span style={BD_NET_STYLE} title={entry.net}>{entry.net}</span></td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    {entry.connected_layers.join(',')}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    {stub.side === 'top' ? t.appView.top : t.appView.bottom}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>{stub.to_layer}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'right' }}>
                                    {stub.stub_mm == null ? '—' : length(stub.stub_mm)}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'right' }}>
                                    {stub.resonance_ghz ? stub.resonance_ghz.toFixed(1) : '-'}</td>
                                  <td style={{ padding: '3px 5px' }}>{stub.existing_backdrill?.exists ? t.appView.existingBackdrill : '—'}</td>
                                </tr>
                              ))}
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="field-row" style={{ marginTop: 6 }}>
                        <input aria-label={t.appView.backdrillOutputPath} type="text" className="input" value={bdOutputPath}
                          onChange={e => setBdOutputPath(e.target.value)}
                          placeholder={t.appView.outputPathEGXxxBackdrillAedb} />
                      </div>
                      <button className="btn--primary" style={{ width: '100%', marginTop: 6 }}
                        onClick={handleBackdrillApply}>{t.appView.applyBackdrillAndSaveAs}</button>
                    </>
                  )}
                </div>

                {/* 「Layout 清理」：Layout 清理 */}
                <div hidden={!(show.cleanup)} style={{ opacity: canSegment ? 1 : 0.5 }}>
                  <h3 className="panel-title">{t.appView.layoutCleanup}<BetaBadge feature="M09" /></h3>
                  <p className="panel-hint">{t.appView.preservesSignalsReferencePlanesComponentPinsAnd}</p>
                  <div className="field-label" style={{ marginTop: 6 }}>{t.appView.cleanupLevel}</div>
                  <div className="field-row">
                    <select aria-label={t.appView.cleanupLevel} className="input" value={cleanupMode}
                      onChange={e => {
                        const mode = e.target.value as 'conservative' | 'em_field'
                        setCleanupMode(mode)
                        setCleanupGuardMm(mode === 'em_field' ? '0.2' : '2')
                        setCleanupAnalysis(null)
                      }}
                      disabled={!canSegment}>
                      <option value="em_field">{t.appView.levelEmInfluenceRangeDefault}</option>
                      <option value="conservative">{t.appView.levelConservativeFixedDistance}</option>
                    </select>
                    <button className="btn cleanup-recommended-btn"
                      onClick={applyCleanupRecommendedSettings}
                      disabled={!canSegment}
                      title={t.appView.restoreDefaultsLevelMmMinimumProtectionDbTip}>{t.appView.restoreDefaults}</button>
                  </div>
                  {cleanupMode === 'em_field' && (
                    <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.usesHeightHFromEachSignalLayer}</div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'flex-end' }}>
                    <div style={{ width: 110 }}>
                      <div className="field-label">{cleanupMode === 'em_field' ? t.appView.minimumProtectionMm : t.appView.protectionDistanceMm}</div>
                      <LengthInput aria-label={cleanupMode === 'em_field' ? t.appView.minimumProtectionMm : t.appView.protectionDistanceMm} className="input"
                        value={cleanupGuardMm} onValue={value => { setCleanupGuardMm(value); setCleanupAnalysis(null) }}
                        disabled={!canSegment} fieldKey="cleanupGuardMm" source="mm" min={0.1} step={0.1} />
                    </div>
                    {cleanupMode === 'em_field' && (
                      <div style={{ width: 105 }}>
                        <div className="field-label">{t.appView.targetIsolationDb}</div>
                        <input aria-label={t.appView.targetIsolationDb} type="number" className="input" min="20" max="80" step="5"
                          value={cleanupIsolationDb} onChange={e => { setCleanupIsolationDb(e.target.value); setCleanupAnalysis(null) }}
                          disabled={!canSegment} />
                      </div>
                    )}
                    <button className="btn" style={{ flex: 1 }} onClick={handleCleanupAnalyze} disabled={!canSegment}>{t.appView.analyzeAndPreview}</button>
                  </div>
                  <PortWarning warning={(cleanupAnalysis as any)?.port_warning} />
                  {cleanupAnalysis && !cleanupAnalysis.deleted && (
                    <div className="status status--warn" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.removalCandidatesCopperTracesVias(cleanupAnalysis.remove_count, cleanupAnalysis.stats.primitive_remove || 0, cleanupAnalysis.stats.via_remove || 0, cleanupAnalysis.overlay.truncated ? t.appView.onlyTheFirstRedBoxesAreShown(cleanupAnalysis.overlay.boxes.length) : '')}</div>
                  )}
                  {cleanupAnalysis?.em_field && !cleanupAnalysis.deleted && (
                    <div className="cleanup-em-rules">
                      <div>{t.appView.emFactorHReferenceLayers(cleanupAnalysis.em_field.field_factor.toFixed(2), t.appView.joinList(cleanupAnalysis.em_field.reference_layers))}</div>
                      {Object.entries(cleanupAnalysis.em_field.layer_rules).map(([layer, rule]) => (
                        <div key={layer}>{t.appView.hMmProtectionRadiusMm(layer, length(rule.reference_height_mm), length(rule.same_layer_radius_mm))}</div>
                      ))}
                    </div>
                  )}
                  {cleanupAnalysis?.mode === 'conservative_fallback' && (
                    <div className="status status--warn" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.insufficientStackupReferenceDataThisAnalysisAutomatically}</div>
                  )}
                  {cleanupAnalysis?.deleted && (
                    <div className="status status--ok" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.cleanupCompleteRemovedCopperTracesViasFailures(cleanupAnalysis.deleted.primitive, cleanupAnalysis.deleted.via, cleanupAnalysis.deleted.failed, cleanupAnalysis.report_path || '')}</div>
                  )}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label={t.appView.layoutCleanupOutputPath} type="text" className="input" value={cleanupOutputPath}
                      onChange={e => setCleanupOutputPath(e.target.value)}
                      placeholder={t.appView.cleanedAedbOutputPath} disabled={!canSegment} />
                  </div>
                  <button className="btn--primary" style={{ marginTop: 6 }}
                    onClick={handleCleanupRun}
                    disabled={!cleanupAnalysis || cleanupAnalysis.remove_count === 0 || !!cleanupAnalysis.deleted}>{t.appView.saveAsAndRun(cleanupMode === 'em_field' ? t.appView.levelCleanup : t.appView.levelCleanup183)}</button>
                </div>

                {/* 「Port 設定」：挑要建 Port 的端點元件與 Port 型別。
                    這裡不再依 directSegmentMode 壓暗——裁切拆出 Port 之後，
                    這一格是「設定 Port 與求解器」唯一的元件來源，壓暗它等於讓
                    checkedComps 永遠是空的，下面那顆按鈕就再也按不下去。 */}
                <div hidden={!show.ports}>
                  <h3 className="panel-title">{t.appView.portSetup}</h3>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">{t.appView.portType}</div>
                      <select aria-label={t.appView.portType} className="input" value={portType} onChange={e => setPortType(e.target.value)}>
                        <option value="auto">{t.appView.autoRecommendedPinGroupForFinePitch}</option>
                        <option value="coax">{t.appView.coax}</option>
                        <option value="circuit">{t.appView.circuit}</option>
                        <option value="pingroup">{t.appView.pinGroupFinePitchBga}</option>
                      </select>
                      {portType === 'auto' && (
                        <div className="status" style={{ marginTop: 4, fontSize: 11.5 }}>{t.appView.aComponentWithOverPinsSelectsPin}</div>
                      )}
                      {/* 座標型負端在 BGA 底下站不住：訊號球正下方就是 antipad。
                          SIwave 的失敗方式是靜默丟掉 Port，不報錯照樣解完。 */}
                      {portType === 'pingroup' && (
                        <div className="hint" style={{ marginTop: 4 }}>{t.appView.negativeTerminalsUseAllReferencePinsOf}</div>
                      )}
                    </div>
                    <div style={{ flex: 1.4 }}>
                      <div className="field-label">{t.appView.portComponents(candidateComps.filter(c => checkedComps[c.name]).length, candidateComps.length)}</div>
                      <div className="field-row" style={{ margin: '4px 0' }}>
                        <button className="btn" style={{ flex: 1, padding: '3px 6px', fontSize: 11.5 }}
                          onClick={selectRecommendedPortComponents} disabled={candidateComps.length === 0}>{t.appView.suggestEndpointsMax}</button>
                        <button className="btn" style={{ padding: '3px 8px', fontSize: 11.5 }}
                          onClick={() => setCheckedComps(Object.fromEntries(candidateComps.map(c => [c.name, false])))}
                          disabled={candidateComps.length === 0}>{t.appView.deselectAll}</button>
                      </div>
                      <div className="netlist" style={{ maxHeight: 110, overflowY: 'auto' }}>
                        {candidateComps.length === 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--faint)', padding: 6 }}>{t.appView.listedAutomaticallyAfterSelectingSignalNets}</div>
                        )}
                        {candidateComps.map(c => (
                          <label key={c.name} className="netlist__row" style={{ cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={!!checkedComps[c.name]}
                              onChange={() => setCheckedComps(prev => ({ ...prev, [c.name]: !prev[c.name] }))}
                            />
                            <span className="netlist__name" title={c.nets.join(', ')}>{t.appView.pins(c.name, c.pin_count)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 「模擬設定」：裁切 Setup 與排程共用；直接分段模式仍可設定求解器 */}
                <div hidden={!showSolverSetup}>
                  <h3 className="panel-title">{t.appView.simulationSettings}</h3>
                  <SimulationSettings lang={lang} text={t.simulationSetup} specName={specName} maxFrequencyGHz={maxFrequencyGHz}
                    specs={builtinProfiles} profiles={profileNames} selectedProfile={selectedProfile}
                    onSpec={name => void chooseSpec(name)} onMaximum={value => {
                      simulationChoiceEpoch.current++; setMaxFrequencyGHz(value)
                    }}
                    onProfile={setSelectedProfile} onApply={() => void applyProfile(selectedProfile)}
                    onSave={() => void saveProfile()} onDelete={() => void deleteProfile(selectedProfile)}
                    message={profileMsg} error={simulationFailure || (!simulationReady
                      ? t.simulationSetup.resolving : '')}
                    summary={simulationReady ? t.simulationSetup.sweepSummary(sweeps) : ''} />

                </div>

                {/* 設定 Port 與求解器：對目前的工作檔建立 Port 與 Setup，不裁切。
                    啟用條件用 canSegment 而不是 directSegmentMode——拆分後
                    「先裁切、再單獨設 Port」也是合法路徑，那時 directSegmentMode
                    是 false，用它當條件會把面板鎖死。 */}
                <div hidden={!(show.ports)} style={canSegment ? undefined : { opacity: 0.4, pointerEvents: 'none' }}>
                  <h3 className="panel-title">{t.appView.portAndSolverSetup}</h3>
                  <p className="panel-hint">
                    <b>{t.appView.skippingThisStepLeavesBothChannelEnds}</b>{t.appView.makingSegmentationAndSolvingIneffectiveAlwaysSaves}</p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label={t.appView.portAndSolverSetupOutputPath}
                      type="text"
                      className="input"
                      value={portsOutputPath}
                      onChange={e => setPortsOutputPath(e.target.value)}
                      placeholder={t.appView.outputPathEGXxxPortsAedb}
                      disabled={!canSegment}
                    />
                  </div>
                  <button
                    className="btn--primary"
                    onClick={handlePortsSetup}
                    disabled={
                      // 條件與外層面板一致用 canSegment。「先裁切、再單獨設 Port」
                      // 是主要路徑，那時 directSegmentMode 是 false——用它當條件
                      // 會讓面板看起來可用、裡面的按鈕卻永遠是灰的。
                      isLoading || !canSegment
                      || signalNets.length === 0
                      || refNets.length === 0
                      || Object.keys(checkedComps).filter(c => checkedComps[c]).length === 0
                    }
                    style={{ marginTop: 6 }}
                  >{t.appView.createPortsAndApplySetup}</button>
                  {portsSetupBlockers.length > 0 && (
                    <div className="hint" style={{ marginTop: 4 }}>{t.appView.cannotCreateYet(t.appView.joinList(portsSetupBlockers))}</div>
                  )}
                </div>

                {/* 「N 段分割」：N 段分割 */}
                <div hidden={!(show.segment)} style={{ opacity: canSegment ? 1 : 0.5 }}>
                  <h3 className="panel-title">{t.appView.nSegmentSplit}</h3>
                  <p className="panel-hint">{t.appView.splitTheCutoutBoardIntoNSegments}{directSegmentMode && <span style={{ color: 'var(--accent)' }}>{t.appView.theLoadedFileIsAlreadyAChannel}</span>}
                  </p>
                  {/* 整區壓暗卻不說原因，使用者只能猜。 */}
                  {!canSegment && allNets.length > 0 && (
                    <div className="hint" style={{ marginTop: 4 }}>{t.appView.segmentBlockedHint}</div>
                  )}
                  {/* 頻寬是掃頻／頻率設定，輸入只在「模擬設定」（：放在這裡讓人誤以為只跟分段有關）。這裡只顯示分段
                      與求解器建議實際讀到的兩個值。 */}
                  <div style={{ marginTop: 7 }} data-testid="segment-bandwidth-readout">
                    <div className="panel-hint">
                      {solverBandwidth.ghz === null
                        ? t.appView.solverBandwidthFromSweepSettingsNone(bandwidthSourceText(solverBandwidth))
                        : t.appView.solverBandwidthFromSweepSettings(solverBandwidth.ghz, bandwidthSourceText(solverBandwidth))}
                    </div>
                    <div className="panel-hint">
                      {targetFmaxGHz ? t.appView.cutCheckUsesSweepLimit(targetFmaxGHz) : t.appView.cutCheckNoSweep}
                    </div>
                    {segmentSolverPlans.length > 0 && segPlanBandwidthGHz !== undefined
                      && segPlanBandwidthGHz !== solverBandwidth.ghz && (
                      <div className="panel-hint" style={{ color: 'var(--warn)' }}>
                        {t.appView.bandwidthChangedSinceSegmentation(
                          segPlanBandwidthGHz === null ? '—' : `${segPlanBandwidthGHz} GHz`,
                          solverBandwidth.ghz === null ? '—' : `${solverBandwidth.ghz} GHz`)}
                        {schedMetaPath && (
                          <button className="btn" style={{ marginLeft: 6 }}
                            onClick={() => void reassessSolverBandwidth()}>{t.appView.reassessSolvers}</button>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '80px 1fr',
                    gap: 8, marginTop: 7, alignItems: 'end',
                  }}>
                    <div>
                      <div className="field-label">{t.appView.segmentCountN}</div>
                      <input aria-label={t.appView.segmentCountN} type="number" className="input" min="2" max="10" step="1"
                        value={nSegments} onChange={e => setNSegments(e.target.value)} disabled={!canSegment} />
                    </div>
                    <div>
                      <div className="field-label">{t.appView.minimumGrade}</div>
                      <select aria-label={t.appView.minimumGrade} className="input" value={segmentQuality}
                        onChange={e => {
                          setSegmentQuality(e.target.value as QualityThreshold)
                          setSegAnalysis(null)
                        }}
                        disabled={!canSegment}>
                        <option value="A">{t.appView.gradeAStrictestFewestCandidates}</option>
                        <option value="B">{t.appView.gradeBOrBetterRecommended}</option>
                        <option value="C">{t.appView.gradeCOrBetterEasierBalanceManual}</option>
                      </select>
                    </div>
                    <button className="btn--primary" style={{ gridColumn: '1 / -1' }}
                      onClick={handleSegmentAnalyze} disabled={!canSegment}>{t.appView.analyzeEqualSplits}</button>
                    <div className="panel-hint" style={{ gridColumn: '1 / -1', marginTop: -2 }}>{t.appView.for}<b>{t.appView.allHfssSolving}</b>{t.appView.similarSegmentSizesWithTheCountSet}</div>
                    <button className="btn--primary" style={{ gridColumn: '1 / -1', marginTop: 4 }}
                      onClick={handleComplexityAnalyze} disabled={!canSegment}>{t.appView.analyzeDComplexity}</button>
                    <div className="panel-hint" style={{ gridColumn: '1 / -1', marginTop: -2 }}>{t.appView.for270}<b>{t.appView.mixedHfssSiwaveSolving}</b>{t.appView.hfssHandlesDStructuresSiwaveHandlesPlanar}</div>
                  </div>
                  <div className="status" style={{ marginTop: 5, fontSize: 11.5 }}>{t.appView.balancesSizesAboveTheSelectedGradeThe}{segmentQuality === 'C' && (
                      <b style={{ color: 'var(--warn, #d79a35)' }}>{t.appView.gradeCRelaxesAngleOrClearanceLimits}</b>
                    )}
                  </div>
                  {complexityAnalysis && (
                    <div className="segment-analysis">
                      <div className="segment-analysis__summary">
                        <strong>{t.appView.splitByDComplexity}</strong>
                        <span>{t.appView.segments(complexityAnalysis.segments.length)}</span>
                      </div>

                      {!complexityAnalysis.feasible && (
                        <strong className="segment-analysis__gate-error">
                          {t.publicUi.noSplit}
                        </strong>
                      )}
                      {complexityAnalysis.corner_crossings.length > 0 && (
                        <strong className="segment-analysis__gate-error">{t.appView.signalsPassNearTwoIntersectingCutsThose(complexityAnalysis.corner_crossings.length)}</strong>
                      )}

                      <div className="segment-analysis__table-wrap">
                        <table className="segment-analysis__table">
                          <thead>
                            <tr>
                              <th>{t.appView.segment}</th><th>{t.appView.solver}</th><th>{t.appView.extent}</th>
                              <th>{t.appView.traces}</th><th>{t.appView.reason}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {complexityAnalysis.segments.map(seg => (
                              <tr key={seg.index}>
                                <td>S{seg.index}</td>
                                <td style={{
                                  color: seg.solver === 'hfss'
                                    ? '#bea0ff' : '#5bf59a', fontWeight: 700,
                                }}>{seg.solver.toUpperCase()}</td>
                                <td>{t.appView.x(length(seg.bounds_mm[0]), length(seg.bounds_mm[2]))} {unit}<br />{t.appView.y(length(seg.bounds_mm[1]), length(seg.bounds_mm[3]))} {unit}</td>
                                <td>{length(seg.signal_length_mm)} {unit}</td>
                                <td style={{ fontSize: 11 }}>{t.publicUi.solverReason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.cuts(t.appView.joinCuts(complexityAnalysis.cuts.map(cut => t.appView.cutDescription(
                          Boolean(cut.manual), cut.direction.toUpperCase(), length(cut.position_mm),
                          cut.quality_grade, length(cut.margin_mm),
                        ))))}</div>
                      <div className="status" style={{ marginTop: 4, fontSize: 11 }}>{t.appView.theMarginHasNotBeenCalibratedBy}</div>
                      <div className="status" style={{ marginTop: 4, fontSize: 11 }}>{t.appView.inThePreviewYouCan}<b>{t.appView.dragCutLinesDirectly}</b>{t.appView.gradesAreReassessedOnReleaseTheCut}</div>

                      {renderStitchRelease(complexityAnalysis, 'complexity')}

                      {/* 單參考切面的提示。這條路有自己的顯示區塊，等分那邊補了
                          這邊沒補的話，走複雜度分段的人照樣看不到。 */}
                      {[...new Set(complexityAnalysis.cuts
                        .map(c => viewField(c, 'stitch_return_path_risk'))
                        .filter((m): m is string => !!m))].map(msg => (
                        <div key={msg} className="status status--warn"
                          style={{ marginTop: 6, fontSize: 11 }}>{t.appView.cuts295(complexityAnalysis.cuts.length, msg)}</div>
                      ))}

                      {(complexityAnalysis.source_cuts ?? complexityAnalysis.cuts).some(cut => cut.manual) && (
                        <button className="btn" style={{ width: '100%', marginTop: 6 }}
                          onClick={handleComplexityAnalyze}>{t.appView.resetAutoCuts}</button>
                      )}

                      {complexityAnalysis.feasible && (
                        <button className="btn--primary" style={{ width: '100%', marginTop: 7 }}
                          onClick={handleComplexityRun} disabled={!segOutputDir}>{t.appView.splitByComplexitySegments(complexityAnalysis.segments.length)}</button>
                      )}
                    </div>
                  )}

                  {segAnalysis && (
                    <div className="segment-analysis">
                      <div className="segment-analysis__summary">
                        <strong>{t.appView.cutPlaneAssessment}</strong>
                        <span>{t.appView.mainDirection(segAnalysis.direction.toUpperCase())}</span>
                        <span>{t.appView.gradeOrBetter(segAnalysis.quality_threshold)}</span>
                        <span>{t.appView.cutPlanes(segAnalysis.cuts.length)}</span>
                      </div>

                      {/* 段長分布：這是「有沒有加速效果」的關鍵，放在最前面。 */}
                      {segAnalysis.threshold_feasible && (
                        <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.segmentLengthsMmMaxMin(t.appView.joinLengths(segAnalysis.segment_lengths_mm.map(v => length(v))))}<b>{t.appView.balanceRatio(segAnalysis.balance_ratio.toFixed(2))}</b>
                          {segAnalysis.balance_ratio <= 1.5 && t.appView.wellBalanced}
                        </div>
                      )}

                      {!segAnalysis.threshold_feasible && (
                        <strong className="segment-analysis__gate-error">{t.appView.noFeasibleCutCombinationAtGrade(segAnalysis.quality_threshold, segAnalysis.threshold_report.some(r => r.feasible)
                            ? t.appView.relaxingToIsFeasible(t.appView.joinList(segAnalysis.threshold_report.filter(r => r.feasible)
                                .map(r => t.appView.grade(r.grade))))
                            : t.appView.gradeCIsAlsoInfeasibleReduceSegment)}</strong>
                      )}

                      {segAnalysis.balance_warning && (
                        <strong className="segment-analysis__gate-error">
                          {viewField(segAnalysis, 'balance_warning')}
                        </strong>
                      )}

                      {!segAnalysis.requested_safe && segAnalysis.threshold_feasible && (
                        <strong className="segment-analysis__gate-error">{t.appView.safetyGateFailedRequestedSegmentsAtMost(segAnalysis.n_segments, segAnalysis.max_safe_segments)}</strong>
                      )}

                      {renderStitchRelease(segAnalysis, 'axis')}

                      {/* 三個門檻的對照，讓「放寬一級值不值得」一眼可判斷。 */}
                      <div className="status" style={{ marginTop: 6, fontSize: 11 }}>{t.appView.gradeComparison}{segAnalysis.threshold_report.map(item => (
                          <span key={item.grade} style={{ marginRight: 10 }}>
                            <b style={{
                              color: item.grade === segAnalysis.quality_threshold
                                ? 'var(--accent)' : undefined,
                            }}>{t.appView.grade(item.grade)}</b>
                            {item.feasible
                              ? t.appView.maxMm(length(item.max_segment_mm!), item.balance_ratio!.toFixed(2))
                              : t.appView.infeasible}
                          </span>
                        ))}
                      </div>
                      <div className="segment-analysis__table-wrap">
                        <table className="segment-analysis__table">
                          <thead>
                            <tr>
                              <th>{t.appView.region}</th>
                              <th>{t.appView.gradeLabel}</th>
                              <th>{t.appView.position}</th>
                              <th>{t.appView.status}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {segAnalysis.cuts.map((c, i) => {
                              const forbidden = !c.valid || c.hard_blocked
                              const warning = !forbidden && (
                                ['C', 'D'].includes(c.quality_grade)
                                || c.risk_hit
                                || c.clearance_ok === false
                              )
                              const stateId = forbidden ? 'blocked' : warning ? 'warning' : 'passed'
                              const state = forbidden ? t.appView.blocked : warning ? t.appView.warning : t.appView.passed
                              return (
                                <tr key={i} className={`segment-analysis__row segment-analysis__row--${stateId}`} >
                                  <td className="segment-analysis__region">S{i + 1}–S{i + 2}</td>
                                  <td>
                                    <span className={`segment-grade segment-grade--${c.quality_grade.toLowerCase()}`}>
                                      {c.quality_grade}
                                    </span>
                                    {c.manual_d_release && (
                                      <span className="segment-analysis__release">
                                        {releaseBadge(c.manual_d_release, {
                                          known: t.appView.stitchReleaseBadge,
                                          unknown: t.appView.stitchReleaseBadgeUnknown,
                                          none: t.appView.stitchReleaseBadgeNone,
                                        })}
                                      </span>
                                    )}
                                  </td>
                                  <td>{t.appView.mm328(segAnalysis.direction.toUpperCase(), length(c.position_mm))}</td>
                                  <td><span className={`segment-state segment-state--${stateId}`}
                                    >{state}</span></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      {/* 單參考切面的提示。誤差隨刀數累加，所以那是整條計畫的
                          性質、不是某一刀的性質——去重後只顯示一次，並帶上刀數。 */}
                      {[...new Set(segAnalysis.cuts
                        .map(c => viewField(c, 'stitch_return_path_risk'))
                        .filter((m): m is string => !!m))].map(msg => (
                        <div key={msg} className="status status--warn"
                          style={{ marginTop: 6, fontSize: 11 }}>{t.appView.cuts295(segAnalysis.cuts.length, msg)}</div>
                      ))}
                    </div>
                  )}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label={t.appView.segmentOutputFolder} type="text" className="input" value={segOutputDir}
                      onChange={e => setSegOutputDir(e.target.value)}
                      placeholder={t.appView.segmentOutputFolder336} disabled={!canSegment} />
                  </div>
                  <button
                    className="btn--primary"
                    onClick={handleSegmentRun}
                    disabled={!segAnalysis || !segAnalysis.requested_safe || segAnalysis.cuts.some(c => c.hard_blocked)}
                    style={{ marginTop: 6 }}
                  >{t.appView.runNSegmentSplit}</button>
                  <button
                    className="btn"
                    onClick={handleSingleSegmentRun}
                    disabled={!canSegment}
                    style={{ marginTop: 6, width: '100%' }}
                    title={t.appView.solveTheEntireChannelAsOneSegmentTip}
                  >{t.appView.solveWholeChannel}</button>
                  <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>{t.appView.noCutPlanePortsAreCreatedAll}</div>
                  {segRun && (
                    <div className="status status--ok" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.createdSegmentsAndCutPlanePortPairs(segRun.segments.length, segRun.cut_pairs.reduce((a, c) => a + c.pairs.length, 0))}</div>
                  )}
                  <p className="panel-caveat">
                    <b>{t.appView.fieldsNearCutPlanesAreApproximatedBy}</b>{t.appView.overallTrendsAreReliablePointValuesNext}</p>
                </div>

                {/* 「排程求解」：排程求解 */}
                <div hidden={!show.schedule}
                  style={{ opacity: (schedMetaPath || segRun) ? 1 : 0.5 }}>
                  <h3 className="panel-title">{t.appView.scheduledSolve345(segmentSolverPlans.length > 0 ? t.appView.mixedSolverRegions : '')}</h3>
                  <p className="panel-hint">{t.appView.solvesSegmentsSequentiallyAndWritesResultsTo}</p>
                  {segmentSolverPlans.length > 0 && (
                    <div className="segment-solver-plan">
                      <div className="segment-solver-plan__toolbar">
                        <strong>{t.appView.mixedSolverRegions347}</strong>
                        <button className="btn" onClick={() => applySegmentSolverPreset('recommended')}>{t.appView.applyAutoSuggestions}</button>
                        <button className="btn" onClick={() => applySegmentSolverPreset('hfss')}>{t.appView.allHfss}</button>
                        <button className="btn" onClick={() => applySegmentSolverPreset('siwave')}>{t.appView.allSiwave}</button>
                      </div>
                      <div className="segment-solver-plan__table-wrap">
                        <table className="segment-solver-plan__table">
                          <thead><tr>
                            <th>{t.appView.region}</th><th>{t.appView.suggested}</th><th>{t.appView.assigned}</th><th>{t.appView.decisionReason}</th><th>{t.appView.failureReason}</th>
                          </tr></thead>
                          <tbody>
                            {segmentSolverPlans.map(plan => (
                              <tr key={plan.index} className={plan.requested_solver !== plan.recommended_solver ? 'is-overridden' : ''}>
                                <td>S{plan.index}</td>
                                <td><span className={`solver-badge solver-badge--${plan.recommended_solver}`}>
                                  {plan.recommended_solver.toUpperCase()}
                                </span></td>
                                <td>
                                  <select aria-label={t.appView.solverForSegment(plan.index)}
                                    className="input segment-solver-plan__select"
                                    value={plan.requested_solver}
                                    disabled={schedStatus?.running}
                                    onChange={event => handleSegmentSolverChange(
                                      plan.index, event.target.value as 'hfss' | 'siwave'
                                    )}
                                  >
                                    <option value="hfss">HFSS</option>
                                    <option value="siwave">SIwave</option>
                                  </select>
                                  {/* ⚠ 問的是「現在選的和建議不一樣嗎」，自己比就好。
                                      後端的 overridden 是「曾經明確指派過」，
                                      拿它當警告依據會讓「手動選了和建議相同的求解器」
                                      也掛上一個沒有意義的警告。 */}
                                  {plan.requested_solver !== plan.recommended_solver
                                    && <span className="segment-solver-plan__warning" title={t.appView.userOverrideOfTheSuggestedSolverTip}>⚠</span>}
                                </td>
                                <td className="segment-solver-plan__reason" >
                                  {/* 手動放行 D 級的切面：分段表一定要標出來。 */}
                                  {plan.manual_d_release?.length ? (
                                    <span style={{ display: 'block', color: 'var(--warn)', fontWeight: 600 }}>
                                      {segmentReleaseNote(plan, {
                                        known: t.appView.stitchReleaseSegment,
                                        unknown: t.appView.stitchReleaseSegmentUnknown,
                                        none: t.appView.stitchReleaseSegmentNone,
                                      })}
                                    </span>
                                  ) : null}
                                  {t.publicUi.solverReason}
                                </td>
                                {hasFailure(plan) ? (
                                  <td className="segment-solver-plan__reason"
                                    title={`${failureText(plan.failure, lang, t.appView.failureNotRecorded)}\n`
                                      + t.appView.failureAt(failureTime(plan.failure, t.appView.failureNotRecorded))}
                                    style={{ color: 'var(--danger)' }}>
                                    {failureText(plan.failure, lang, t.appView.failureNotRecorded)}
                                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)' }}>
                                      {t.appView.failureAt(failureTime(plan.failure, t.appView.failureNotRecorded))}
                                    </span>
                                  </td>
                                ) : <td>—</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <SolverCoresField value={solverCores} onChange={setSolverCores} text={t.solverCores}
                    availableCores={solverResourcePreview?.available_cores}
                    disabled={Boolean(schedStatus?.running)} />
                  {solverResourcePreview && solverCoresValue !== null && (
                    <div className="status" style={{ marginTop: 5, fontSize: 11 }}>{t.solverCores.inUse(
                      (schedStatus?.running || schedStatus?.hpc_fallback) && schedStatus.hfss_cores ? schedStatus.hfss_cores : solverResourcePreview.effective_cores,
                      (schedStatus?.running || schedStatus?.hpc_fallback) && schedStatus.siwave_cores ? schedStatus.siwave_cores : solverResourcePreview.effective_cores, solverResourcePreview.available_cores,
                      solverResourcePreview.memory_limit_gb.toFixed(1), solverResourcePreview.effective_memory_percent)}</div>
                  )}
                  {schedStatus?.hpc_fallback && (
                    <div className="status" style={{ marginTop: 5, fontSize: 11, color: 'var(--warn)' }}>{t.solverCores.fallbackNotice}</div>
                  )}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label={t.appView.segmentsJsonPath} type="text" className="input" value={schedMetaPath}
                      onChange={e => setSchedMetaPath(e.target.value)}
                      onBlur={() => {
                        const path = normalizeUserPath(schedMetaPath)
                        setSchedMetaPath(path)
                        loadSegmentSolverPlan(path, false)
                      }}
                      placeholder={t.appView.segmentsJsonPathFilledAfterSplittingOr} />
                    <button className="btn" onClick={async () => {
                      try {
                        const data = await api('/api/browse_segments_json')
                        if (!data.path) return
                        const path = normalizeUserPath(data.path)
                        setSchedMetaPath(path)
                        loadSegmentSolverPlan(path, false)
                      } catch (e) { alert(t.appView.selectionFailedAlert(viewError(e)), 'error') }
                    }}>{t.appView.browse}</button>
                  </div>
                  {segPlanLoadError != null && (
                    <div role="alert" className="status status--warn" data-testid="schedule-load-error">
                      {t.appFlow.failedToLoadMixedSolverPlan}{errorText(segPlanLoadError, lang)}
                      <button className="btn" disabled={schedStatus?.running}
                        onClick={() => void loadSegmentSolverPlan(schedMetaPath, false)}>{t.appView.retrySourceLoading}</button>
                    </div>
                  )}
                  {/* 分段一次要二十分鐘以上。換個求解器設定、改核心數或重打一次包
                      都不該逼人整段重跑——指向既有的 segments.json 就能直接接上。 */}
                  <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>
                    <b>{t.appView.noNeedToSplitAgain}</b>{t.appView.selectAnExistingSegmentsJsonToSchedule}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button
                      className="btn--primary"
                      style={{ flex: 2 }}
                      onClick={handleScheduleStart}
                      disabled={!schedMetaPath || scheduleBusy || cascadeBusy || circuitBusy}
                      title={scheduleBlock
                        ? t.appView.cachedSegmentsNeedNoLicenseTheBackendTip(scheduleBlock)
                        : undefined}
                    >
                      {schedStartingAt !== null ? schedStartPhase : schedStatus?.running
                        ? t.appView.scheduleRunning(schedStatus.solver === 'mixed' ? t.appView.mixedSolver : schedStatus.solver === 'siwave' ? 'SIwave' : 'HFSS')
                        : segmentSolverPlans.length > 0
                          ? t.appView.startMixedSolve
                          : t.appView.startScheduledSolve}
                    </button>
                    <button
                      className="btn"
                      style={{ flex: 1 }}
                      onClick={handleScheduleStop}
                      disabled={!schedStatus?.running || schedStatus?.stop_requested}
                    >{schedStatus?.running && schedStatus?.stop_requested ? t.appView.stopping : t.appView.stop}</button>
                  </div>
                  {schedStartingAt !== null && (
                    <div className="status" role="status" aria-live="polite">
                      {schedStartPhase} · {formatElapsed(Math.max(0, nowTick - schedStartingAt))}
                    </div>
                  )}
                  <LicenseTag functions={scheduleFunctions} />
                  {schedMetaPath && !schedStatus?.running && (
                    <button
                      className="btn"
                      style={{ width: '100%', marginTop: 6 }}
                      onClick={() => handleRetryTouchstoneExports()}
                      disabled={Boolean(hfssExportBlock)}
                      title={hfssExportBlock || undefined}
                    >{t.appView.retryPendingTouchstoneExportsNoResolve}</button>
                  )}
                  {schedMetaPath && !schedStatus?.running && (
                    <LicenseTag functions={['hfss3dlayout_export']} />
                  )}
                  {show.remotepack && schedMetaPath && !schedStatus?.running && (
                    <div style={{ marginTop: 8, paddingTop: 8,
                                  borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="field-label">{t.appView.remoteSolvePackageNoPythonNeededOn}<BetaBadge feature="B07" /></div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <input aria-label={t.appView.remoteSolvePackageOutputFolder} className="input" style={{ flex: 1 }} value={packDir}
                          onChange={e => setPackDir(e.target.value)}
                          placeholder={t.appView.outputFolderMustBeNewEG} />
                        <button className="btn" onClick={handleBuildRemotePack}
                          disabled={packBusy}>
                          {packBusy ? t.appView.packaging : t.appView.exportSolvePackage}
                        </button>
                      </div>
                      <div className="panel-hint" style={{ marginTop: 4, fontSize: 11 }}>{t.appView.copyToTheSolvePcRunRun}</div>
                      <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>{t.appView.theCoreCountAppliesToBothSolver}<b style={{ color: 'var(--warn)' }}>{t.appView.hfssNeedsAnAnshpcLicenseAboveCores}</b></div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <input aria-label={t.appView.solvedResultsFolder} className="input" style={{ flex: 1 }} value={ingestDir}
                          onChange={e => setIngestDir(e.target.value)}
                          placeholder={t.appView.solvedFolderPackageFolderOrItsResults} />
                        <button className="btn" onClick={handleIngestResults}
                          disabled={ingestBusy}>
                          {ingestBusy ? t.appView.importing : t.appView.importResults}
                        </button>
                      </div>
                      <div className="panel-hint" style={{ marginTop: 4, fontSize: 11 }}>{t.appView.validatesPortCountAndFormatBeforeWriting}</div>
                    </div>
                  )}
                  {schedStatus && schedStatus.jobs?.length > 0 && (
                    <div className="netlist" style={{ marginTop: 6, maxHeight: 130, overflowY: 'auto' }}>
                      {schedStatus.jobs.map((j: any) => {
                        const labels: Record<string, [string, string]> = {
                          pending: [t.appView.waiting, 'var(--faint)'],
                          running: [t.appView.solving, 'var(--accent)'],
                          solved_pending_export: [t.appView.pendingExport, 'var(--warn)'],
                          done: [t.appView.done, 'var(--ok)'],
                          failed: [t.appView.failed, 'var(--danger)'],
                          stopped: [t.appView.stopped, 'var(--warn)'],
                          skipped: [t.appView.skipped, 'var(--warn)'],
                        }
                        const [txt, color] = labels[j.status] || [j.status, 'var(--muted)']
                        const elapsed = jobElapsedSec(j, nowTick)
                        // 失敗原因與時間：沒有結構化原因時退回原本的錯誤文字。
                        const failed = hasFailure(j) && j.status !== 'running'
                        const reason = j.failure
                          ? t.appView.failureWithTime(failureText(j.failure, lang, t.appView.failureNotRecorded), failureTime(j.failure, t.appView.failureNotRecorded))
                          : (j.error ? safeUserMessage(j, lang) : '')
                        return (
                          <div key={j.index} className="netlist__row" title={(failed ? reason : (j.error ? safeUserMessage(j, lang) : '')) || j.touchstone
                            || (j.status === 'running' ? t.appView.phaseProgress(viewField(j, 'phase'), viewField(j, 'progress_detail')) : '')}>
                            <span style={{ fontWeight: 700, minWidth: 42 }}>{t.appView.segment395(j.index)}</span>
                            <span className={`solver-badge solver-badge--${j.solver || 'hfss'}`}>
                              {(j.solver || 'hfss').toUpperCase()}
                            </span>
                            <span style={{ color, fontWeight: 600, minWidth: 56 }}>{txt}</span>
                            {/* 0 Hz 方法只放短標籤、單行：完整的 dc_note 換成三行把整列
                                撐高，還帶著開發者用語；完整出處留在報告與 provenance。 */}
                            {(() => {
                              const dc = dcNoteLabel(j, t)
                              return dc && <span className="netlist__note" title={dc.tip}>{dc.label}</span>
                            })()}
                            {j.convergence_note && (
                              <span style={{ color: 'var(--warn)', fontWeight: 700, fontSize: 11, cursor: 'help' }}
                                title={viewField(j, 'convergence_note')}>{t.appView.notConverged}</span>
                            )}
                            <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 68 }}>
                              {elapsed !== null ? formatElapsed(elapsed) : ''}
                            </span>
                            {/* 執行中的說明要整句看得到：停止中那句很長，截斷就看不到後面的
                                「SIwave 進度 NN%」（工具視窗預設寬度）。 */}
                            <span className={j.status === 'running' ? 'netlist__name netlist__name--wrap' : 'netlist__name'}
                              style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {j.status === 'done' && j.touchstone ? j.touchstone.split(/[\\/]/).pop()
                                : j.status === 'failed' || j.status === 'stopped' ? reason
                                  : j.status === 'solved_pending_export'
                                    ? (reason || t.appView.solveResultsRetainedExportCanBeRetried)
                                    : j.status === 'running'
                                      ? <>
                                          <span>{solverProgress(j.monitor_data, viewField(j, 'phase') || t.appView.active, t.appView.progressUnavailable).phase}
                                            {j.progress_detail ? t.appView.statusDetail(viewField(j, 'progress_detail')) : ''}
                                          </span>
                                          {(() => {
                                            const retry = monitorRetry(j.monitor_data)
                                            return retry && <span style={{ display: 'block', color: 'var(--warn)' }}>
                                              {t.operationFeedback.monitorRetry(retry.count, retry.seconds)}
                                            </span>
                                          })()}
                                          {j.stall_warning && (
                                            <span style={{ display: 'block', color: 'var(--warn)', fontWeight: 700 }}>{t.appView.noObservableActivityForAboutMinutesThe(Math.max(1, Math.floor((j.stall_seconds || 0) / 60)))}</span>
                                          )}
                                        </>
                                      : ''}
                            </span>
                            {j.status === 'solved_pending_export' && !schedStatus?.running && (
                              <button
                                className="btn"
                                style={{ padding: '2px 7px', fontSize: 10.5 }}
                                onClick={() => handleRetryTouchstoneExports(j.index)}
                                disabled={Boolean(hfssExportBlock)}
                                title={hfssExportBlock || t.appView.opensExistingAedtResultsAndExportsWithoutTip}
                              >{t.appView.retryExport}</button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {/* 畫面字數上限 50（test_ui_text_length）：數值與建議放在「未收斂」的滑鼠提示與報告。 */}
                  {(() => {
                    const unconverged = (schedStatus?.jobs || []).filter((j: any) => j.convergence_note)
                    return unconverged.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 11, color: 'var(--warn)', fontWeight: 700 }}
                        title={unconverged.map((j: any) => t.appView.unconvergedSegmentNote(j.index, viewField(j, 'convergence_note'))).join('\n')}>
                        {t.appView.unconvergedSegments(unconverged.length)}
                      </div>
                    )
                  })()}
                  {/* 分段求解的 Touchstone 寫在各段 .aedb 旁邊，也就是 segments.json 所在的資料夾。 */}
                  {schedStatus && !schedStatus.running && (schedStatus.counts?.done ?? 0) > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <OpenFolderButton path={schedStatus.metadata_path} />
                    </div>
                  )}
                  {/* 每次排程各段的結果與原因；排程開始／結束時自動重讀。 */}
                  <RunHistory kind="segment_schedule" anchorPath={schedMetaPath}
                    refreshToken={schedStatus?.running ? 'running' : 'idle'}
                    title={t.appView.scheduleHistoryTip} />
                  <p className="panel-caveat">
                    <b>{t.appView.siwaveUsesAQuasiStaticApproximation}</b>{t.appView.suitableForScreeningRecheckChannelsRequiringSign}</p>
                </div>

                {/* 「電路串接」：電路串接 */}
                <div hidden={!(show.cascade)}>
                  <h3 className="panel-title">{t.appView.circuitCascade}</h3>
                  <p className="panel-hint">{t.appView.connectsAccordingToThePortMappingTo}</p>
                  {/* 模式切換 */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {([['tool', t.appView.toolSegmentResults], ['external', t.appView.externalSParameterFiles]] as const).filter(([m]) => betaEnabled || m === 'tool').map(([m, label]) => (
                      <button key={m} className="btn" onClick={() => handleCascadeModeChange(m)}
                        disabled={scheduleBusy || circuitBusy || cascadeBusy}
                        style={{
                          flex: 1, fontWeight: cascadeMode === m ? 700 : 400,
                          borderColor: cascadeMode === m ? 'var(--accent)' : undefined,
                          color: cascadeMode === m ? 'var(--accent)' : undefined,
                        }}>{label}</button>
                    ))}
                  </div>

                  {cascadeMode === 'tool' && mixedSolverCascade && (
                    <div className="panel-hint" style={{ marginTop: 6 }}>
                      {t.featureTier.names.B03}<BetaBadge feature="B03" />
                    </div>
                  )}
                  {cascadeMode === 'tool' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, opacity: schedMetaPath ? 1 : 0.5 }}>
                      <button className="btn" style={{ flex: 1 }}
                        onClick={handleCascadePreview} disabled={!schedMetaPath}
                        title={t.appView.readsSegmentsJsonOnlyWiringCanBeTip}>{t.appView.previewWiring}</button>
                      <button
                        className="btn--primary"
                        style={{ flex: 1.4 }}
                        onClick={handleCascadeRun}
                        hidden={!betaEnabled && mixedSolverCascade}
                        disabled={!schedMetaPath || scheduleBusy || cascadeBusy || circuitBusy}
                      >
                        {cascadeBusy ? t.appView.cascading : t.appView.runCircuitCascade}
                      </button>
                    </div>
                  )}

                  {betaEnabled && cascadeMode === 'external' && (
                    <div style={{ marginTop: 6 }}>
                      {/* 檔案清單 */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn" style={{ flex: 1 }} onClick={handleBrowseTouchstone}>{t.appView.addSParameterFiles}</button>
                        <button className="btn" onClick={() => { setExtFiles([]); setExtConns([]); setExtShorts([]) }}
                          disabled={extFiles.length === 0}>{t.appView.clear}</button>
                      </div>
                      {extFiles.length > 0 && (
                        <div className="netlist" style={{ marginTop: 6, maxHeight: 110, overflowY: 'auto' }}>
                          {extFiles.map((f, i) => (
                            <div key={f.path} className="netlist__row" title={f.path}>
                              <span style={{ fontWeight: 700, minWidth: 30 }}>#{i + 1}</span>
                              <span className="netlist__name">{f.name}</span>
                              <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{f.n_ports}p</span>
                              <button className="btn" style={{ fontSize: 10, padding: '0 6px' }}
                                onClick={() => {
                                  setExtFiles(prev => prev.filter((_, k) => k !== i))
                                  setExtConns([]); setExtShorts([])
                                }}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 只有一個檔就沒有線可接——整片板子一次解完的結果就是
                          這種。直接載進檢視器，要看的東西完全一樣。 */}
                      {extFiles.length === 1 && (
                        <>
                          <button className="btn--primary" style={{ width: '100%', marginTop: 6 }}
                            disabled={cascadeBusy || circuitBusy}
                            onClick={() => handleLoadExternalSparam(extFiles[0].path)}>
                            {cascadeBusy ? t.appView.loading : t.appView.viewFileNoWiring}
                          </button>
                          <div className="status" style={{ marginTop: 5, fontSize: 11.5 }}>{t.appView.aSingleFileHasNoSegmentsTo}</div>
                          <div className="status" style={{ marginTop: 4, fontSize: 11 }}>{t.appView.addASecondFileToConnectPorts}</div>
                        </>
                      )}

                      {extFiles.length >= 2 && (
                        <>
                          <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={handleExtSuggest}
                            title={t.appView.automaticallyPairsPortsMatchingTheToolConventionTip}>{t.appView.suggestWiring}</button>

                          {/* 接線表 */}
                          <div className="field-label" style={{ marginTop: 8 }}>{t.appView.connections(extConns.length)}<BetaBadge feature="B04" /></div>
                          {extConns.map((c, i) => (
                            <div key={i} style={{ display: 'flex', gap: 3, marginTop: 3, alignItems: 'center' }}>
                              <select aria-label={t.appView.connectionFileA(i + 1)} className="input" style={{ width: 46, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.a_file}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, a_file: +e.target.value, a_port: extFiles[+e.target.value]?.port_names[0] || '' } : x))}>
                                {extFiles.map((_, fi) => <option key={fi} value={fi}>#{fi + 1}</option>)}
                              </select>
                              <select aria-label={t.appView.connectionPortA(i + 1)} className="input" style={{ flex: 1, minWidth: 0, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.a_port}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, a_port: e.target.value } : x))}>
                                {(extFiles[c.a_file]?.port_names || []).map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                              <span style={{ fontSize: 10 }}>↔</span>
                              <select aria-label={t.appView.connectionFileB(i + 1)} className="input" style={{ width: 46, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.b_file}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, b_file: +e.target.value, b_port: extFiles[+e.target.value]?.port_names[0] || '' } : x))}>
                                {extFiles.map((_, fi) => <option key={fi} value={fi}>#{fi + 1}</option>)}
                              </select>
                              <select aria-label={t.appView.connectionPortB(i + 1)} className="input" style={{ flex: 1, minWidth: 0, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.b_port}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, b_port: e.target.value } : x))}>
                                {(extFiles[c.b_file]?.port_names || []).map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                              <button className="btn" style={{ fontSize: 10, padding: '0 6px' }}
                                onClick={() => setExtConns(prev => prev.filter((_, k) => k !== i))}>✕</button>
                            </div>
                          ))}
                          <button className="btn" style={{ width: '100%', marginTop: 3, fontSize: 11 }}
                            onClick={() => setExtConns(prev => [...prev, {
                              a_file: 0, a_port: extFiles[0]?.port_names[0] || '',
                              b_file: Math.min(1, extFiles.length - 1),
                              b_port: extFiles[Math.min(1, extFiles.length - 1)]?.port_names[0] || '',
                            }])}>{t.appView.addConnection}</button>

                          {/* 短路群組表（stripline T/B）*/}
                          <div className="field-label" style={{ marginTop: 8 }}>{t.appView.shortGroupsCombineTwoPortsInThe(extShorts.length)}</div>
                          {extShorts.map((s, i) => (
                            <div key={i} style={{ display: 'flex', gap: 3, marginTop: 3, alignItems: 'center' }}>
                              <select aria-label={t.appView.shortGroupFile(i + 1)} className="input" style={{ width: 46, padding: '2px 3px', fontSize: 10.5 }}
                                value={s.file}
                                onChange={e => {
                                  const fi = +e.target.value
                                  const pn = extFiles[fi]?.port_names || []
                                  setExtShorts(prev => prev.map((x, k) => k === i ? { file: fi, ports: [pn[0] || '', pn[1] || pn[0] || ''] } : x))
                                }}>
                                {extFiles.map((_, fi) => <option key={fi} value={fi}>#{fi + 1}</option>)}
                              </select>
                              {[0, 1].map(pi => (
                                <select aria-label={t.appView.shortGroupPort(i + 1, pi + 1)} key={pi} className="input" style={{ flex: 1, minWidth: 0, padding: '2px 3px', fontSize: 10.5 }}
                                  value={s.ports[pi] || ''}
                                  onChange={e => setExtShorts(prev => prev.map((x, k) => {
                                    if (k !== i) return x
                                    const ports = [...x.ports]; ports[pi] = e.target.value
                                    return { ...x, ports }
                                  }))}>
                                  {(extFiles[s.file]?.port_names || []).map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                              ))}
                              <button className="btn" style={{ fontSize: 10, padding: '0 6px' }}
                                onClick={() => setExtShorts(prev => prev.filter((_, k) => k !== i))}>✕</button>
                            </div>
                          ))}
                          <button className="btn" style={{ width: '100%', marginTop: 3, fontSize: 11 }}
                            onClick={() => setExtShorts(prev => [...prev, {
                              file: 0,
                              ports: [extFiles[0]?.port_names[0] || '', extFiles[0]?.port_names[1] || ''],
                            }])}>{t.appView.addShortGroup}</button>

                          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            <button className="btn" style={{ flex: 1 }} onClick={handleExtPreview}>{t.appView.previewWiring}</button>
                            <button className="btn--primary" style={{ flex: 1.4 }}
                              onClick={handleExtRun}
                              disabled={scheduleBusy || cascadeBusy || circuitBusy || extConns.length === 0}>
                              {cascadeBusy ? t.appView.cascading : t.appView.runCascade}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {cascadeResult && (
                    <>
                      <div className="status status--ok" style={{ marginTop: 6, fontSize: 11.5 }}>{t.appView.donePortsGhzPointsMaxS(cascadeResult.n_ports, cascadeResult.freq_min_ghz?.toFixed(2), cascadeResult.freq_max_ghz?.toFixed(2), cascadeResult.freq_points, formatMaxS(cascadeResult.max_s_magnitude))}<div style={{ wordBreak: 'break-all', color: 'var(--muted)', marginTop: 2 }}>
                          {cascadeResult.output_path}
                        </div>
                        {cascadeResult.summary_path && (
                          <div style={{ wordBreak: 'break-all', color: 'var(--faint)', marginTop: 2 }}>{t.appView.jsonSummary(cascadeResult.summary_path)}</div>
                        )}
                      </div>
                      {/* 證據徽章：這份 S 參數是誰、用什麼設定解出來的。
                          後端的判定早就有了，這是它第一個對使用者的出口。 */}
                      <EvidenceBadges path={cascadeResult.output_path}
                        expectedPorts={cascadeResult.n_ports} />
                      <div style={{ marginTop: 6 }}>
                        <OpenFolderButton path={cascadeIsToolOutput ? cascadeResult.output_path : ''} />
                      </div>
                      {cascadeMode === 'tool' && (
                        <button className="btn" onClick={handleCascadeExportAs}
                          disabled={cascadeBusy}
                          style={{ width: '100%', marginTop: 6 }}>{t.appView.saveFullTouchstone}</button>
                      )}
                      {/* 舊版串接後 QuickEye 設定保留在程式中供既有工作狀態相容，
                          但 UI 永久隱藏；新工作一律由右側「IBIS 模型與眼圖分析」執行。 */}
                      <div hidden style={{
                        marginTop: 8, padding: 8, border: '1px solid var(--border)',
                        borderRadius: 7, background: 'rgba(40, 70, 110, 0.08)',
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{t.appView.eyeDiagramQuickeye}</div>
                        <div className="panel-hint" style={{ marginTop: 3 }}>{t.appView.solvesTheCascadeResultAboveInThe}</div>
                        <details style={{ marginTop: 6 }}>
                          <summary className="panel-hint" style={{ cursor: 'pointer' }}>{t.appView.advancedExportCircuitProjectNoSolve}</summary>
                          <div className="field-row" style={{ marginTop: 6 }}>
                            <div style={{ flex: 1 }}>
                              <div className="field-label">{t.appView.circuitFormat}</div>
                              <select aria-label={t.appView.circuitFormat} className="input" value={circuitExportMode}
                                onChange={event => setCircuitExportMode(event.target.value as 'complete' | 'segments')}>
                                <option value="complete">{t.appView.fullChannelAsOneComponent}</option>
                                <option value="segments" disabled={cascadeMode !== 'tool'}>{t.appView.keepNSegmentWiring}</option>
                              </select>
                            </div>
                            <button className="btn" onClick={handleCircuitExport}
                              disabled={circuitBusy || cascadeBusy
                                || Boolean(licenseBlock(licenseStatus, ['circuit_export']))}
                              title={licenseBlock(licenseStatus, ['circuit_export']) || undefined}
                              style={{ flex: 1 }}>
                              {circuitBusy ? t.appView.processingCircuit : t.appView.exportCircuitNoSolve}
                            </button>
                          </div>
                          <LicenseTag functions={['circuit_export']} />
                        </details>
                        {eyeSuggestion && (
                          <>
                            <div className={`status ${
                              eyeSuggestion.quick_eye_supported ? '' : 'status--warn'
                            }`} style={{ marginTop: 6, fontSize: 11 }}>
                              {eyeSuggestion.note}
                            </div>
                            <div className="field-row" style={{ marginTop: 6 }}>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">{t.appView.eyeMode}</div>
                                <select aria-label={t.appView.eyeMode} className="input" value={eyeMode}
                                  onChange={event => setEyeMode(event.target.value as 'single' | 'differential')}>
                                  <option value="single" disabled={cascadeResult.n_ports !== 2}>{t.appView.singleEndedPort}</option>
                                  <option value="differential" disabled={cascadeResult.n_ports !== 4}>{t.appView.differentialPort}</option>
                                </select>
                              </div>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">{t.appView.dataRateGbps}</div>
                                <input aria-label={t.appView.dataRateGbps} className="input" type="number" min="0.001" step="0.1"
                                  value={eyeDataRate}
                                  onChange={event => {
                                    setEyeDataRate(event.target.value)
                                    // Tr／Tf 依速率自動更新；仍可手動覆寫
                                    const auto = riseTimePsFor(Number(event.target.value))
                                    if (auto !== null) setEyeRiseTime(String(auto))
                                  }} />
                              </div>
                              <div style={{ flex: 1 }}
                                title={t.appView.trUiTheTransmitterEdgeTimeTypicallyTip}>
                                <div className="field-label">{t.appView.trTfPs}</div>
                                <input aria-label={t.appView.trTfPs} className="input" type="number" min="0.001" step="0.1"
                                  value={eyeRiseTime} onChange={event => setEyeRiseTime(event.target.value)} />
                              </div>
                            </div>
                            <div className="field-row" style={{ marginTop: 5 }}>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">{t.appView.inputP}</div>
                                <select aria-label={t.appView.inputP} className="input" value={eyeInputP}
                                  onChange={event => setEyeInputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {eyeMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">{t.appView.inputN}</div>
                                  <select aria-label={t.appView.inputN} className="input" value={eyeInputN}
                                    onChange={event => setEyeInputN(event.target.value)}>
                                    {cascadeResult.port_names.map((name: string) =>
                                      <option key={name} value={name}>{name}</option>)}
                                  </select>
                                </div>
                              )}
                              <div style={{ flex: 1 }}>
                                <div className="field-label">{t.appView.outputP}</div>
                                <select aria-label={t.appView.outputP} className="input" value={eyeOutputP}
                                  onChange={event => setEyeOutputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {eyeMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">{t.appView.outputN}</div>
                                  <select aria-label={t.appView.outputN} className="input" value={eyeOutputN}
                                    onChange={event => setEyeOutputN(event.target.value)}>
                                    {cascadeResult.port_names.map((name: string) =>
                                      <option key={name} value={name}>{name}</option>)}
                                  </select>
                                </div>
                              )}
                            </div>
                            <button className="btn btn--primary" style={{ width: '100%', marginTop: 6 }}
                              disabled={circuitBusy || cascadeBusy || !eyeSuggestion.quick_eye_supported
                                || Boolean(licenseBlock(licenseStatus, ['circuit_quickeye']))}
                              title={licenseBlock(licenseStatus, ['circuit_quickeye']) || undefined}
                              onClick={handleQuickEye}>
                              {circuitBusy ? t.appView.solvingEyeBackground : t.appView.runEyeAnalysis}
                            </button>
                            <LicenseTag functions={['circuit_quickeye']} />
                          </>
                        )}
                        {eyeSuggestionError && (
                          <div className="status status--warn" style={{ marginTop: 6, fontSize: 11 }}>
                            {eyeSuggestionError}
                            <button className="btn" style={{ marginLeft: 6, padding: '2px 7px' }}
                              disabled={circuitBusy || cascadeBusy}
                              onClick={() => setEyeSuggestionRevision(value => value + 1)}>{t.appView.refreshSuggestions}</button>
                          </div>
                        )}
                        {circuitError && (
                          <div className="status status--warn"
                            style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>{t.appView.lastCircuitQuickeyeRunFailed(circuitError)}</div>
                        )}
                        {circuitResult && (
                          <div className="status status--ok"
                            style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>{t.appView.symbol459(circuitResult.solved ? t.appView.quickeyeComplete : t.appView.circuitExported, circuitResult.output_path)}{circuitResult.image_path && <div>{t.appView.eyeDiagram(circuitResult.image_path)}</div>}
                            <div style={{ marginTop: 4 }}><OpenFolderButton path={circuitResult.output_path} /></div>
                          </div>
                        )}
                      </div>
                      {/* 面板內原有的 S(A,B) 手動加曲線區塊已移除——「S 參數」
                          分頁的自動曲線（IL/RL/NEXT/FEXT、單端／差動切換）
                          已完整取代它。 */}
                    </>
                  )}
                  <p className="panel-caveat">
                    <b>{t.appView.cascadingAssumesNoElectromagneticCouplingBetweenSegments}</b>{t.appView.thisAssumptionFailsWhenCutsAreToo}</p>
                  <RunHistory kind="cascade" title={t.appView.cascadeHistoryTip} />
                  {/* TDR 面板刻意放在 cascadeResult 條件之外：量測波形匯入
                      只需要板子與示波器 CSV——客戶拿量測檔來的時候，常常
                      根本還沒跑過串接。模擬路的區塊自己再看 tdrSuggestion。 */}
                  <div hidden={!show.tdr} style={{
                        marginTop: 8, padding: 8, border: '1px solid var(--border)',
                        borderRadius: 7, background: 'rgba(110, 40, 70, 0.08)',
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{t.appView.tdrImpedanceLocation}</div>
                        <div className="panel-hint" style={{ marginTop: 3 }}>
                          {cascadeResult
                            ? t.appView.solveTdrFromCascadeResultsAndMap
                            : t.appView.noCascadeYetImportAMeasuredWaveform}
                        </div>
                        <div data-testid="tdr-suggestion-feedback">
                          {tdrSuggestionLoading && <p role="status">{t.appView.tdrSuggestionLoading}</p>}
                          {tdrSuggestionError != null && (
                            <div role="alert" className="status status--warn">
                              {t.appView.tdrSuggestionFailed}{errorText(tdrSuggestionError, lang)}
                              <button className="btn" onClick={() => setTdrSuggestionRevision(n => n + 1)}>
                                {t.appView.retrySourceLoading}
                              </button>
                            </div>
                          )}
                        </div>
                        {tdrSuggestion && (
                          <>
                            <div className={`status ${tdrSuggestion.supported ? '' : 'status--warn'}`}
                              style={{ marginTop: 6, fontSize: 11 }}>{t.appView.bandwidthGhzRiseTimePs(Number(tdrSuggestion.f_max_ghz).toFixed(1), Number(tdrSuggestion.rise_time_ps).toFixed(2), tdrSuggestion.note)}</div>
                            <div className="field-row" style={{ marginTop: 6 }}>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">{t.appView.mode}</div>
                                <select aria-label={t.appView.mode} className="input" value={tdrMode}
                                  onChange={event => setTdrMode(event.target.value as 'single' | 'differential')}>
                                  {/* 單端不限 Port 數：4-Port 檔也常要探單一條線
                                      （其餘 Port 自動 50Ω 端接）。 */}
                                  <option value="single">{t.appView.singleEndedOneTrace}</option>
                                  <option value="differential" disabled={cascadeResult.n_ports < 4}>{t.appView.differentialPNPair}</option>
                                </select>
                              </div>
                              <div style={{ flex: 1 }}
                                title={t.appView.methodBUsesStackupDkVelocityIsTip}>
                                <div className="field-label">{t.appView.permittivityFromStackup}</div>
                                <div className="input" style={{
                                  display: 'flex', alignItems: 'center',
                                  color: tdrDkHint ? undefined : '#8fa1b5',
                                }}>
                                  {tdrDkHint
                                    ? Number(tdrDkHint).toFixed(2)
                                    : t.appView.noBoardLoadedMethodAOnly}
                                </div>
                              </div>
                            </div>
                            <div className="field-row" style={{ marginTop: 5 }}>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">{t.appView.probeInputP}</div>
                                <select aria-label={t.appView.probeInputP} className="input" value={tdrInputP}
                                  onChange={event => setTdrInputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {tdrMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">{t.appView.inputN}</div>
                                  <select aria-label={t.appView.inputN} className="input" value={tdrInputN}
                                    onChange={event => setTdrInputN(event.target.value)}>
                                    {cascadeResult.port_names.map((name: string) =>
                                      <option key={name} value={name}>{name}</option>)}
                                  </select>
                                </div>
                              )}
                              <div style={{ flex: 1 }}>
                                <div className="field-label">{t.appView.farEndP}</div>
                                <select aria-label={t.appView.farEndP} className="input" value={tdrOutputP}
                                  onChange={event => setTdrOutputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {tdrMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">{t.appView.farEndN}</div>
                                  <select aria-label={t.appView.farEndN} className="input" value={tdrOutputN}
                                    onChange={event => setTdrOutputN(event.target.value)}>
                                    {cascadeResult.port_names.map((name: string) =>
                                      <option key={name} value={name}>{name}</option>)}
                                  </select>
                                </div>
                              )}
                            </div>
                            {signalNets.length > 0 && (
                              <div className="field-row" style={{ marginTop: 5 }}>
                                <div style={{ flex: 2 }}>
                                  <div className="field-label">{t.appView.probedSignalNetLayoutMarkers}</div>
                                  <select aria-label={t.appView.probedSignalNetLayoutMarkers} className="input" value={tdrNet}
                                    onChange={event => setTdrNet(event.target.value)}>
                                    {signalNets.map(net =>
                                      <option key={net} value={net}>{net}</option>)}
                                  </select>
                                </div>
                                <label style={{
                                  flex: 1, display: 'flex', alignItems: 'center', gap: 4,
                                  fontSize: 11, cursor: 'pointer', marginTop: 14,
                                }}
                                  title={t.appView.tdrDistanceStartsAtTheProbeEnableTip}>
                                  <input type="checkbox" checked={tdrFlipStart}
                                    onChange={event => setTdrFlipStart(event.target.checked)} />{t.appView.originAtOtherEnd}</label>
                              </div>
                            )}
                            {tdrPath && (
                              <div className="panel-hint" style={{ marginTop: 4 }}>{t.appView.physicalChannelLengthMmOrigin(length(Number(tdrPath.length_mm)), tdrPath.start_mm.map((v: number) => length(v)).join(', '), tdrPath.unchained > 0
                                  ? t.appView.traceSectionsCouldNotBeIncludedIn(tdrPath.unchained) : '')}</div>
                            )}
                            <button className="btn btn--primary" style={{ width: '100%', marginTop: 6 }}
                              disabled={tdrJob?.running || cascadeBusy || !tdrSuggestion.supported
                                || Boolean(licenseBlock(licenseStatus, ['circuit_tdr']))}
                              title={licenseBlock(licenseStatus, ['circuit_tdr']) || undefined}
                              onClick={handleTdrRun}>
                              {tdrJob?.running ? t.appView.solvingTdrBackground : t.appView.runTdr}
                            </button>
                            <LicenseTag functions={['circuit_tdr']} />
                          </>
                        )}
                        {tdrJob?.status === 'error' && (
                          <div className="status status--warn"
                            style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>{t.appView.lastTdrRunFailed(viewField(tdrJob, 'error'))}</div>
                        )}
                        {/* 量測波形匯入（乙路）：不依賴串接結果——客戶拿
                            示波器檔來的時候，常常手上只有板子與波形。 */}
                        <details hidden={!betaEnabled} style={{ marginTop: 8 }}>
                          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{t.appView.importMeasuredWaveformScopeTdr}<BetaBadge feature="B18" /></summary>
                          <div className="panel-hint" style={{ marginTop: 4 }}>{t.appView.twoColumnCsvTimeAndVoltageOr}</div>
                          <div className="panel-hint" style={{ marginTop: 2 }}>{t.appView.t0IsTheBoardLaunchReflectionTime}</div>
                          <div className="panel-hint" style={{ marginTop: 2 }}>{t.appView.afterAnalysisResultsAppearInTheTdr}<strong>{t.appView.theTabStaysDimUntilThen}</strong>{t.appView.thisIsExpected}</div>
                          <div className="field-row" style={{ marginTop: 5 }}>
                            <div style={{ flex: 2 }}>
                              <div className="field-label">{t.appView.waveformCsvPath}</div>
                              <input aria-label={t.appView.waveformCsvPath} className="input" value={tmCsvPath}
                                onChange={event => setTmCsvPath(event.target.value)}
                                placeholder={t.appView.scopeExportedCsv} />
                            </div>
                            <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
                              onClick={() => void browseCsvInto(setTmCsvPath, t.appView.selectScopeTdrWaveformCsv)}>{t.appView.browse}</button>
                            <div>
                              <div className="field-label">{t.appView.timeUnit}</div>
                              <select aria-label={t.appView.waveformTimeUnit} className="input" style={{ width: 92 }}
                                value={tmTimeUnit}
                                onChange={event => setTmTimeUnit(event.target.value as typeof tmTimeUnit)}
                                title={t.appView.autoUsesTheHeaderAndSampleIntervalTip}>
                                <option value="auto">{t.appView.auto}</option>
                                <option value="s">s</option>
                                <option value="ms">ms</option>
                                <option value="us">µs</option>
                                <option value="ns">ns</option>
                                <option value="ps">ps</option>
                              </select>
                            </div>
                            <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
                              disabled={tmBusy || !tmCsvPath.trim()} onClick={handleTmLoad}>
                              {tmBusy && !tmPreview ? t.appView.loading : t.appView.load}
                            </button>
                            {tmCsvPath.trim() && (
                              <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
                                title={t.appView.openTheWaveformFileFolderInExplorerTip}
                                onClick={() => void revealInExplorer(tmCsvPath)}>{t.appView.openFolder}</button>
                            )}
                          </div>
                          {tmPreview && (
                            <>
                              <div className="panel-hint" style={{ marginTop: 4 }}>{t.appView.pointsUnit(tmPreview.point_count, tmPreview.time_unit, tmTimeUnit === 'auto' ? t.appView.autoDetected : t.appView.userSpecified, tmPreview.value_kind === 'volts' ? t.appView.voltage
                                  : tmPreview.value_kind === 'ohms' ? t.appView.impedance : t.appView.reflectionCoefficient, tmPreview.edge_time_ns != null
                                  ? t.appView.incidentStepNs(Number(tmPreview.edge_time_ns).toFixed(3)) : '', tmPreview.rise_time_ps != null
                                  ? t.appView.measuredRiseTimePs(Number(tmPreview.rise_time_ps).toFixed(1)) : '')}</div>
                              {(tmPreview.candidates_ns || []).length > 0 && (
                                <div style={{ marginTop: 5 }}>
                                  <div className="field-label">{t.appView.reflectionCandidatesT0BoardLaunchFarEnd}</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {tmPreview.candidates_ns.map((candidate: number) => (
                                      <div key={candidate} style={{
                                        display: 'flex', border: '1px solid #303a48',
                                        borderRadius: 6, overflow: 'hidden', fontSize: 10.5,
                                      }}>
                                        <span style={{
                                          padding: '2px 6px', background: '#131820',
                                          color: '#d8e1ec',
                                        }}>
                                          {candidate.toFixed(3)} ns
                                        </span>
                                        <button className="btn" style={{ padding: '2px 7px' }}
                                          onClick={() => setTmT0(candidate.toFixed(4))}>{t.appView.setT0}</button>
                                        <button className="btn" style={{ padding: '2px 7px' }}
                                          onClick={() => setTmTEnd(candidate.toFixed(4))}>{t.appView.setFarEnd}</button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="field-row" style={{ marginTop: 5 }}>
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">{t.appView.t0BoardLaunchNs}</div>
                                  <input aria-label={t.appView.t0BoardLaunchNs} className="input" value={tmT0}
                                    onChange={event => setTmT0(event.target.value)} />
                                </div>
                                <div style={{ flex: 1 }}
                                  title={t.appView.farEndReflectionTimeCombinedWithPhysicalTip}>
                                  <div className="field-label">{t.appView.farEndReflectionNsOptional}</div>
                                  <input aria-label={t.appView.farEndReflectionNsOptional} className="input" value={tmTEnd}
                                    onChange={event => setTmTEnd(event.target.value)} />
                                </div>
                                {tmPreview.value_kind !== 'volts' && (
                                  <div style={{ flex: 1 }}
                                    title={t.appView.impedanceReflectionWaveformsDoNotCaptureTheTip}>
                                    <div className="field-label">{t.appView.riseTimePs}</div>
                                    <input aria-label={t.appView.riseTimePs} className="input" value={tmRise}
                                      onChange={event => setTmRise(event.target.value)} />
                                  </div>
                                )}
                              </div>
                              <div className="panel-hint" style={{ marginTop: 3 }}>{t.appView.velocitySource(tdrPath?.length_mm
                                  ? t.appView.twoAnchorsTraceMmFarEndRequired(length(Number(tdrPath.length_mm)))
                                  : t.appView.noTraceLengthLoadABoardFor, tdrDkHint ? t.appView.stackupDk(Number(tdrDkHint).toFixed(2)) : '')}</div>
                              {!tdrSuggestion && signalNets.length > 0 && (
                                <div className="field-row" style={{ marginTop: 5 }}>
                                  <div style={{ flex: 2 }}>
                                    <div className="field-label">{t.appView.probedSignalNetLayoutMarkers}</div>
                                    <select aria-label={t.appView.probedSignalNetLayoutMarkers} className="input"
                                      value={tdrNet}
                                      onChange={event => setTdrNet(event.target.value)}>
                                      {signalNets.map(net =>
                                        <option key={net} value={net}>{net}</option>)}
                                    </select>
                                  </div>
                                  <label style={{
                                    flex: 1, display: 'flex', alignItems: 'center', gap: 4,
                                    fontSize: 11, cursor: 'pointer', marginTop: 14,
                                  }}
                                    title={t.appView.tdrDistanceStartsAtTheProbeEnable521Tip}>
                                    <input type="checkbox" checked={tdrFlipStart}
                                      onChange={event => setTdrFlipStart(event.target.checked)} />{t.appView.originAtOtherEnd}</label>
                                </div>
                              )}
                              <button className="btn btn--primary" style={{ width: '100%', marginTop: 6 }}
                                disabled={tmBusy || !tmT0.trim()}
                                onClick={handleTmAnalyze}>
                                {tmBusy && tmPreview ? t.appView.analyzing : t.appView.analyzeWaveform}
                              </button>
                            </>
                          )}
                          {tmError && (
                            <div className="status status--warn"
                              style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
                              {tmError}
                            </div>
                          )}
                        </details>
                        <p className="panel-caveat">
                          <b>{t.appView.impedanceComesFromTheSolveDistanceIs}</b>{t.appView.impedanceIsReliablePositionHasUncertaintyLayout}</p>
                        {/* TDR 的執行歷史。求解與量測兩條路都寫紀錄，
                            列在同一份清單裡——它們是同一種分析的兩種來源。 */}
                        <RunHistory kind="tdr" title={t.appView.tdrHistoryTip} />
                  </div>
                </div>

                {/* 「截面阻抗（Q2D）」：從 EDB 還原二維截面，求該處的阻抗 */}
                <div hidden={!show.crosssection}>
                  <h3 className="panel-title">{t.appView.crossSectionImpedanceQ2d}</h3>
                  <p className="panel-hint">{t.appView.selectAnAreaAndCutLineIn}</p>
                  <div className="panel-hint" style={{ marginTop: 4 }}>{t.appView.areaWidthIsTheLateralModelBoundary}</div>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">{t.appView.sampleSpacingM}</div>
                      <LengthInput aria-label={t.appView.sampleSpacingM} className="input" value={xsResolutionUm}
                        onValue={setXsResolutionUm}
                        title={t.appView.distanceBetweenCopperChecksAlongTheCutTip} fieldKey="xsResolutionUm" source="um" min={0} positive step={1} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">{t.appView.conductorToReferenceHeightMOptional}</div>
                      <LengthInput aria-label={t.appView.conductorToReferenceHeightMOptional} className="input" value={xsHeightUm}
                        onValue={setXsHeightUm}
                        title={t.appView.requiredToAssessLateralTruncationWithoutItTip} fieldKey="xsHeightUm" source="um" min={0} optional step={1} />
                    </div>
                  </div>
                  <div className="panel-hint" style={{ marginTop: 5 }}>
                    {xsRegion
                      ? t.appView.workArea(length(xsRegion.x0Mm), length(xsRegion.y0Mm))
                        + `${length(xsRegion.x1Mm)}, ${length(xsRegion.y1Mm)} ${unit}`
                      : t.appView.noWorkAreaSelected}
                    {xsCut
                      ? t.appView.cutLineMm(xsCut.axis.toUpperCase(), length(xsCut.coordinateMm))
                      : t.appView.noCutLineSelected}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button className="btn btn--primary" style={{ flex: 1.4 }}
                      disabled={!xsRegion || !xsCut || xsBusy}
                      onClick={() => runCrossSectionScan()}>
                      {xsBusy ? t.appView.scanning : t.appView.scanCrossSection}
                    </button>
                    <button className="btn" style={{ flex: 1 }}
                      disabled={!xsRegion || !xsCut || !xsCutsLoaded}
                      onClick={handleXsSaveCut}
                      title={xsCutsLoaded
                        ? t.appView.cutLinesAnnotateThisBoardAndAreTip
                        : t.appView.cutLinesHaveNotLoadedYetSavingTip}>{t.appView.saveCutLine}</button>
                  </div>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">{t.appView.solveAccuracy}</div>
                      <select aria-label={t.appView.solveAccuracy} className="input" value={xsSolveMode}
                        onChange={event => setXsSolveMode(event.target.value)}>
                        <option value="fast">{t.appView.fastSurfaceImpedancePererror}</option>
                        <option value="standard">{t.appView.standardSurfaceImpedancePererror}</option>
                        <option value="accurate">{t.appView.highFieldsInsideConductorsSlower}</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}
                      title={t.appView.frequencyUsedForAdaptiveMeshingUseTheTip}>
                      <div className="field-label">{t.appView.adaptiveFrequency}</div>
                      <input aria-label={t.appView.adaptiveFrequency} className="input" value={xsFrequency}
                        onChange={event => setXsFrequency(event.target.value)} />
                    </div>
                  </div>
                  <div className="panel-hint" style={{ marginTop: 4 }}>{t.appView.allThreeLevelsGiveSimilarImpedanceHigh}</div>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginTop: 6,
                    fontSize: 11.5, cursor: 'pointer',
                  }}
                    title={t.appView.theOnlyWayToVerifyLateralExtentTip}>
                    <input type="checkbox" checked={xsWidenCheck}
                      onChange={event => setXsWidenCheck(event.target.checked)} />{t.appView.checkLateralConvergenceWidenAndResolveDouble((WIDEN_FACTOR - 1) * 100)}</label>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button className="btn btn--primary" style={{ flex: 1.4 }}
                      disabled={!xsScan?.plan?.solvable || xsJob?.running
                        || Boolean(licenseBlock(licenseStatus, ['q2d_solve']))}
                      onClick={() => {
                        const spec = xsCutSpec()
                        if (spec) handleXsSolve([spec])
                      }}
                      title={licenseBlock(licenseStatus, ['q2d_solve']) || (xsScan?.plan?.solvable
                        ? t.appView.solveOnlyTheCurrentCutLineTip
                        : t.appView.scanASolvableCrossSectionFirstTip)}>
                      {xsJob?.running ? t.appView.solvingBackground : t.appView.solveThisCut}
                    </button>
                    <button className="btn" style={{ flex: 1 }}
                      disabled={xsSavedCuts.length === 0 || xsJob?.running
                        || Boolean(licenseBlock(licenseStatus, ['q2d_solve']))}
                      onClick={() => handleXsSolve(xsSavedCuts)}
                      title={t.appView.solveAllSavedCutsInBatchToTip}>{t.appView.solveAllSaved(xsSavedCuts.length)}</button>
                    {xsJob?.running && (
                      <button className="btn" style={{ flex: 0.7 }}
                        onClick={handleXsStop}>{t.appView.terminate}</button>
                    )}
                  </div>
                  <LicenseTag functions={['q2d_solve']} />
                  {xsJob && xsJob.status !== 'idle' && (
                    <div className={`status ${xsJob.status === 'error' ? 'status--warn' : ''}`}
                      style={{ marginTop: 6, fontSize: 11 }}>
                      {viewField(xsJob, 'phase')}
                      {xsJob.message ? t.appView.statusDetail(viewField(xsJob, 'message')) : ''}
                      {xsJob.running && xsJob.started_at
                        ? t.appView.elapsedS(Math.max(0, Math.round(nowTick - xsJob.started_at)))
                        : ''}
                    </div>
                  )}
                  {xsError && (
                    <div className="status status--warn"
                      style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
                      {xsError}
                    </div>
                  )}
                  {xsSavedCuts.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div className="field-label">{t.appView.savedCutLines(xsSavedCuts.length)}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                        {xsSavedCuts.map(entry => (
                          <button key={entry.name} className="btn"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => handleXsLoadCut(entry)}>
                            {entry.name}
                          </button>
                        ))}
                      </div>
                      {xsCutsSource && (
                        <div className="panel-hint" style={{ marginTop: 3, wordBreak: 'break-all' }}>{t.appView.savedTo(xsCutsSource)}</div>
                      )}
                    </div>
                  )}
                  <p className="panel-caveat">
                    <b>{t.appView.theDSolveAssumesAConstantCross}</b>{t.appView.viasBendsAndReferencePlaneOpeningsAre}</p>
                </div>

              </div>
            </div>
          </Allotment.Pane>

          {/* 右側：預覽與日誌 */}
          <Allotment.Pane>
            <div style={{ paddingLeft: 7, height: '100%', display: 'flex', flexDirection: 'column' }}>
              {/* 檢視分頁。分頁本身放在會水平捲動的容器裡，「更新報告快照」
                  則釘在外面——放進去的話，分頁一多它就被推出可視範圍，
                  而那顆按鈕是每個分頁都用得到的。 */}
              <div className="viewtabs-row">
              <div className="viewtabs" style={{ marginBottom: 0 }}>
                <button
                  className={'viewtab' + (activeView === 'full' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('full')}
                >{t.appView.fullLayout}</button>
                <button
                  hidden={!(show.cutout || show.ports || show.stackup || show.backdrill)}
                  className={'viewtab' + (activeView === 'cut' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('cut')}
                  disabled={!cutScene}
                >{t.appView.cutoutLayout}</button>
                <button
                  hidden={!(show.cleanup)}
                  className={'viewtab' + (activeView === 'cleanup' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('cleanup')}
                  disabled={!cleanupAfterScene}
                >{t.appView.cleanupCompare}</button>
                <button
                  hidden={!(show.segment || show.schedule)}
                  className={'viewtab' + (activeView === 'segments' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('segments')}
                  disabled={!segRun && segmentOverlayCount(segOverlayInput) === null}
                >{t.appView.nSegmentSplit}</button>
                <button
                  hidden={!(show.cascade)}
                  className={'viewtab' + (activeView === 'schematic' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('schematic')}
                  disabled={!schematicGraph}
                >{t.appView.cascadeCircuit}</button>
                <button
                  hidden={!(show.sparam)}
                  className={'viewtab' + (activeView === 'sparam' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('sparam')}
                  disabled={!sparamTabEnabled(cascadeResult)}
                >{t.appView.sParameters}</button>
                {/* 舊版單一 QuickEye 結果頁不再作為入口；新眼圖直接在 IBIS 分析向導顯示。 */}
                <button
                  hidden
                  className={'viewtab' + (activeView === 'eye' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('eye')}
                  disabled={!eyeJob || eyeJob.status === 'idle'}
                >{t.appView.eyeAnalysis}</button>
                <button
                  hidden={!(show.models)}
                  className={'viewtab' + (activeView === 'models' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('models')}
                >{t.appView.ibisModelsAndEyeAnalysis}</button>
                {/* 分頁在條件未滿足時是暗的。**一定要說明為什麼**——使用者
                    回報「操作量測波形匯入時 TDR 分頁是暗的，容易使人誤會」，
                    以為功能壞了。`title` 掛在外層 span 而不是按鈕上：停用的
                    表單控制項不接收滑鼠事件，tooltip 不會出現。 */}
                <span hidden={!(show.tdr)}
                  title={!tdrJob || tdrJob.status === 'idle'
                    ? t.appView.noTdrResultsYetRunTdrImpedanceTip
                    : ''}>
                  <button
                    className={'viewtab' + (activeView === 'tdr' ? ' viewtab--active' : '')}
                    onClick={() => setActiveView('tdr')}
                    disabled={!tdrJob || tdrJob.status === 'idle'}
                  >TDR</button>
                </span>
                <span hidden={!(show.crosssection || xsReadable)}
                  title={!fullScene ? t.appView.noBoardLoadedLoadABoardToTip : ''}>
                  <button
                    className={'viewtab' + (activeView === 'crosssection' ? ' viewtab--active' : '')}
                    onClick={() => setActiveView('crosssection')}
                    disabled={!fullScene && !xsReadable}
                  >{t.appView.crossSectionImpedance}</button>
                </span>
                <button
                  hidden={!(show.report)}
                  className={'viewtab' + (activeView === 'report' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('report')}
                >{t.appView.report}</button>
                </div>
                {show.report && reportSnapshotAvailable && (
                  <div className="viewtabs-aside">
                    <ReportSnapshotButton
                      basePath={reportBasePath}
                      projectName={reportProjectName}
                      targetId={activeView === 'tdr' ? 'report-tdr-capture' : 'report-result-capture'}
                      kind={activeView === 'segments' && segRun && !isOverviewMode
                        ? `segments-${activeSegIdx + 1}` : activeView}
                      title={sceneLabel}
                      section={reportSectionByView[activeView]}
                      sourceRevision={reportSourceRevision}
                      // 按下快照時才組：模型分頁的 store 不會讓 App 重新 render。
                      sourceMetadata={() => ({
                        dc_method: (schedStatus?.jobs || []).filter((job: any) => job.dc_note)
                          .map((job: any) => t.appView.dcMethodForSegment(job.index, viewField(job, 'dc_note')))
                          .join(t.appView.dcMethodSeparator),
                        signal_net_count: signalNets.length,
                        reference_net_count: refNets.length,
                        // ：原本只看本次跑過的分段，重新開啟專案、直接
                        // 載入串接結果時寫成 0。查不到就不寫（undefined 不進報告）。
                        segment_count: reportSegmentCount({
                          view: activeView,
                          cascadeSegmentCount: cascadeResult?.segment_count,
                          schematicBlockCount: schematicGraph?.blocks?.length,
                          segRunCount: segRun?.segments?.length,
                          // 與預覽同一個來源：整片求解後是 1，不是上一次分析的段數。
                          segAnalysisCount: segmentOverlayCount(segOverlayInput),
                        }),
                        // 截面阻抗分頁另外帶上實際數字。快照是一張圖，
                        // 圖上的字在報告裡縮小之後未必讀得出來；數字進中繼資料
                        // 表格才會以文字保留下來。
                        ...(activeView === 'crosssection'
                          ? crossSectionReportMetadata() : {}),
                        // 模型分頁同理：模型來源等數字由各元件寫進
                        // store，這裡整批掛上。
                        ...(activeView === 'models'
                          ? modelsReportMetadata() : {}),
                      })}
                      onSaved={rememberReportWorkspace}
                    />
                  </div>
                )}
              </div>

              <div style={{ flex: 1, minHeight: 0 }}>
                <Allotment vertical defaultSizes={logSplitSizes}
                  onChange={saveLogSplitSizes}>
                  {/* 2D 預覽 */}
                  <Allotment.Pane minSize={200}>
                    <div style={{ paddingBottom: showLogs ? 7 : 0, height: '100%' }}>
                      <div id="report-result-capture" className="panel view-stage" style={{ overflow: 'hidden', position: 'relative', height: '100%', background: '#0c0e12', borderTopLeftRadius: 0 }}>
                        {(isLayoutView || activeView === 'schematic') && <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 1, fontSize: 12.5, fontWeight: 700, color: activeView === 'cut' ? '#7ee787' : '#9fb0c3', pointerEvents: 'none' }}>
                          {sceneLabel}
                          {scene?.preview_mode === 'coarse' ? t.appView.fastLargeBoardPreviewActualEdbUnchanged : ''}
                          {activeView !== 'schematic' ? t.appView.leftDragToPanWheelToZoom : ''}
                        </div>}
                        {activeView === 'models' ? (
                          <ModelLibrary />
                        ) : activeView === 'report' ? (
                          <ReportCenter basePath={reportBasePath} projectName={reportProjectName}
                            onWorkspaceChange={rememberReportWorkspace}
                            channelTouchstone={reportCollectSources.cascadeTouchstone}
                            collect={reportCollectSources} />
                        ) : activeView === 'eye' ? (
                          <div style={{
                            height: '100%', overflow: 'hidden', padding: 14,
                            display: 'flex', flexDirection: 'column', gap: 8,
                            fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
                            color: '#d8e1ec',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                              <div>
                                <h2 style={{ margin: 0, fontSize: 20 }}>{t.appView.quickeyeDiagram}</h2>
                                <div style={{ color: '#8fa1b5', fontSize: 12, marginTop: 4 }}>{t.appView.solvesTheExistingCascadedTouchstoneProjectFiles}</div>
                              </div>
                              {eyeJob?.result && (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {([
                                    [t.appView.dataRate, `${eyeJob.result.data_rate_gbps} Gbps`],
                                    [t.appView.riseFall, `${eyeJob.result.rise_time_ps} ps`],
                                    [t.appView.mode, eyeJob.result.mode === 'differential' ? t.appView.differential : t.appView.singleEnded],
                                  ] as [string, string][]).map(([label, value]) => (
                                    <div key={label} style={{
                                      minWidth: 110, border: '1px solid #303a48', borderRadius: 8,
                                      padding: '8px 11px', background: '#131820',
                                    }}>
                                      <div style={{ fontSize: 11, color: '#9fb0c3' }}>{label}</div>
                                      <div style={{ fontWeight: 800, fontSize: 15 }}>{value}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {eyeJob?.running && (
                              <div className="status" style={{ marginTop: 14 }}>{t.appView.elapsedSBackgroundSolveOtherTabsRemain(viewField(eyeJob, 'phase'), eyeJob.started_at
                                  ? Math.max(0, Math.round(nowTick - eyeJob.started_at))
                                  : 0)}</div>
                            )}
                            {eyeJob?.status === 'error' && (
                              <div className="status status--warn" style={{ marginTop: 14 }}>{t.appView.eyeSolveFailed(viewField(eyeJob, 'error'))}</div>
                            )}

                            {/* 量測在 measurements.metrics 底下，不是 measurements 本身。
                                外層是  的可得性包裝（available／source／api／
                                unavailable_reason／attempted），直接展開會列出六張沒有
                                意義的卡，而真正的 11 項一個都不會出現。 */}
                            {eyeJob?.result?.measurements?.available === false && (
                              <div className="status status--warn" style={{ marginTop: 14 }}>{t.appView.cannotObtainEyeMeasurements(viewField(eyeJob.result.measurements, 'unavailable_reason'))}</div>
                            )}
                            {eyeJob?.result?.measurements?.metrics
                              && Object.keys(eyeJob.result.measurements.metrics).length > 0 && (
                              <div style={{
                                display: 'grid', gap: 8,
                                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                              }}>
                                {Object.entries(eyeJob.result.measurements.metrics).map(([key, item]: [string, any]) => (
                                  <div key={key} style={{
                                    border: '1px solid #303a48', borderRadius: 7,
                                    background: '#131820', padding: '8px 10px',
                                  }}>
                                    <div style={{ color: '#93a4b8', fontSize: 11 }}>{viewField(item, 'label') || key}</div>
                                    <div style={{ fontSize: 17, fontWeight: 800, marginTop: 1 }}>
                                      {item.value !== undefined
                                        ? `${Number(item.value).toPrecision(4)} ${item.unit || ''}`
                                        : item.text}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {eyeJob?.status === 'done' && (
                              // 圖片吃滿剩餘高度並等比縮放，整頁不需捲動
                              <div style={{
                                flex: 1, minHeight: 0, border: '1px solid #303a48',
                                borderRadius: 8, padding: 8, background: '#0c0e12',
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                              }}>
                                <img
                                  src={`/api/circuit/quick_eye/image?v=${eyeImageRevision}`}
                                  alt={t.appView.quickeyeDiagram}
                                  style={{
                                    flex: 1, minHeight: 0, maxWidth: '100%',
                                    objectFit: 'contain', borderRadius: 6, background: '#fff',
                                  }}
                                />
                                <div style={{
                                  color: '#718096', fontSize: 10.5, marginTop: 6,
                                  wordBreak: 'break-all', flexShrink: 0,
                                }} title={eyeJob.result?.image_path || ''}>
                                  {/* 這一區會被拍進客戶報告，只顯示檔名；完整路徑在提示裡。 */}
                                  {displayFileName(eyeJob.result?.image_path)}
                                </div>
                                <div style={{ marginTop: 6, flexShrink: 0 }}>
                                  <OpenFolderButton path={eyeJob.result?.output_path} dark />
                                </div>
                              </div>
                            )}
                            {!eyeJob?.running && eyeJob?.status !== 'done' && eyeJob?.status !== 'error' && (
                              <div className="status" style={{ marginTop: 14 }}>{t.appView.noEyeAnalysisYetCompleteCircuitCascade}</div>
                            )}
                          </div>
                        ) : activeView === 'tdr' ? (
                          // 捲動外殼限制螢幕高度；快照直接擷取內層完整內容，包含曲線與檔名列。
                          <div style={{ height: '100%', overflow: 'auto' }}>
                          <div id="report-tdr-capture" style={{
                            minHeight: '100%', padding: 14,
                            display: 'flex', flexDirection: 'column', gap: 8,
                            fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
                            color: '#d8e1ec',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                              <div>
                                <h2 style={{ margin: 0, fontSize: 20 }}>{t.appView.tdrImpedanceLocation}</h2>
                                <div style={{ color: '#8fa1b5', fontSize: 12, marginTop: 4 }}>{t.appView.impedanceDiscontinuitiesAreRankedByDzDx}</div>
                                {/* 量測波形那一路的輸入是示波器 CSV，不是 Touchstone——
                                    把串接檔的證據掛上去會指向錯的東西。 */}
                                {tdrJob?.result?.source !== 'measured_waveform'
                                  && cascadeResult?.output_path && (
                                  <EvidenceBadges path={cascadeResult.output_path}
                                    expectedPorts={cascadeResult.n_ports}
                                    throughPaths={tdrThroughPaths} dark />
                                )}
                              </div>
                              {tdrJob?.result && (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {(() => {
                                    const analysis = tdrJob.result.analyses?.[tdrAnalysisIdx]
                                    const chips: [string, string][] = [
                                      [t.appView.riseTime, `${Number(tdrJob.result.rise_time_ps).toFixed(2)} ps`],
                                    ]
                                    if (analysis) {
                                      chips.push([t.appView.propagationVelocity, `${(analysis.velocity_m_s / 1e8).toFixed(3)}×10⁸ m/s`])
                                      chips.push([t.appView.spatialResolution, measure(Number(analysis.resolution_mm))])
                                      if (analysis.effective_dk) chips.push([t.appView.effectiveDk, Number(analysis.effective_dk).toFixed(2)])
                                    }
                                    return chips.map(([label, value]) => (
                                      <div key={label} style={{
                                        minWidth: 100, border: '1px solid #303a48', borderRadius: 8,
                                        padding: '8px 11px', background: '#131820',
                                      }}>
                                        <div style={{ fontSize: 11, color: '#9fb0c3' }}>{label}</div>
                                        <div style={{ fontWeight: 800, fontSize: 14 }}>{value}</div>
                                      </div>
                                    ))
                                  })()}
                                </div>
                              )}
                            </div>

                            {tdrJob?.running && (
                              <div className="status" style={{ marginTop: 14 }}>{t.appView.elapsedSBackgroundSolveOtherTabsRemain(viewField(tdrJob, 'phase'), tdrJob.started_at
                                  ? Math.max(0, Math.round(nowTick - tdrJob.started_at))
                                  : 0)}</div>
                            )}
                            {tdrJob?.status === 'error' && (
                              <div className="status status--warn" style={{ marginTop: 14 }}>{t.appView.tdrSolveFailed(viewField(tdrJob, 'error'))}</div>
                            )}

                            {tdrJob?.status === 'done' && tdrJob.result && (() => {
                              const analyses = tdrJob.result.analyses || []
                              const analysis = analyses[tdrAnalysisIdx] || analyses[0]
                              if (!analysis) return null
                              const methodTag = analysis.method === 'group_delay' ? 'A'
                                : analysis.method === 'end_anchor' ? t.appView.anchor : 'B'
                              const peaks = (analysis.discontinuities || []).slice(0, 8)
                              const chartMarkers = tdrMarkers
                                ? tdrMarkers.map(m => ({
                                    distance_mm: m.distance_mm,
                                    label: (m.label || '').split(/\s+/)[0],
                                    excluded: m.excluded,
                                  }))
                                : peaks.map((d: any, i: number) => ({
                                    distance_mm: d.distance_mm,
                                    label: `${methodTag}${i + 1}`,
                                    excluded: false,
                                  }))
                              return (
                                <>
                                  {analyses.length > 1 && (
                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                      {analyses.map((item: any, index: number) => (
                                        <button key={item.method}
                                          className={'btn' + (index === tdrAnalysisIdx ? ' btn--primary' : '')}
                                          style={{ padding: '3px 12px', fontSize: 11.5 }}
                                          onClick={() => setTdrAnalysisIdx(index)}>
                                          {item.method === 'group_delay' ? t.appView.methodAGroupDelay
                                            : item.method === 'end_anchor' ? t.appView.twoAnchorsMeasured
                                              : t.appView.methodBStackupDk}
                                        </button>
                                      ))}
                                      <span style={{ fontSize: 11, color: '#8fa1b5', marginLeft: 6 }}>{t.appView.bothMethodsPositionDifferencesReflectVelocityUncertainty}</span>
                                    </div>
                                  )}
                                  {/* 警語流式排列：量測路一次會有三四條，逐條整寬
                                      疊起來會把下面的場景列擠塌。 */}
                                  {((tdrJob.result.warnings || []).length > 0 || tdrMapError) && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                      {viewList(tdrJob.result, 'warnings').map((warning: string) => (
                                        <div key={warning} className="status status--warn"
                                          style={{ fontSize: 10.5, width: 'auto', padding: '2px 8px', animation: 'none' }}>
                                          {warning}
                                        </div>
                                      ))}
                                      {tdrMapError && (
                                        <div className="status status--warn"
                                          style={{ fontSize: 10.5, width: 'auto', padding: '2px 8px', animation: 'none' }}>{t.appView.layoutMarkerMappingFailed(tdrMapError)}</div>
                                      )}
                                    </div>
                                  )}

                                  <div style={{ display: 'flex', gap: 8, minHeight: 110, flex: '1 0 auto' }}>
                                    {tdrScene && (
                                      <div style={{
                                        flex: 1.5, minWidth: 0, border: '1px solid #303a48',
                                        borderRadius: 8, overflow: 'hidden', position: 'relative',
                                      }}>
                                        <Preview2D data={tdrScene}
                                          fitKey={`tdr-${tdrNet}`}
                                          signalNets={signalNets} refNets={refNets}
                                          highlightNets={[...signalNets, ...refNets]}
                                          tdrMarkers={tdrMarkers}
                                          showOnlySelected={layoutOnlySelectedNets}
                                          layerPanelEnabled={false} />
                                        {!tdrMarkers && !tdrMapError && (
                                          <div style={{
                                            position: 'absolute', top: 10, left: 12, fontSize: 11,
                                            color: '#8fa1b5', pointerEvents: 'none',
                                          }}>{t.appView.mappingMarkersOrNoDiscontinuityExceedsThe}</div>
                                        )}
                                      </div>
                                    )}
                                    <div style={{
                                      flex: 1, minWidth: 260, border: '1px solid #303a48',
                                      borderRadius: 8, background: '#131820',
                                      padding: 10, overflow: 'auto',
                                    }}>
                                      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>{t.appView.impedanceDiscontinuitiesRankedByReflectionStrength(analysis.method === 'end_anchor'
                                          ? t.appView.twoAnchorMethod : t.appView.method(methodTag))}</div>
                                      {peaks.length === 0 ? (
                                        <div style={{ fontSize: 12, color: '#8fa1b5' }}>{t.appView.noDiscontinuityExceedsTheThresholdThisChannel}</div>
                                      ) : (
                                        <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
                                          <thead>
                                            <tr style={{ color: '#9fb0c3', textAlign: 'left' }}>
                                              <th style={{ padding: '3px 6px' }}>#</th>
                                              <th style={{ padding: '3px 6px' }}>{t.appView.distance}</th>
                                              <th style={{ padding: '3px 6px' }}>{t.appView.impedance}</th>
                                              <th style={{ padding: '3px 6px' }}>ΔZ</th>
                                              <th style={{ padding: '3px 6px' }}>|Γ|</th>
                                              {show.crosssection && (
                                                <th style={{ padding: '3px 6px' }}>{t.appView.crossSection}</th>
                                              )}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {peaks.map((peak: any, index: number) => {
                                              const marker = tdrMarkers?.[index]
                                              return (
                                                <tr key={index} style={{
                                                  borderTop: '1px solid #232b36',
                                                  color: marker?.excluded ? '#8b95a2' : '#d8e1ec',
                                                }}>
                                                  <td style={{ padding: '4px 6px', fontWeight: 700 }}>
                                                    {methodTag}{index + 1}{marker?.excluded ? ' ⚠' : ''}
                                                  </td>
                                                  <td style={{ padding: '4px 6px' }}>{length(peak.distance_mm)} {unit}</td>
                                                  <td style={{ padding: '4px 6px' }}>{peak.impedance_ohm.toFixed(1)} Ω</td>
                                                  <td style={{ padding: '4px 6px' }}>{peak.delta_z_ohm > 0 ? '+' : ''}{peak.delta_z_ohm.toFixed(1)} Ω</td>
                                                  <td style={{ padding: '4px 6px' }}>{peak.reflection_mag.toFixed(3)}</td>
                                                  {show.crosssection && (
                                                    <td style={{ padding: '4px 6px' }}>
                                                      <button className="btn--mini tdr-crosssection-button"
                                                        disabled={xsFromTdrBusy || !tdrPath}
                                                        onClick={() => handleCutHere(
                                                          peak.distance_mm, `XS_${methodTag}${index + 1}`)}
                                                        title={t.appView.createACutPerpendicularToTheTraceTip}>{t.appView.crossSectionHere}</button>
                                                    </td>
                                                  )}
                                                </tr>
                                              )
                                            })}
                                          </tbody>
                                        </table>
                                      )}
                                      {tdrMarkers?.some(m => m.excluded) && (
                                        <div style={{ fontSize: 10.5, color: '#8fa1b5', marginTop: 6 }}>{t.appView.insideASegmentCutExclusionZoneUsually}</div>
                                      )}
                                      {show.crosssection && tdrPath && (
                                        <div style={{
                                          marginTop: 10, paddingTop: 8,
                                          borderTop: '1px solid #232b36',
                                        }}>
                                          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{t.appView.sampleCrossSectionsAlongTrace}<BetaBadge feature="B19" /></div>
                                          <div style={{ fontSize: 10.5, color: '#8fa1b5', marginBottom: 6 }}>{t.appView.takeCutsAtRegularIntervalsAlongThe}</div>
                                          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                                            <div style={{ flex: 1 }}>
                                              <div className="field-label">{t.appView.spacingMm}</div>
                                              <LengthInput aria-label={t.appView.spacingMm} className="input" style={{ height: 26 }}
                                                value={xsSampleSpacingMm}
                                                onValue={setXsSampleSpacingMm} fieldKey="xsSampleSpacingMm" source="mm" min={0} positive step={1} />
                                            </div>
                                            <div style={{ flex: 1 }}
                                              title={t.appView.lateralHalfWidthDefinesThePhysicalBoundaryTip}>
                                              <div className="field-label">{t.appView.lateralHalfWidthM}</div>
                                              <LengthInput aria-label={t.appView.lateralHalfWidthM} className="input" style={{ height: 26 }}
                                                value={xsHalfWidthUm}
                                                onValue={setXsHalfWidthUm} fieldKey="xsHalfWidthUm" source="um" min={0} positive step={100} />
                                            </div>
                                            <button className="btn" style={{ height: 26, whiteSpace: 'nowrap' }}
                                              disabled={xsFromTdrBusy}
                                              onClick={handleSampleAlongTrace}>
                                              {xsFromTdrBusy ? t.appView.generating : t.appView.sampleAlongTrace}
                                            </button>
                                          </div>
                                          <div style={{ fontSize: 10.5, color: '#8fa1b5', marginTop: 4 }}>{t.appView.traceLengthMmSpacingMmAboutCuts(length(Number(tdrPath.length_mm)), length(Number(xsSampleSpacingMm)), ' ', Math.max(1, Math.round(Number(tdrPath.length_mm) / (Number(xsSampleSpacingMm) || 1))))}</div>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* 圖框與上方表格分剩下的高度：最少 120、最多 230（原本固定 230）。 */}
                                  <div ref={tdrChartBoxRef} style={{
                                    border: '1px solid #303a48', borderRadius: 8, overflow: 'hidden',
                                    flex: '1.2 1 0', minHeight: 122, maxHeight: 232,
                                  }}>
                                    <TdrChart
                                      distanceMm={analysis.distance_mm || []}
                                      impedanceOhm={tdrJob.result.impedance_ohm || []}
                                      markers={chartMarkers}
                                      pathLengthMm={tdrJob.result.path_length_mm}
                                      xMaxMm={analysis.display_cap_mm ?? null}
                                      height={tdrChartHeight(tdrChartBoxHeight)} />
                                  </div>
                                  <div className="result-paths result-paths--center" style={{ animation: 'none' }}>
                                    {/* 會被拍進客戶報告：只顯示檔名，完整路徑放提示。 */}
                                    <span title={String((tdrJob.result.source === 'measured_waveform'
                                      ? tdrJob.result.csv_path : tdrJob.result.project_path) || '')}>
                                      {tdrJob.result.source === 'measured_waveform'
                                        ? t.appView.measuredWaveform(displayFileName(tdrJob.result.csv_path))
                                        : t.appView.circuitProject(displayFileName(tdrJob.result.project_path))}</span>
                                    {/* 量測波形沒有輸出檔（只寫執行紀錄），不給按鈕。 */}
                                    <OpenFolderButton path={tdrJob.result.source === 'measured_waveform' ? '' : tdrJob.result.project_path} dark />
                                  </div>
                                </>
                              )
                            })()}
                            {!tdrJob?.running && tdrJob?.status !== 'done' && tdrJob?.status !== 'error' && (
                              <div className="status" style={{ marginTop: 14 }}>{t.appView.noTdrAnalysisYetCompleteCircuitCascade}</div>
                            )}
                          </div>
                          </div>
                        ) : activeView === 'sparam' && cascadeResult ? (
                          <div style={{
                            height: '100%', overflow: 'hidden', padding: 10,
                            display: 'flex', flexDirection: 'column', gap: 6,
                            fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
                            color: '#d8e1ec',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between',
                                          gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                              <h2 style={{ margin: 0, fontSize: 15 }}>{t.appView.cascadedSParameters}</h2>
                              <div style={{ color: '#8fa1b5', fontSize: 10.5 }}>
                                {spData ? t.appView.nearEndFarEnd(spData.near, spData.far)
                                  + `${spData.mode === 'diff' ? t.appView.differentialPairs(spData.pair_count) : t.appView.singleEndedNets(spData.net_count)}`
                                  : t.appView.endpointsAndDifferentialPairsInferredFromPort}
                              </div>
                            </div>
                            <EvidenceBadges path={cascadeResult.output_path}
                              expectedPorts={cascadeResult.n_ports}
                              throughPaths={tdrThroughPaths} dark />
                            <div><OpenFolderButton path={cascadeIsToolOutput ? cascadeResult.output_path : ''} dark /></div>

                            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                              <div style={{ display: 'flex', gap: 4 }}>
                                {([['diff', t.appView.differentialMode], ['single', t.appView.singleEndedMode]] as const).map(([m, label]) => (
                                  <button key={m}
                                    className={'btn' + (spMode === m ? ' btn--primary' : '')}
                                    style={{ padding: '3px 12px', fontSize: 11.5 }}
                                    onClick={() => { spModePicked.current = true; setSpMode(m as 'single' | 'diff') }}>{label}</button>
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: '#b8c6d8' }}>
                                {([['il', t.appView.insertionLoss], ['rl', t.appView.returnLoss],
                                   ['next', t.appView.next], ['fext', t.appView.fext]] as const).map(([k, label]) => (
                                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                                    <input type="checkbox" checked={!!spKinds[k]}
                                      onChange={e => setSpKinds({ ...spKinds, [k]: e.target.checked })} />
                                    {label}
                                  </label>
                                ))}
                              </div>
                              {spBusy && <span style={{ fontSize: 11, color: '#8fa1b5' }}>{t.appView.calculating}</span>}
                            </div>

                            {spError && (
                              <div style={{ fontSize: 11, color: '#ffb347' }}>{spError}</div>
                            )}

                            {/* 內距拿掉：圖例與軸控制都收進圖表自己的側邊
                                抽屜了，這一格的空間全部留給曲線。 */}
                            <div ref={spChartRef} style={{
                              flex: 1, minHeight: 0, border: '1px solid #303a48',
                              borderRadius: 8, background: '#0c0e12',
                              overflow: 'hidden',
                            }}>
                              <SParamChart
                                // 回傳型別標成 SParamSeries，欄位名打錯會在編譯期擋下。
                                // 先前寫成 freq_ghz（圖表要的是 freq）且沒給 color，
                                // 因為來源是 any 而躲過型別檢查，執行到才
                                // undefined.map 讓整個畫面崩掉。
                                series={((spData?.series || []) as any[])
                                  .filter((c: any) => spKinds[c.kind])
                                  .map((c: any, i: number): SParamSeries => ({
                                    label: c.label,
                                    color: CASC_COLORS[i % CASC_COLORS.length],
                                    freq: c.freq_ghz,
                                    db: c.db,
                                  }))}
                                height={Math.max(160, spChartHeight)}
                                interactive
                                onExport={handleExportSparamExcel}
                                exporting={spExporting}
                              />
                            </div>

                            {/* 兩段說明置中：靠左靠右各一段時，中間那段大空白
                                看起來像少了什麼東西。 */}
                            <div className="result-paths result-paths--center">
                              {/* 這一行會被拍進 S 參數快照、交給客戶：只顯示檔名，
                                  完整路徑放提示。 */}
                              <span title={String(cascadeResult.output_path || '')}>{t.appView.source(displayFileName(cascadeResult.output_path))}</span>
                              <span>
                                {spMode === 'diff'
                                  ? t.appView.differentialModeScikitRfMixedModeConversion
                                  : t.appView.singleEndedModeIlNearToFar}
                              </span>
                            </div>
                          </div>
                        ) : activeView === 'cleanup' && cleanupBeforeScene && cleanupAfterScene ? (
                          <div className="cleanup-compare">
                            <div className="cleanup-compare__toolbar">
                              <strong>{t.appView.layoutCleanupComparison}</strong>
                              <div className="cleanup-compare__modes">
                                {([
                                  ['overlay', t.appView.highlightChanges],
                                  ['side-by-side', t.appView.sideBySide],
                                  ['before', t.appView.beforeCleanup],
                                  ['after', t.appView.afterCleanup],
                                ] as [CleanupCompareMode, string][]).map(([mode, label]) => (
                                  <button key={mode}
                                    className={'cleanup-compare__mode' + (cleanupCompareMode === mode ? ' cleanup-compare__mode--active' : '')}
                                    onClick={() => setCleanupCompareMode(mode)}>{label}</button>
                                ))}
                              </div>
                              {cleanupAnalysis?.comparison && (
                                <div className="cleanup-compare__stats">
                                  <span>{t.appView.primitives(cleanupAnalysis.comparison.before.primitive.toLocaleString(), cleanupAnalysis.comparison.after.primitive.toLocaleString())}</span>
                                  <span>{t.appView.padstacks(cleanupAnalysis.comparison.before.padstack.toLocaleString(), cleanupAnalysis.comparison.after.padstack.toLocaleString())}</span>
                                  <span>{t.appView.edb(formatBytes(cleanupAnalysis.comparison.before.file_bytes), formatBytes(cleanupAnalysis.comparison.after.file_bytes))}</span>
                                </div>
                              )}
                            </div>
                            {cleanupCompareMode === 'overlay' && (
                              <div className="cleanup-compare__filters">
                                <select aria-label={t.appView.changeTypeFilter} value={cleanupDiffKind} onChange={e => setCleanupDiffKind(e.target.value as 'all' | 'primitive' | 'via')}>
                                  <option value="all">{t.appView.allChanges}</option>
                                  <option value="primitive">{t.appView.copperTracesOnly}</option>
                                  <option value="via">{t.appView.viasOnly}</option>
                                </select>
                                <select aria-label={t.appView.layerFilter} value={cleanupDiffLayer} onChange={e => setCleanupDiffLayer(e.target.value)}>
                                  <option value="">{t.appView.allLayers}</option>
                                  {cleanupDifferenceLayers.map(layer => <option key={layer} value={layer}>{layer}</option>)}
                                </select>
                              </div>
                            )}
                            <div className={'cleanup-compare__canvas cleanup-compare__canvas--' + cleanupCompareMode}>
                              {(cleanupCompareMode === 'side-by-side' || cleanupCompareMode === 'before') && (
                                <div className="cleanup-compare__pane">
                                  <div className="cleanup-compare__label cleanup-compare__label--before">{t.appView.beforeCleanup}</div>
                                  <Preview2D data={cleanupBeforeScene} fitKey={`cleanup-before-${cleanupCompareMode}`}
                                    signalNets={signalNets} refNets={refNets} highlightNets={[...signalNets, ...refNets]}
                                    layerPanelEnabled={cleanupCompareMode !== 'side-by-side'} />
                                </div>
                              )}
                              {(cleanupCompareMode === 'side-by-side' || cleanupCompareMode === 'after') && (
                                <div className="cleanup-compare__pane">
                                  <div className="cleanup-compare__label cleanup-compare__label--after">{t.appView.afterCleanup}</div>
                                  <Preview2D data={cleanupAfterScene} fitKey={`cleanup-after-${cleanupCompareMode}`}
                                    signalNets={signalNets} refNets={refNets} highlightNets={[...signalNets, ...refNets]}
                                    layerPanelEnabled={cleanupCompareMode !== 'side-by-side'} />
                                </div>
                              )}
                              {cleanupCompareMode === 'overlay' && (
                                <div className="cleanup-compare__pane">
                                  <div className="cleanup-compare__label cleanup-compare__label--overlay">{t.appView.redRemovedCopperTracesOrangeRemovedVias}</div>
                                  <Preview2D data={cleanupAfterScene} fitKey={`cleanup-overlay-${cleanupFocusRegion ?? 'all'}`}
                                    signalNets={signalNets} refNets={refNets} highlightNets={[...signalNets, ...refNets]}
                                    removedGeometry={cleanupAnalysis?.removed_geometry || null}
                                    cleanupOverlay={!cleanupAnalysis?.removed_geometry ? cleanupRemovedOverlay : null}
                                    dimBase
                                    differenceKind={cleanupDiffKind}
                                    differenceLayer={cleanupDiffLayer}
                                    focusBounds={cleanupFocusedBounds} />
                                  {!!cleanupAnalysis?.difference_regions?.length && (
                                    <div className="cleanup-regions">
                                      <div className="cleanup-regions__title">{t.appView.denseChangeRegions}</div>
                                      <button className={cleanupFocusRegion === null ? 'active' : ''}
                                        onClick={() => setCleanupFocusRegion(null)}>{t.appView.allChanges}</button>
                                      {cleanupAnalysis.difference_regions.map((region, index) => (
                                        <button key={index} className={cleanupFocusRegion === index ? 'active' : ''}
                                          onClick={() => setCleanupFocusRegion(index)}>{t.appView.region647(index + 1)}<small>{t.appView.objectsCopperVias(region.count, region.primitive, region.via)}</small>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  {cleanupAnalysis?.removed_geometry?.truncated && (
                                    <div className="cleanup-compare__warning">{t.appView.tooManyChangesHighlightingTheFirstStatistics(cleanupAnalysis.removed_geometry.rendered.toLocaleString())}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : activeView === 'crosssection' && (betaEnabled || xsReadable) ? (
                          <div style={{
                            height: '100%', paddingTop: 34, display: 'flex', gap: 8,
                            minHeight: 0,
                          }}>
                            <div><BetaBadge feature="M12" />
                              {!betaEnabled && xsJob?.running && <button type="button" onClick={() => { void api('/api/cross-section/stop', {}) }}>{t.appView.stop}</button>}
                            </div>
                            <div style={{
                              flex: 1.2, minWidth: 0, border: '1px solid #303a48',
                              borderRadius: 8, overflow: 'hidden', position: 'relative',
                            }}>
                              <Preview2D
                                data={scene}
                                fitKey={`xs-${inputPath}`}
                                signalNets={signalNets} refNets={refNets}
                                highlightNets={[...signalNets, ...refNets]}
                                layerPanelInitiallyOpen={false}
                                crossSectionMode={betaEnabled ? xsMode : 'none'}
                                onCrossSectionModeChange={betaEnabled ? setXsMode : undefined}
                                crossSectionRegion={xsRegion}
                                crossSectionCut={xsCut}
                                onCrossSectionRegionDrawn={betaEnabled ? handleXsRegionDrawn : undefined}
                                onCrossSectionCutDrawn={betaEnabled ? handleXsCutDrawn : undefined}
                              />
                            </div>
                            <div style={{
                              flex: 1, minWidth: 340, maxWidth: 700, overflowY: 'auto',
                              border: '1px solid #303a48', borderRadius: 8, padding: 10,
                            }}>
                              {(xsJob?.result?.cuts || []).length > 0 && (
                                <div style={{
                                  marginBottom: 12, paddingBottom: 12,
                                  borderBottom: '1px solid #27313d',
                                }}>
                                  <div style={{
                                    fontWeight: 700, fontSize: 13, marginBottom: 6,
                                    color: '#e8eef5',
                                  }}>{t.appView.solveResults(xsJob.running ? t.appView.stillRunningCompletedResultsShown : '')}</div>
                                  <CrossSectionResults
                                    rows={xsJob.result.cuts}
                                    selected={xsResultIdx}
                                    onSelect={setXsResultIdx} />
                                  <div style={{ marginTop: 8 }}>
                                    <OpenFolderButton path={xsJob.result.project_path} dark />
                                  </div>
                                </div>
                              )}
                              {xsCompare && (
                                <div style={{
                                  marginBottom: 12, paddingBottom: 12,
                                  borderBottom: '1px solid #27313d',
                                }}>
                                  {/* 橫軸的裁切要與 TDR 分頁那張圖用同一組
                                      值：少了它，這裡畫的是反射拖尾一路到
                                      線尾之後，Q2D 的點全擠在左邊一小段。 */}
                                  <CrossSectionComparison
                                    result={xsCompare}
                                    tdrDistanceMm={
                                      tdrJob?.result?.analyses?.[tdrAnalysisIdx]?.distance_mm || []}
                                    tdrImpedanceOhm={tdrJob?.result?.impedance_ohm || []}
                                    pathLengthMm={tdrJob?.result?.path_length_mm ?? null}
                                    xMaxMm={(tdrJob?.result?.analyses?.[tdrAnalysisIdx]
                                      ?? tdrJob?.result?.analyses?.[0])?.display_cap_mm ?? null} />
                                </div>
                              )}
                              {xsScan ? (
                                <CrossSectionView
                                  scan={xsScan}
                                  roleOverrides={xsRoleOverrides}
                                  onRoleOverride={betaEnabled ? handleXsRoleOverride : undefined}
                                  busy={xsBusy} />
                              ) : (xsJob?.result?.cuts || []).length > 0 ? (
                                <div style={{ color: '#8fa1b5', fontSize: 12 }}>{t.appView.toViewTheCrossSectionAgainClick}</div>
                              ) : (
                                <div style={{ color: '#8fa1b5', fontSize: 12, lineHeight: 1.7 }}>
                                  <div style={{ fontWeight: 700, fontSize: 13, color: '#c9d5e2' }}>{t.appView.noCrossSectionYet}</div>
                                  <ol style={{ paddingLeft: 18, marginTop: 8 }}>
                                    <li>{t.appView.clickSelectWorkAreaAtTheTop}</li>
                                    <li>{t.appView.clickDrawCutLineThenClickWhere}</li>
                                    <li>{t.appView.clickScanCrossSectionInTheLeft}</li>
                                  </ol>
                                  {xsBusy && <div style={{ marginTop: 8 }}>{t.appView.scanning}</div>}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : activeView === 'schematic' && schematicGraph ? (
                          <div style={{ height: '100%', paddingTop: 34 }}>
                            <CascadeSchematic graph={schematicGraph} />
                          </div>
                        ) : (
                        <Preview2D
                          sessionKey="preview.main"
                          data={scene}
                          fitKey={activeView + inputPath + (activeView === 'segments' && segRun ? `_seg${activeSegIdx}` : '') + (cleanupOverlay ? `_clean${cleanupOverlay.total}` : '')}
                          signalNets={signalNets}
                          refNets={refNets}
                          highlightNets={[...signalNets, ...refNets]}
                          showOnlySelected={layoutOnlySelectedNets}
                          onShowOnlySelectedChange={setLayoutOnlySelectedNets}
                          expansionMm={activeView === 'full' && signalNets.length > 0 ? parseFloat(expansionMm) || 0 : undefined}
                          extentType={extentType}
                          estimatedCutoutBoundary={visibleEstimatedBoundary}
                          segmentCuts={segCutsOverlay}
                          showSegmentSafetyOverlay={showSegmentSafetyOverlay}
                          onSegmentSafetyOverlayChange={activeView === 'segments' ? setShowSegmentSafetyOverlay : undefined}
                          showSegmentCutDiagnostics={showSegmentCutDiagnostics}
                          onSegmentCutDiagnosticsChange={activeView === 'segments' ? setShowSegmentCutDiagnostics : undefined}
                          showSolverRegionOverlay={showSolverRegionOverlay}
                          onSolverRegionOverlayChange={activeView === 'segments' ? setShowSolverRegionOverlay : undefined}
                          // 執行後左上角多了分段選擇列（top 36），疊圖切換鈕往下讓一排。
                          overlayToggleTop={activeView === 'segments' && segRun ? 72 : undefined}
                          // 只在預覽跟著表格時開放：剛分析完畫的是新分析，表格卻還是
                          // 舊檔，點下去會改到看不見的那一份。疊圖依段號排序，
                          // 這裡也要依段號對，不能用後端回傳的陣列順序。
                          onSegmentRegionClick={activeView === 'segments' && showSolverRegionOverlay
                            && segFollowPlan && segmentSolverPlans.length > 0
                            ? index => {
                                const plan = [...segmentSolverPlans]
                                  .sort((a, b) => a.index - b.index)[index]
                                if (plan) handleSegmentSolverChange(
                                  plan.index,
                                  plan.requested_solver === 'hfss' ? 'siwave' : 'hfss',
                                )
                              }
                            : undefined}
                          onCutDrag={activeView === 'segments' && complexityAnalysis && !segRun
                            ? handleCutDrag : undefined}
                          cleanupOverlay={cleanupOverlay}
                        />
                        )}

                        {/* 分段選擇列（執行分段後顯示）：整體視圖 + 各段 Layout 切換 */}
                        {activeView === 'segments' && segRun && (
                          <div style={{ position: 'absolute', top: 36, left: 16, zIndex: 2, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 'calc(100% - 32px)' }}>
                            <button
                              onClick={() => setActiveSegIdx(-1)}
                              style={{
                                padding: '4px 12px', fontSize: 12, fontWeight: 700,
                                background: isOverviewMode ? 'var(--accent-grad)' : 'rgba(22,26,33,0.92)',
                                color: isOverviewMode ? '#fff' : '#9fb0c3',
                                border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6,
                                cursor: 'pointer',
                              }}
                              title={t.appView.showTheFullBoardAndCutLinesTip}
                            >{t.appView.overview}</button>
                            {segRun.segments.map((s, i) => (
                              <button
                                key={s.index}
                                onClick={() => setActiveSegIdx(i)}
                                style={{
                                  padding: '4px 12px', fontSize: 12, fontWeight: 700,
                                  background: !isOverviewMode && i === activeSegIdx ? 'var(--accent-grad)' : 'rgba(22,26,33,0.92)',
                                  color: !isOverviewMode && i === activeSegIdx ? '#fff' : '#9fb0c3',
                                  border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6,
                                  cursor: 'pointer',
                                }}
                                title={t.appView.cutPlanePortsTip(t.appView.joinList(s.cut_ports.flatMap((t: any) => (t.ports || []).map((p: any) => p.name))) || t.appView.noneTip)}
                              >{t.appView.segment661(s.index)}</button>
                            ))}
                          </div>
                        )}

                        {!scene && isLayoutView && (
                          <div className="stage-empty">
                            <svg viewBox="0 0 48 48" aria-hidden="true">
                              <rect x="6.5" y="10.5" width="35" height="27" rx="2.5" />
                              <path d="M6.5 18.5h35M15.5 18.5v19M24 18.5v19M32.5 18.5v19" />
                            </svg>
                            <div>{t.appView.loadABoardFileInTheLeft}</div>
                            <small>{t.appView.supportsAedbBrdTgz}</small>
                          </div>
                        )}
                      </div>
                    </div>
                  </Allotment.Pane>

                  {/* 日誌面板 */}
                  {/* 日誌最高佔視窗 35%，面板上就能收合：1280×720 的筆電上
                      日誌一展開，主要內容只剩一小塊，而關掉日誌原本只能找「檢視」選單。 */}
                  {showLogs && (
                    <Allotment.Pane minSize={90} maxSize={logPaneMaxPx(viewportHeight)}>
                      <div style={{ paddingTop: 7, height: '100%' }}>
                        <div className="panel" style={{ height: '100%', minHeight: 0, padding: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', flexShrink: 0, justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <h3 className="panel-title" style={{ margin: 0 }}>{t.appView.systemLogs}</h3>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn" style={{ fontSize: 12, padding: '2px 10px' }}
                                onClick={() => void copyText(logs.map(l => logText(l, lang)).join('\n')).catch(e => alert(t.appView.copyLogsFailedAlert(viewError(e))))}>{t.appView.copy}</button>
                              <button className="btn" style={{ fontSize: 12, padding: '2px 10px' }}
                                onClick={() => setLogs([])}>{t.appView.clear667}</button>
                              <button className="btn" style={{ fontSize: 12, padding: '2px 10px' }}
                                title={t.compactLayout.collapseLogsTip}
                                onClick={() => setShowLogs(false)}>{t.compactLayout.collapseLogs}</button>
                            </div>
                          </div>
                          <div ref={logBoxRef} onScroll={onLogScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', fontSize: '12px', fontFamily: '"Cascadia Mono", monospace', color: 'var(--muted)', background: 'rgba(255,255,255,0.5)', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                            {logs.map((l, i) => (
                              <div key={i} className="log-line" style={{ color: logColor(l) }}>{logText(l, lang)}</div>
                            ))}
                            {logs.length === 0 && <div className="empty-hint">{t.appView.noLogsYet}</div>}
                          </div>
                        </div>
                      </div>
                    </Allotment.Pane>
                  )}
                </Allotment>
              </div>
            </div>
          </Allotment.Pane>
        </Allotment>
      </main>
      {!showLogs && <div className="log-dock" role="region" aria-label={t.compactLayout.logsTitle}>
        <button className="btn" title={t.compactLayout.expandLogsTip} onClick={() => setShowLogs(true)}>{t.compactLayout.expandLogs}</button>
        <span className="log-dock__last">{logs.length ? logText(logs[logs.length - 1], lang) : t.appView.noLogsYet}</span>
      </div>}
    </div>
  )
}
