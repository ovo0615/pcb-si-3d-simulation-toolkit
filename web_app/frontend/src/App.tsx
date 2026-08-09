// PCB SI 3D 模擬分析工具 — 前端主程式
// 裁切流程：載入電路板 → 選擇訊號／參考網路 → 裁切設定 → Port 設定 → 執行裁切
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { Allotment } from 'allotment'
import {
  loadLogSplit, loadMainSplit, saveLogSplit, saveMainSplit,
  loadReportWorkspace, saveReportWorkspace,
} from './splitLayout'
import { logColor } from './logLevel'
import 'allotment/dist/style.css'
import Preview2D, { CleanupOverlay, CleanupRemovedGeometry, PreviewData, SegmentCutsInfo } from './components/Preview2D'
import SParamChart, { SParamSeries } from './components/SParamChart'
import TaskPicker from './components/TaskPicker'
import {
  DEFAULT_TASKS,
  loadSavedTasks,
  makeFlags,
  saveTasks,
  type TaskKey,
} from './taskConfig'
import CascadeSchematic, { CascadeGraph } from './components/CascadeSchematic'
import ReportCenter from './components/ReportCenter'
import ReportSnapshotButton from './components/ReportSnapshotButton'
import { markReportSnapshotsStale } from './reportApi'

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
  nearest_obstacle?: { kind: string; label: string; net: string; layer: string } | null
}

type QualityThreshold = 'A' | 'B' | 'C'

/** 依 3D 複雜度分段的分析結果。段數是偵測結果，不是輸入。 */
interface ComplexityAnalysis {
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
  }[]
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

interface SegmentAnalysis {
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
  }[]
  cut_pairs: { cut_index: number; position_mm: number; pairs: string[][] }[]
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

type ViewMode = 'full' | 'cut' | 'cleanup' | 'segments' | 'schematic' | 'sparam' | 'eye' | 'report'

/** 量測容器實際高度，讓圖表填滿剩餘空間而不需捲動。
 *  分頁高度會隨視窗與 Allotment 分隔線改變，因此以 ResizeObserver 追蹤，
 *  不用 window.innerHeight 推算。 */
function useMeasuredHeight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    setHeight(element.clientHeight)
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setHeight(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, height] as const
}

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
type CleanupCompareMode = 'side-by-side' | 'before' | 'after' | 'overlay'

interface ExtFileInfo {
  path: string
  name: string
  n_ports: number
  port_names: string[]
}

interface ExtConn { a_file: number; a_port: string; b_file: number; b_port: string }
interface ExtShort { file: number; ports: string[] }

interface CutoutBoundaryComparison {
  available: boolean
  within_tolerance: boolean
  tolerance_mm: number
  max_boundary_error_mm: number | null
  area_difference_percent: number | null
}

interface CutoutBoundaryResult {
  estimated: number[][]
  actual: number[][]
  comparison: CutoutBoundaryComparison | null
}

/** 疊構／背鑽／清理會改動幾何，對已建好的元件端 Port 有風險。
 *
 *  Port 的負端綁在特定層與座標上，幾何一改就可能失去附著點；而失敗要等到
 *  求解時才會以 invalid port 出現。介面的流程順序已經把 Port 排在這三步
 *  之後，但那只是建議——使用者仍可照任意順序操作，所以套用前再擋一次。
 */
function PortWarning({ warning }: { warning: any }) {
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
      <b>這份 EDB 已有 {warning.count} 個元件端 Port。</b>
      {warning.message}
      {warning.names?.length > 0 && (
        <div style={{ marginTop: 3, opacity: 0.8 }}>
          例如：{warning.names.slice(0, 4).join('、')}
          {warning.count > 4 ? ' …' : ''}
        </div>
      )}
    </div>
  )
}

/** 裁切外框形狀的中文名稱。後端回傳的是 PyEDB 的英文代號。 */
const EXTENT_LABEL: Record<string, string> = {
  Conforming: '貼合走線（Conforming）',
  ConvexHull: '凸包（ConvexHull）',
  Bounding: '矩形（Bounding Box）',
}

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
  if (sec < 60) return `${Math.floor(sec)} 秒`
  const totalMin = Math.floor(sec / 60)
  if (totalMin < 60) return `${totalMin} 分 ${Math.floor(sec % 60)} 秒`
  const h = Math.floor(totalMin / 60)
  return `${h} 時 ${totalMin % 60} 分`
}

// 排程模擬：計算單一 job 的耗時（秒）。pending/skipped（沒開始求解）回傳 null。
// tick 是目前時間（epoch 秒），用來讓「求解中」的段即時跳動。
const jobElapsedSec = (job: any, tick: number): number | null => {
  if (!job.started_at) return null
  const end = job.status === 'running' ? tick : (job.finished_at ?? tick)
  return end - job.started_at
}

export default function App() {
  // ── 檔案與載入狀態 ──
  const [inputPath, setInputPath] = useState('')
  const [outputPath, setOutputPath] = useState('')
  // S 參數分頁：自動曲線（單端／差動、IL／RL／NEXT／FEXT）
  const [spMode, setSpMode] = useState<'single' | 'diff'>('diff')
  const [spKinds, setSpKinds] = useState<Record<string, boolean>>(
    { il: true, rl: true, next: false, fext: false })
  const [spData, setSpData] = useState<any | null>(null)
  const [spBusy, setSpBusy] = useState(false)
  const [spError, setSpError] = useState('')
  // 設定 Port 與求解器：只建立 Port 與 Setup，不執行裁切
  const [portsOutputPath, setPortsOutputPath] = useState('')
  // 6c 疊構更換
  const [stackupFilePath, setStackupFilePath] = useState('')
  const [stackupOutputPath, setStackupOutputPath] = useState('')
  const [stackupExportFormat, setStackupExportFormat] = useState<'xml' | 'csv' | 'json'>('xml')
  const [stackupDiff, setStackupDiff] = useState<any | null>(null)
  const [stackupConfirmRemoval, setStackupConfirmRemoval] = useState(false)
  // 6d 背鑽
  const [bdTargetStubMil, setBdTargetStubMil] = useState('5')
  const [bdDiameterIncMil, setBdDiameterIncMil] = useState('8')
  const [bdResult, setBdResult] = useState<any | null>(null)
  const [bdOutputPath, setBdOutputPath] = useState('')
  const [allNets, setAllNets] = useState<string[]>([])
  const [components, setComponents] = useState<ComponentInfo[]>([])

  // ── 網路選擇 ──
  const [signalNets, setSignalNets] = useState<string[]>([])
  const [refNets, setRefNets] = useState<string[]>([])
  const [filterText, setFilterText] = useState('')

  // ── 裁切與 Port 設定 ──
  const [expansionMm, setExpansionMm] = useState('2')
  // 預設「貼合走線」：凸包對斜向與彎折通道必然多包一大塊無關銅箔與 Via。
  // 貼合外框漏掉訊號時後端會自動回退凸包並通知，不會安靜地切壞。
  const [extentType, setExtentType] = useState('Conforming')
  const [actualCutoutExtentType, setActualCutoutExtentType] = useState('')
  const [preciseBoundaryPreview, setPreciseBoundaryPreview] = useState<number[][] | null>(null)
  const [preciseBoundaryPreviewKey, setPreciseBoundaryPreviewKey] = useState('')
  /** 貼合外框比凸包少包多少面積（%）；只有 Conforming 預檢成功時才有值。 */
  const [boundaryAreaSaving, setBoundaryAreaSaving] = useState<number | null>(null)
  const [completedBoundary, setCompletedBoundary] = useState<CutoutBoundaryResult | null>(null)
  const [showCutoutDifferenceFill, setShowCutoutDifferenceFill] = useState(true)
  const [portType, setPortType] = useState('coax')
  const [checkedComps, setCheckedComps] = useState<Record<string, boolean>>({})
  const [cutoutJobId, setCutoutJobId] = useState('')
  const [cutoutStopping, setCutoutStopping] = useState(false)

  // ── 模擬設定（HFSS 3D Layout／SIwave SYZ）──
  const [sweepType, setSweepType] = useState('Interpolating')
  const [sweeps, setSweeps] = useState([
    { distribution: 'Linear Count', start: '0Hz', end: '1Hz', value: '2' },
    { distribution: 'Log Scale', start: '1Hz', end: '100MHz', value: '20' },
    { distribution: 'Linear Step', start: '100MHz', end: '50GHz', value: '0.05GHz' }
  ])
  const [solutionFreq, setSolutionFreq] = useState('25')
  const [errorTolerance, setErrorTolerance] = useState('0.1')
  const [maxPasses, setMaxPasses] = useState('20')
  const [maxDeltaS, setMaxDeltaS] = useState('0.02')
  const [maxRefinementPerPass, setMaxRefinementPerPass] = useState('15')
  const [minConvergedPasses, setMinConvergedPasses] = useState('2')
  // HFSS 網格方法：EDB 無此設定，求解時由 PyAEDT 套用；隨 segments.json 保存
  const [hfssMeshMethod, setHfssMeshMethod] = useState<'Phi' | 'PhiPlus' | 'Classic'>('PhiPlus')
  // Ansys BKM：自適應方式與平行自適應區
  const [adaptiveMode, setAdaptiveMode] = useState<'broadband' | 'multi' | 'single'>('broadband')
  const [parallelRefinement, setParallelRefinement] = useState(true)
  const [solverCores, setSolverCores] = useState('4')
  const [solverMemoryPercent, setSolverMemoryPercent] = useState('90')
  const [solverResourcePreview, setSolverResourcePreview] = useState<any>(null)

  // ── Layout 保守清理 ──
  const [cleanupGuardMm, setCleanupGuardMm] = useState('2')
  const [cleanupMode, setCleanupMode] = useState<'conservative' | 'em_field'>('conservative')
  const [cleanupIsolationDb, setCleanupIsolationDb] = useState('40')
  const [cleanupOutputPath, setCleanupOutputPath] = useState('')
  const [cleanupAnalysis, setCleanupAnalysis] = useState<CleanupAnalysis | null>(null)
  const [cleanupBeforeScene, setCleanupBeforeScene] = useState<PreviewData | null>(null)
  const [cleanupAfterScene, setCleanupAfterScene] = useState<PreviewData | null>(null)
  const [cleanupCompareMode, setCleanupCompareMode] = useState<CleanupCompareMode>('overlay')
  const [cleanupDiffKind, setCleanupDiffKind] = useState<'all' | 'primitive' | 'via'>('all')
  const [cleanupDiffLayer, setCleanupDiffLayer] = useState('')
  const [cleanupFocusRegion, setCleanupFocusRegion] = useState<number | null>(null)

  // ── N 段分割 ──
  const [nSegments, setNSegments] = useState('3')
  // 這次可以接受的切點評分。門檻越嚴候選越少，各段就越難平分。
  const [segmentQuality, setSegmentQuality] = useState<QualityThreshold>('B')
  /** 依複雜度分段的分析結果；與等分分段互斥，後分析的那個生效。 */
  const [complexityAnalysis, setComplexityAnalysis] =
    useState<ComplexityAnalysis | null>(null)
  const [segOutputDir, setSegOutputDir] = useState('')
  const [segAnalysis, setSegAnalysis] = useState<SegmentAnalysis | null>(null)
  const [segRun, setSegRun] = useState<SegmentRunResult | null>(null)
  const [activeSegIdx, setActiveSegIdx] = useState(0)
  const [showSegmentSafetyOverlay, setShowSegmentSafetyOverlay] = useState(true)
  const [showSolverRegionOverlay, setShowSolverRegionOverlay] = useState(true)
  const [segmentSolverPlans, setSegmentSolverPlans] = useState<SegmentSolverPlan[]>([])
  // 直接匯入分段模式：跳過裁切，載入的檔案直接進行 N 段分割
  const [directSegmentMode, setDirectSegmentMode] = useState(false)

  // ── 排程求解 ──
  // ── 入口介面：這次要用哪些項目 ──────────────────────
  const [enabledTasks, setEnabledTasks] = useState<TaskKey[]>(
    () => loadSavedTasks() ?? DEFAULT_TASKS)
  // 每次啟動都先顯示入口（帶出上次勾選），按「開始」才進主畫面。
  const [pickerOpen, setPickerOpen] = useState(true)
  const [pickerReturning, setPickerReturning] = useState(false)
  const show = makeFlags(enabledTasks)
  // 「模擬設定」被四個任務共用，任一個勾了就要顯示。
  // 裁切已不再建立 Port／Setup（見 create_ports），所以「模擬設定」不再跟
  // show.cutout 綁定；只有真的會用到 Setup 的任務才需要它。
  const showSolverSetup = show.ports || show.segment || show.schedule

  // 「直接匯入分段」完全由入口的「局部裁切」決定，不需要使用者再勾一次：
  // 要裁切 → 載入的是整片板、之後才切；不裁切 → 載入的檔案本身就是通道，
  // 直接進分段。「設定 Port 與求解器」與這個判斷無關（Port 兩種情況都可能要建）。
  const forcedDirectSegment = !show.cutout

  useEffect(() => {
    setDirectSegmentMode(prev =>
      prev === forcedDirectSegment ? prev : forcedDirectSegment)
  }, [forcedDirectSegment])

  const [schedMetaPath, setSchedMetaPath] = useState('')
  // 遠端求解包：打包 SIwave 段，複製到求解機雙擊執行
  const [packDir, setPackDir] = useState('')
  // segments.json 一確定就帶出建議輸出資料夾；使用者已填則不覆蓋。
  useEffect(() => {
    if (!schedMetaPath) return
    setPackDir(prev => prev || suggestPackDir(schedMetaPath))
  }, [schedMetaPath])
  const [packBusy, setPackBusy] = useState(false)
  // 收檔：把求解機跑出來的 Touchstone 收回 segments.json
  const [ingestDir, setIngestDir] = useState('')
  const [ingestBusy, setIngestBusy] = useState(false)
  const [schedStatus, setSchedStatus] = useState<any | null>(null)

  // ── 電路串接 ──
  const [cascadeResult, setCascadeResult] = useState<any | null>(null)
  const [cascadeBusy, setCascadeBusy] = useState(false)
  const [cascPortA, setCascPortA] = useState('')
  const [cascPortB, setCascPortB] = useState('')
  const [cascSeries, setCascSeries] = useState<SParamSeries[]>([])
  const [chartExpanded, setChartExpanded] = useState(false)
  const [cascadeMode, setCascadeMode] = useState<'tool' | 'external'>('tool')
  const [schematicGraph, setSchematicGraph] = useState<CascadeGraph | null>(null)
  const [circuitBusy, setCircuitBusy] = useState(false)
  const circuitBusyRef = useRef(false)
  const [circuitExportMode, setCircuitExportMode] = useState<'complete' | 'segments'>('complete')
  const [circuitResult, setCircuitResult] = useState<any | null>(null)
  const [circuitError, setCircuitError] = useState('')
  const [eyeSuggestion, setEyeSuggestion] = useState<any | null>(null)
  const [eyeSuggestionError, setEyeSuggestionError] = useState('')
  const [eyeSuggestionRevision, setEyeSuggestionRevision] = useState(0)
  const [eyeMode, setEyeMode] = useState<'single' | 'differential'>('differential')
  const [eyeDataRate, setEyeDataRate] = useState('1')
  const [eyeRiseTime, setEyeRiseTime] = useState('200')
  const [eyeInputP, setEyeInputP] = useState('')
  const [eyeInputN, setEyeInputN] = useState('')
  const [eyeOutputP, setEyeOutputP] = useState('')
  const [eyeOutputN, setEyeOutputN] = useState('')
  // 一鍵眼圖背景工作：輪詢狀態，完成後在「眼圖」分頁顯示 AEDT 產的 JPG
  const [eyeJob, setEyeJob] = useState<any | null>(null)
  const [eyeImageRevision, setEyeImageRevision] = useState(0)
  const [spChartRef, spChartHeight] = useMeasuredHeight<HTMLDivElement>()
  // 外部檔案接線模式
  const [extFiles, setExtFiles] = useState<ExtFileInfo[]>([])
  const [extConns, setExtConns] = useState<ExtConn[]>([])
  const [extShorts, setExtShorts] = useState<ExtShort[]>([])
  // 純粹用來讓「求解中」的段耗時每秒跳動；不打 API，只觸發重繪
  const [nowTick, setNowTick] = useState(() => Date.now() / 1000)

  useEffect(() => {
    if (sweeps.length > 0) {
      const startGHz = parseFreqToGHz(sweeps[0].start);
      const endGHz = parseFreqToGHz(sweeps[sweeps.length - 1].end);
      if (endGHz > startGHz) {
        setSolutionFreq(((endGHz - startGHz) / 2).toString());
      } else if (endGHz > 0) {
        setSolutionFreq((endGHz / 2).toString());
      }
    }
  }, [sweeps])

  // ── 預覽場景 ──
  const [fullScene, setFullScene] = useState<PreviewData | null>(null)
  const [cutScene, setCutScene] = useState<PreviewData | null>(null)
  const [activeView, setActiveView] = useState<ViewMode>('full')
  // 報告工作區一旦定下來就固定，並記住到下一次開啟。
  //
  // 它原本每次都由「目前載入的檔案」重新推導，於是同一個案子只要換個匯入來源
  // ——載入板子、改看串接後的 .sNp、指向另一份 segments.json——就各自長出一個
  // report_workspace，快照散在好幾個資料夾裡，事後根本找不到是哪一個。
  // 要換位置仍然可以，在報告中心的工作區欄位改就好。
  const [reportWorkspace, setReportWorkspace] = useState(loadReportWorkspace)
  const rememberReportWorkspace = (value: string) => {
    setReportWorkspace(value)
    saveReportWorkspace(value)
  }

  // 是否可進行分段：裁切完成、或直接匯入分段模式已載入
  const canSegment = !!cutScene || (directSegmentMode && allNets.length > 0)

  /** 後端 session 目前開著的那個檔。每個會另存新檔的步驟完成後都要更新。
   *
   *  各步驟的「輸出路徑」建議名要一律從這裡長出來。之前每一步各自猜自己的
   *  基準（背鑽用 outputPath＝裁切的輸出），結果「裁切→換疊構→背鑽」產生的
   *  檔名是 ..._Cutout_backdrill，把中間的疊構更換整個吃掉——檔名是這條加工鏈
   *  唯一的紀錄，漏一環之後就分不出哪個檔套過疊構。 */
  const [workingPath, setWorkingPath] = useState('')
  // 疊構更換屬於「準備」階段（載入的子項），必須在裁切之前就能用——換疊構會
  // 改變層厚與層數，裁切與 Port 都得建立在最終疊構上。因此它的門檻是「板子
  // 載入了」，不是「裁切完成了」。
  const boardLoaded = !!fullScene || allNets.length > 0

  // ── UI 狀態 ──
  const [logs, setLogs] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('處理中…')
  const [showLogs, setShowLogs] = useState(true)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const logBoxRef = useRef<HTMLDivElement | null>(null)
  // 載入遮罩內的日誌尾巴用獨立 ref：遮罩顯示時把系統日誌整個蓋住，使用者在
  // 長時間操作（例如讀取大型 EDB）期間看不到任何進度，只能乾等一個籠統的
  // 訊息。這個 ref 對應的框在遮罩顯示時才存在，所以需要自己的自動捲動邏輯。
  const loadingLogBoxRef = useRef<HTMLDivElement | null>(null)
  const signalFileRef = useRef<HTMLInputElement | null>(null)

  // 新日誌進來時自動捲到最底；使用者往上捲閱讀時不打擾
  useEffect(() => {
    const box = logBoxRef.current
    if (!box) return
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60
    if (nearBottom) box.scrollTop = box.scrollHeight
  }, [logs])

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
      ws.onmessage = (event) => setLogs(prev => [...prev, event.data])
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
  const api = async (url: string, body?: any) => {
    const res = await fetch(url, body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    // 後端在極少數情況會回非 JSON 內容（例如回應序列化失敗時，Starlette
    // 會回純文字 "Internal Server Error"）。直接 res.json() 會拋出
    // 「Unexpected token」這種對使用者毫無意義的訊息，掩蓋真正的錯誤，
    // 故改為先取文字再嘗試解析。
    const text = await res.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      if (!res.ok) {
        throw new Error(`伺服器錯誤（HTTP ${res.status}）：${text.slice(0, 300)}`)
      }
      throw new Error(`伺服器回應格式錯誤（非 JSON）：${text.slice(0, 300)}`)
    }
    if (!res.ok) throw new Error(data?.detail || res.statusText)
    return data
  }

  const confirmOutputOverwrite = async (
    path: string,
    actionLabel: string,
  ): Promise<boolean | null> => {
    const status = await api('/api/output_path/status', { path })
    if (!status.exists) return false
    const targets = (status.targets as string[]).map(target => `• ${target}`).join('\n')
    const accepted = confirm(
      `警告：${actionLabel}的輸出已存在。\n\n`
      + `${targets}\n\n`
      + '繼續後會先永久刪除上述既有輸出，再建立新結果；此動作無法復原。'
      + '確定要覆寫嗎？',
    )
    return accepted ? true : null
  }

  useEffect(() => {
    const controller = new AbortController()
    const cores = parseInt(solverCores, 10) || 4
    const memory = parseInt(solverMemoryPercent, 10) || 90
    fetch(`/api/system/solver_resources?num_cores=${cores}&memory_percent=${memory}`, {
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data) setSolverResourcePreview(data) })
      .catch(() => {})
    return () => controller.abort()
  }, [solverCores, solverMemoryPercent])

  const handleBrowseInput = async () => {
    try {
      const data = await api('/api/browse_input')
      if (data.path) {
        setInputPath(data.path)
        setOutputPath(stripExtension(data.path) + '_Cutout.aedb')
      }
    } catch (e) { console.error(e) }
  }

  const handleBrowseOutput = async () => {
    try {
      const data = await api('/api/browse_output')
      if (data.path) setOutputPath(data.path)
    } catch (e) { console.error(e) }
  }

  // 分隔線位置：讀一次當初始值，之後每次拖曳就記起來當下次的預設。
  // useState 的初值只在第一次 render 取用，所以不需要 useMemo。
  const [splitSizes] = useState(loadMainSplit)
  const [logSplitSizes] = useState(loadLogSplit)
  const saveSplitSizes = (sizes: number[]) => saveMainSplit(sizes)
  const saveLogSplitSizes = (sizes: number[]) => saveLogSplit(sizes)

  /** 上一次自動填進各輸出路徑欄位的建議值；用來分辨「使用者自己改過」。 */
  const autoSuggested = useRef<Record<string, string>>({})

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
      if (data.path) { setStackupFilePath(data.path); setStackupDiff(null) }
    } catch (e) { console.error(e) }
  }

  const applyLoadResult = (data: any, path: string) => {
    setAllNets(data.nets)
    setComponents(data.components || [])
    setSignalNets([])
    // 自動建議參考網路（GND / VSS / GROUND，精確匹配優先）
    setRefNets(suggestReferenceNets(data.nets as string[]))
    setCheckedComps({})
    setCutScene(null)
    setActualCutoutExtentType('')
    setPreciseBoundaryPreview(null)
    setPreciseBoundaryPreviewKey('')
    setCompletedBoundary(null)
    setCleanupAnalysis(null)
    setCleanupBeforeScene(null)
    setCleanupAfterScene(null)
    setSegAnalysis(null)
    setSegRun(null)
    setActiveView('full')
    if (path) {
      setInputPath(path)
      setCleanupOutputPath(path.replace(/\.aedb$/i, '') + '_cleaned.aedb')
      if (!outputPath) setOutputPath(stripExtension(path) + '_Cutout.aedb')
    }
  }

  const handleLoadFile = async () => {
    if (!inputPath) { alert('請輸入檔案路徑'); return }
    setLoadingMsg(directSegmentMode
      ? '載入檔案中（不裁切，直接作為通道）…'
      : '載入 EDB 檔案中，大型檔案可能需要數分鐘…')
    setIsLoading(true)
    try {
      const started = await api('/api/load', { path: inputPath, for_segmentation: directSegmentMode })
      const jobId = started.job_id as string
      let data: any = null
      let transientErrors = 0
      while (!data) {
        await new Promise(resolve => window.setTimeout(resolve, 2000))
        try {
          const state = await api(`/api/load/status?job_id=${encodeURIComponent(jobId)}`)
          transientErrors = 0
          const elapsed = state.started_at ? Math.max(0, Date.now() / 1000 - state.started_at) : 0
          setLoadingMsg(`${state.message || '背景載入中…'}（${state.progress || 0}%／${formatElapsed(elapsed)}）`)
          if (state.status === 'error') throw new Error(state.error || 'EDB 匯入工作失敗')
          if (state.status === 'done') data = state.result
        } catch (error) {
          transientErrors += 1
          if (transientErrors >= 3 || String(error).includes('匯入工作失敗')) throw error
        }
      }
      applyLoadResult(data, data.path || inputPath)
      const normalized = data.path || inputPath
      setWorkingPath(normalized)
      if (directSegmentMode) {
        // 直接分段模式：預設清理與分段輸出路徑，載入後可直接到「Layout 清理」／8
        setCleanupOutputPath(normalized.replace(/\.aedb$/i, '') + '_cleaned.aedb')
          // 「設定 Port 與求解器」的輸出（另存新檔，不覆寫使用者自己裁切好的來源）
        setPortsOutputPath(normalized.replace(/\.aedb$/i, '') + '_ports.aedb')
      } else {
        setOutputPath(stripExtension(normalized) + '_Cutout.aedb')
      }
      // Preview 已在同一個背景工作內完成，避免第二個長 HTTP 請求再次逾時。
      setFullScene(data.preview)
    } catch (e) {
      alert('載入失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleReloadOriginal = async () => {
    setLoadingMsg('重新載入原始檔中…')
    setIsLoading(true)
    try {
      const data = await api('/api/reload_original', {})
      applyLoadResult(data, '')
      const full = await api('/api/preview', { nets: [] })
      setFullScene(full)
    } catch (e) {
      alert('重新載入失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleCutout = async () => {
    if (signalNets.length === 0) { alert('請先選擇訊號網路'); return }
    if (refNets.length === 0) { alert('請先選擇參考網路（例如 GND）'); return }
    if (!outputPath) { alert('請設定輸出路徑'); return }
    const comps = Object.keys(checkedComps).filter(c => checkedComps[c])
    let overwriteExisting: boolean | null
    try {
      overwriteExisting = await confirmOutputOverwrite(outputPath, '裁切')
    } catch (e) {
      alert('無法檢查輸出路徑: ' + String(e)); return
    }
    if (overwriteExisting === null) return
    setLoadingMsg('裁切工作準備中…')
    setIsLoading(true)
    setCutoutStopping(false)
    try {
      const started = await api('/api/cutout', {
        signal_nets: signalNets,
        reference_nets: refNets,
        expansion_mm: parseFloat(expansionMm) || 2,
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
          const countText = state.total ? `／${state.processed || 0}/${state.total}` : ''
          setLoadingMsg(`${state.message || '背景裁切中…'}（${state.progress || 0}%${countText}／${formatElapsed(elapsed)}）`)
          if (state.status === 'error') {
            throw new Error(`${state.message || '裁切工作失敗'}${state.error ? `\n${state.error}` : ''}`)
          }
          if (state.status === 'cancelled') {
            setCutoutStopping(false)
            alert(state.message || '裁切工作已停止')
            return
          }
          if (state.status === 'done') data = state.result
        } catch (error) {
          transientErrors += 1
          if (transientErrors >= 3 || String(error).includes('裁切工作失敗')) throw error
        }
      }
      setCutScene(data.preview)
      const actualExtent = String(data.actual_extent_type || extentType)
      setActualCutoutExtentType(actualExtent)
      setCompletedBoundary({
        estimated: data.estimated_boundary_mm || [],
        actual: data.actual_boundary_mm || data.estimated_boundary_mm || [],
        comparison: data.boundary_comparison || null,
      })
      if (actualExtent !== extentType) {
        setExtentType(actualExtent)
        setPreciseBoundaryPreview(data.estimated_boundary_mm || null)
        setPreciseBoundaryPreviewKey(
          cutoutBoundaryKey(signalNets, refNets, expansionMm, actualExtent),
        )
        alert(`所選 ${EXTENT_LABEL[extentType] || extentType} 無法完成，`
          + `已安全回退為 ${EXTENT_LABEL[actualExtent] || actualExtent}。\n`
          + String(data.fallback_reason || ''))
      }
      setActiveView('cut')
      setWorkingPath(data.output_path)
      setCleanupAnalysis(null)
      setCleanupBeforeScene(null)
      setCleanupAfterScene(null)
      // 分段狀態重置與預設輸出資料夾
      setSegAnalysis(null)
      setSegRun(null)
    } catch (e) {
      alert('裁切失敗: ' + String(e))
    } finally {
      setCutoutJobId('')
      setCutoutStopping(false)
      setIsLoading(false)
    }
  }

  // 已裁切好的檔案：跳過裁切，只建立元件端 Port 與求解器設定。
  // 直接匯入模式若不做這一步，通道頭尾不會有元件端 Port，分段與求解都白做。
  const handlePortsSetup = async () => {
    if (signalNets.length === 0) { alert('請先選擇訊號網路'); return }
    if (refNets.length === 0) { alert('請先選擇參考網路（例如 GND）'); return }
    const comps = Object.keys(checkedComps).filter(c => checkedComps[c])
    if (comps.length === 0) { alert('請先勾選要建立 Port 的端點元件'); return }
    if (!portsOutputPath) { alert('請設定輸出路徑'); return }
    let overwriteExisting: boolean | null
    try {
      overwriteExisting = await confirmOutputOverwrite(portsOutputPath, 'Port 與求解器設定')
    } catch (e) {
      alert('無法檢查輸出路徑: ' + String(e)); return
    }
    if (overwriteExisting === null) return
    setLoadingMsg('建立 Port 工作準備中…')
    setIsLoading(true)
    setCutoutStopping(false)
    try {
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
          const countText = state.total ? `／${state.processed || 0}/${state.total}` : ''
          setLoadingMsg(`${state.message || '建立 Port 中…'}（${state.progress || 0}%${countText}／${formatElapsed(elapsed)}）`)
          if (state.status === 'error') {
            throw new Error(`${state.message || '建立 Port 失敗'}${state.error ? `\n${state.error}` : ''}`)
          }
          if (state.status === 'cancelled') {
            setCutoutStopping(false)
            alert(state.message || '建立 Port 工作已停止')
            return
          }
          if (state.status === 'done') data = state.result
        } catch (error) {
          transientErrors += 1
          if (transientErrors >= 3 || String(error).includes('建立 Port 失敗')) throw error
        }
      }
      setCutScene(data.preview)
      setCompletedBoundary(null)
      setActiveView('cut')
      setWorkingPath(data.output_path)
      setCleanupAnalysis(null)
      setCleanupBeforeScene(null)
      setCleanupAfterScene(null)
      setSegAnalysis(null)
      setSegRun(null)
      const names: string[] = data.component_port_names || []
      alert(
        `已建立 ${names.length} 個元件端 Port（元件 ${data.port_component_count} 個）。\n`
        + `輸出：${data.output_path}\n\n`
        + '接下來的 N 段分割與求解會使用這個新檔案。',
      )
    } catch (e) {
      alert('建立 Port 失敗: ' + String(e))
    } finally {
      setCutoutJobId('')
      setCutoutStopping(false)
      setIsLoading(false)
    }
  }

  // ── 6c 疊構更換 ─────────────────────────────────────
  const handleStackupExport = async () => {
    if (allNets.length === 0) { alert('請先載入 EDB'); return }
    const suggested = stripExtension(inputPath || 'stackup')
      + `_stackup.${stackupExportFormat}`
    setIsLoading(true); setLoadingMsg('匯出疊構…')
    try {
      const data = await api('/api/stackup/export',
        { output_path: suggested, file_format: stackupExportFormat })
      alert(`已匯出 ${data.layer_count} 層：
${data.output_path}`)
      if (!stackupFilePath) setStackupFilePath(data.output_path)
    } catch (e) {
      alert('疊構匯出失敗: ' + String(e))
    } finally { setIsLoading(false) }
  }

  const handleStackupAnalyze = async () => {
    if (!stackupFilePath) { alert('請先指定疊構檔'); return }
    setIsLoading(true); setLoadingMsg('比對疊構差異…')
    try {
      const data = await api('/api/stackup/analyze', { file_path: stackupFilePath })
      setStackupDiff(data)
      setStackupConfirmRemoval(false)
      suggestOutputPath('stackup', '_stackup.aedb',
                        stackupOutputPath, setStackupOutputPath)
    } catch (e) {
      setStackupDiff(null)
      alert('疊構分析失敗: ' + String(e))
    } finally { setIsLoading(false) }
  }

  const handleStackupApply = async () => {
    if (!stackupDiff) { alert('請先分析差異'); return }
    if (!stackupOutputPath) { alert('請設定輸出路徑'); return }
    if (stackupDiff.requires_confirmation && !stackupConfirmRemoval) {
      alert('此疊構檔會刪除既有層，請先勾選確認'); return
    }
    setLoadingMsg('疊構更換準備中…'); setIsLoading(true); setCutoutStopping(false)
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
          setLoadingMsg(`${state.message || '疊構更換中…'}（${state.progress || 0}%／${formatElapsed(elapsed)}）`)
          if (state.status === 'error') {
            throw new Error(`${state.message || '疊構更換失敗'}${state.error ? `
${state.error}` : ''}`)
          }
          if (state.status === 'cancelled') { alert(state.message || '疊構更換已停止'); return }
          if (state.status === 'done') data = state.result
        } catch (error) {
          transientErrors += 1
          if (transientErrors >= 3 || String(error).includes('疊構更換失敗')) throw error
        }
      }
      setCutScene(data.preview)
      setActiveView('cut')
      setWorkingPath(data.output_path)
      setStackupDiff(null)
      setSegAnalysis(null); setSegRun(null)
      alert(`疊構更換完成：${data.layer_count_before} 層 → ${data.layer_count_after} 層
`
        + `輸出：${data.output_path}
報告：${data.report_path}`)
    } catch (e) {
      alert('疊構更換失敗: ' + String(e))
    } finally {
      setCutoutJobId(''); setCutoutStopping(false); setIsLoading(false)
    }
  }

  // ── 6d 背鑽 ────────────────────────────────────────
  const handleBackdrillAnalyze = async () => {
    if (signalNets.length === 0) { alert('請先選擇訊號網路'); return }
    setIsLoading(true); setLoadingMsg('分析訊號 Via 殘樁…')
    try {
      const data = await api('/api/backdrill/analyze', {
        signal_nets: signalNets,
        target_stub_mil: parseFloat(bdTargetStubMil) || 5,
        diameter_increment_mil: parseFloat(bdDiameterIncMil) || 8,
      })
      setBdResult(data)
      suggestOutputPath('backdrill', '_backdrill.aedb',
                        bdOutputPath, setBdOutputPath)
    } catch (e) {
      setBdResult(null)
      alert('背鑽分析失敗: ' + String(e))
    } finally { setIsLoading(false) }
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
    if (!bdResult) { alert('請先分析'); return }
    if (!bdOutputPath) { alert('請設定輸出路徑'); return }
    setLoadingMsg('背鑽準備中…'); setIsLoading(true); setCutoutStopping(false)
    try {
      const started = await api('/api/backdrill/apply', {
        output_path: bdOutputPath, entries: bdResult.entries,
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
          setLoadingMsg(`${state.message || '背鑽中…'}（${state.progress || 0}%／${formatElapsed(elapsed)}）`)
          if (state.status === 'error') {
            throw new Error(`${state.message || '背鑽失敗'}${state.error ? `\n${state.error}` : ''}`)
          }
          if (state.status === 'cancelled') { alert(state.message || '背鑽已停止'); return }
          if (state.status === 'done') data = state.result
        } catch (error) {
          transientErrors += 1
          if (transientErrors >= 3 || String(error).includes('背鑽失敗')) throw error
        }
      }
      setCutScene(data.preview)
      setActiveView('cut')
      setWorkingPath(data.output_path)
      setBdResult(null)
      setSegAnalysis(null); setSegRun(null)
      alert(`背鑽完成：成功 ${data.applied_count} 段、失敗 ${data.failed_count} 段\n`
        + `輸出：${data.output_path}\n報告：${data.report_path}`)
    } catch (e) {
      alert('背鑽失敗: ' + String(e))
    } finally {
      setCutoutJobId(''); setCutoutStopping(false); setIsLoading(false)
    }
  }

  const handleStopCutout = async () => {
    if (!cutoutJobId || cutoutStopping) return
    setCutoutStopping(true)
    setLoadingMsg('已要求停止；等待目前 PyEDB 呼叫返回安全檢查點…')
    try {
      await api(`/api/cutout/stop?job_id=${encodeURIComponent(cutoutJobId)}`, {})
    } catch (e) {
      setCutoutStopping(false)
      alert('停止裁切失敗: ' + String(e))
    }
  }

  // ── Layout 保守清理 ────────────────────────────────────
  const applyCleanupRecommendedSettings = () => {
    setCleanupMode('em_field')
    setCleanupGuardMm('0.2')
    setCleanupIsolationDb('40')
    setCleanupAnalysis(null)
    setCleanupBeforeScene(null)
    setCleanupAfterScene(null)
  }

  const handleCleanupAnalyze = async () => {
    if (!canSegment) { alert('請先完成裁切，或在入口不勾「局部裁切」直接載入通道檔案'); return }
    if (signalNets.length === 0 || refNets.length === 0) {
      alert('請先選擇訊號與參考網路'); return
    }
    setLoadingMsg('分析 Layout 清理候選中…')
    setIsLoading(true)
    try {
      const data = await api('/api/cleanup/analyze', {
        signal_nets: signalNets,
        reference_nets: refNets,
        guard_mm: parseFloat(cleanupGuardMm) || 2,
        mode: cleanupMode,
        isolation_db: parseFloat(cleanupIsolationDb) || 40,
      })
      setCleanupAnalysis(data)
      setActiveView(cutScene ? 'cut' : 'full')
    } catch (e) {
      alert('Layout 清理分析失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleCleanupRun = async () => {
    if (!cleanupAnalysis) { alert('請先分析清理候選'); return }
    if (!cleanupOutputPath) { alert('請設定清理輸出路徑'); return }
    let overwriteExisting: boolean | null
    try {
      overwriteExisting = await confirmOutputOverwrite(cleanupOutputPath, 'Layout 清理')
    } catch (e) {
      alert('無法檢查輸出路徑: ' + String(e)); return
    }
    if (overwriteExisting === null) return
    setLoadingMsg('另存並清理 Layout 中，可能需要數分鐘…')
    setIsLoading(true)
    try {
      const beforeScene = cutScene || fullScene
      const data = await api('/api/cleanup/run', {
        signal_nets: signalNets,
        reference_nets: refNets,
        guard_mm: parseFloat(cleanupGuardMm) || 2,
        mode: cleanupMode,
        isolation_db: parseFloat(cleanupIsolationDb) || 40,
        output_path: cleanupOutputPath,
        overwrite_existing: overwriteExisting,
      })
      setCutScene(data.preview)
      setCleanupBeforeScene(beforeScene)
      setCleanupAfterScene(data.preview)
      setCleanupAnalysis(data)
      setCleanupCompareMode('overlay')
      setCleanupDiffKind('all')
      setCleanupDiffLayer('')
      setCleanupFocusRegion(null)
      setWorkingPath(data.output_path)
      setSegAnalysis(null)
      setSegRun(null)
      setActiveView('cleanup')
    } catch (e) {
      alert('Layout 清理失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  // ── N 段分割 ───────────────────────────────────
  /** manualCuts 為空＝用自動位置（「回到自動刀線」走的就是這條路）。 */
  const runComplexityAnalyze = async (
    manualCuts?: { axis: number; position_mm: number }[],
  ) => {
    if (!canSegment) { alert('請先完成裁切，或直接載入通道檔案'); return }
    if (signalNets.length === 0) { alert('請先於「選擇網路」選擇訊號網路'); return }
    setLoadingMsg(manualCuts?.length
      ? '依新的刀線位置重新評分中…'
      : '偵測 3D 複雜區並規劃切割位置中…')
    setIsLoading(true)
    try {
      const data: ComplexityAnalysis = await api(
        '/api/segment/analyze-complexity', {
          signal_nets: signalNets,
          reference_nets: refNets,
          quality_threshold: segmentQuality,
          cuts: manualCuts || [],
        })
      setComplexityAnalysis(data)
      setSegAnalysis(null)          // 兩種分析互斥，避免畫面同時出現兩組刀
      setActiveView('segments')
      // 拖曳時不彈視窗——面板上的紅字已經說明白了，每拖一次跳一個 modal
      // 只會讓人沒辦法連續微調。
      if (!data.feasible && !manualCuts?.length) {
        alert('無法產生可執行的分段：' + data.reason)
      }
    } catch (e) {
      alert('複雜度分段分析失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleComplexityAnalyze = () => runComplexityAnalyze()

  /** 在預覽圖上把某把刀拖到新位置：整份重算，等級與分段都會跟著更新。 */
  const handleCutDrag = (cutIndex: number, positionMm: number) => {
    if (!complexityAnalysis) return
    runComplexityAnalyze(complexityAnalysis.cuts.map((cut, index) => ({
      axis: cut.axis,
      position_mm: index === cutIndex ? positionMm : cut.position_mm,
    })))
  }

  const handleSegmentAnalyze = async () => {
    const n = parseInt(nSegments, 10)
    if (!canSegment) { alert('請先執行「局部裁切」，或勾選「直接匯入分段」後載入檔案'); return }
    if (signalNets.length === 0) { alert('請先於「選擇網路」 選擇訊號網路'); return }
    if (!n || n < 2) { alert('分段數 N 必須大於等於 2'); return }
    setLoadingMsg('分析切割位置中…')
    setIsLoading(true)
    try {
      const data = await api('/api/segment/analyze', {
        n_segments: n,
        signal_nets: signalNets,
        reference_nets: refNets,
        quality_threshold: segmentQuality,
        hfss_mesh_method: hfssMeshMethod,
      })
      setSegAnalysis(data)
      setComplexityAnalysis(null)
      setShowSegmentSafetyOverlay(true)
      setSegRun(null)
      setActiveView('segments')
    } catch (e) {
      alert('分段分析失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  // ── 遠端求解包 ──────────────────────────────────────
  // 求解機通常不能裝 Python、也未必有相同版本 AEDT，因此不走 PyAEDT 遠端，
  // 改成把 EDB 與 PowerShell 腳本打包成資料夾讓使用者複製過去執行。
  const handleBuildRemotePack = async () => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert('請先執行 N 段分割，或輸入 segments.json 路徑'); return }
    const outDir = normalizeUserPath(packDir)
    if (!outDir) { alert('請指定求解包輸出資料夾（需為新資料夾）'); return }
    setPackBusy(true)
    try {
      const res = await fetch('/api/remote/pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata_path: metadataPath,
          output_dir: outDir,
          sweep_type: sweepType,
          sweeps,
          error_tolerance_pct: parseFloat(errorTolerance) || 0.1,
          siwave_num_interp_points: 150,
          num_cores: parseInt(solverCores, 10) || 4,
          segment_indices: [],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || '求解包建立失敗')
      const packedTxt = (data.packed || [])
        .map((x: any) => `段 ${x.index}（${x.port_count} Port）`).join('、')
      const skippedTxt = (data.skipped || []).length
        ? '\n\n未包含：\n' + (data.skipped as any[])
            .map((x: any) => `  段 ${x.index}：${x.reason}`).join('\n')
        : ''
      alert(
        '求解包已建立：\n' + data.output_dir +
        '\n\n已包含：' + packedTxt + skippedTxt +
        '\n\n接著請：' +
        '\n1. 等複製完全結束後，把整個資料夾複製到求解機' +
        '\n2. 在求解機雙擊 run_all.bat' +
        '\n3. 跑完把 results 資料夾複製回來'
      )
      // 換成新的時間戳：同一個資料夾再匯出一次會被後端擋下。
      setPackDir(suggestPackDir(metadataPath))
    } catch (e: any) {
      alert('求解包建立失敗: ' + (e?.message || String(e)))
    } finally {
      setPackBusy(false)
    }
  }

  // 收回求解包結果：驗證 Port 數與格式後寫回 segments.json，
  // 之後串接與眼圖都能直接用，不必再走「外部 S 參數檔」。
  const handleIngestResults = async () => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert('請先執行 N 段分割，或輸入 segments.json 路徑'); return }
    const dir = normalizeUserPath(ingestDir)
    if (!dir) { alert('請指定求解結果資料夾（求解包資料夾或其中的 results）'); return }
    setIngestBusy(true)
    try {
      const res = await fetch('/api/remote/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata_path: metadataPath, results_path: dir }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || '收檔失敗')
      const okTxt = (data.ingested || [])
        .map((x: any) => `段 ${x.index}（${x.port_count} Port${x.stale ? '，已過期' : ''}）`)
        .join('、')
      const badTxt = (data.failed || []).length
        ? '\n\n驗證失敗：\n' + (data.failed as any[])
            .map((x: any) => `  段 ${x.index}：${x.reason}`).join('\n')
        : ''
      const missTxt = (data.missing || []).length
        ? '\n\n尚缺：段 ' + (data.missing as any[]).join('、')
        : ''
      alert('已收回：' + okTxt + badTxt + missTxt)
      await loadSegmentSolverPlan(metadataPath, false)
    } catch (e: any) {
      alert('收檔失敗: ' + (e?.message || String(e)))
    } finally {
      setIngestBusy(false)
    }
  }

  // ── 排程模擬：啟動 / 停止 / 輪詢 ──────────────────────
  const handleScheduleStart = async () => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert('請先執行 N 段分割，或輸入 segments.json 路徑'); return }
    setSchedMetaPath(metadataPath)
    try {
      let plans = segmentSolverPlans
      if (plans.length === 0) {
        const loaded = await loadSegmentSolverPlan(metadataPath, false)
        plans = loaded?.segments || []
      }
      const segmentSolvers = Object.fromEntries(
        plans.map((plan: SegmentSolverPlan) => [plan.index, plan.requested_solver])
      )
      const s = await api('/api/schedule/start', {
        metadata_path: metadataPath,
        solver: plans.length > 0 ? 'mixed' : 'hfss',
        segment_solvers: segmentSolvers,
        sweep_type: sweepType,
        sweeps,
        error_tolerance_pct: parseFloat(errorTolerance) || 0.1,
        siwave_num_interp_points: 150,
        hfss_mesh_method: hfssMeshMethod,
        num_cores: parseInt(solverCores, 10) || 4,
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
      alert('排程啟動失敗: ' + String(e))
    }
  }

  const handleScheduleStop = async () => {
    try {
      setSchedStatus(await api('/api/schedule/stop', {}))
    } catch (e) {
      alert('停止失敗: ' + String(e))
    }
  }

  const loadSegmentSolverPlan = async (metadataPath = schedMetaPath, showError = true) => {
    const path = normalizeUserPath(metadataPath)
    if (!path) return null
    try {
      const data = await api(`/api/schedule/plan?metadata_path=${encodeURIComponent(path)}`)
      setSegmentSolverPlans(data.segments || [])
      setShowSolverRegionOverlay(true)
      // 回寫分段當時使用的網格方法，避免重新載入後靜默改用預設值
      if (data.hfss_mesh_method) setHfssMeshMethod(data.hfss_mesh_method)
      return data
    } catch (error) {
      if (showError) alert('載入混合求解規劃失敗：' + String(error))
      return null
    }
  }

  const saveSegmentSolverPlans = async (plans: SegmentSolverPlan[]) => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) return
    setSegmentSolverPlans(plans)
    try {
      const data = await api('/api/schedule/plan', {
        metadata_path: metadataPath,
        assignments: plans.map(plan => ({
          index: plan.index,
          solver: plan.requested_solver,
        })),
      })
      setSegmentSolverPlans(data.segments || plans)
    } catch (error) {
      await loadSegmentSolverPlan(metadataPath, false)
      alert('儲存混合求解規劃失敗：' + String(error))
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
      && !confirm(`段 ${index} 的 3D 電磁複雜度為 ${current.complexity_score}，工具建議使用 HFSS。仍要改用 SIwave 嗎？`)
    ) return
    const next = segmentSolverPlans.map(plan => plan.index === index
      ? {
          ...plan,
          requested_solver: requestedSolver,
          overridden: requestedSolver !== plan.recommended_solver,
          result_stale: Boolean(plan.touchstone),
        }
      : plan)
    await saveSegmentSolverPlans(next)
  }

  const applySegmentSolverPreset = async (
    preset: 'recommended' | 'hfss' | 'siwave',
  ) => {
    if (
      preset === 'siwave'
      && segmentSolverPlans.some(plan => plan.recommended_solver === 'hfss')
      && !confirm('部分段落因 3D 結構複雜而建議 HFSS。確定全部改用 SIwave 嗎？')
    ) return
    const next = segmentSolverPlans.map(plan => {
      const requested = preset === 'recommended' ? plan.recommended_solver : preset
      return {
        ...plan,
        requested_solver: requested,
        overridden: requested !== plan.recommended_solver,
        result_stale: plan.requested_solver !== requested && Boolean(plan.touchstone),
      }
    })
    await saveSegmentSolverPlans(next)
  }

  const handlePreciseBoundaryPreview = async () => {
    if (signalNets.length === 0) { alert('請先選擇訊號網路'); return }
    if (refNets.length === 0) { alert('請先選擇參考網路（例如 GND）'); return }
    setLoadingMsg('以 PyEDB 正式裁切演算法分析精確外框…')
    setIsLoading(true)
    try {
      const data = await api('/api/cutout/preview_boundary', {
        signal_nets: signalNets,
        reference_nets: refNets,
        expansion_mm: parseFloat(expansionMm) || 2,
        extent_type: extentType,
      })
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
          `PyEDB 預檢顯示 ${EXTENT_LABEL[extentType] || extentType} 無法使用，`
          + `精確預覽已改為 ${EXTENT_LABEL[actualExtent] || actualExtent}。\n`
          + String(data.fallback_reason || ''),
        )
      }
    } catch (e) {
      alert('精確裁切外框分析失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleRetryTouchstoneExports = async (segmentIndex?: number) => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert('請先提供 segments.json 路徑'); return }
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
      alert('Touchstone 重新匯出啟動失敗: ' + String(e))
    }
  }

  // ── 電路串接 ───────────────────────────────────
  const CASC_COLORS = ['#00e5ff', '#7ee787', '#ff8c00', '#e040fb', '#ffd600', '#ff5252']

  const handleCascadeRun = async () => {
    if (circuitBusyRef.current) {
      alert('Circuit／QuickEye 處理中，請完成後再重新串接。')
      return
    }
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert('請先完成 N 段分割與排程模擬（需要 segments.json）'); return }
    setSchedMetaPath(metadataPath)
    setCascadeBusy(true)
    try {
      const data = await api('/api/cascade/run', { metadata_path: metadataPath, output_path: '' })
      setCascadeResult(data)
      setCascSeries([])
      if (data.port_names?.length >= 2) {
        setCascPortA(data.port_names[0])
        setCascPortB(data.port_names[1])
      }
    } catch (e) {
      alert('電路串接失敗: ' + String(e))
    } finally {
      setCascadeBusy(false)
    }
  }

  /** 單一外部 .sNp 直接當結果看，不接線。
   *
   *  整片板子一次解完拿到的檔就是這種——沒有段可接，但要看的東西（差動
   *  IL／RL／NEXT／FEXT）與串接結果完全相同。 */
  const handleLoadExternalSparam = async (path: string) => {
    if (!path) { alert('請先加入一個 S 參數檔'); return }
    setCascadeBusy(true)
    try {
      const data = await api('/api/cascade/load_external', { path })
      setCascadeResult(data)
      setCascSeries([])
      if (data.port_names?.length >= 2) {
        setCascPortA(data.port_names[0])
        setCascPortB(data.port_names[1])
      }
      setActiveView('sparam')
      if (!data.auto.ok) {
        alert('已載入，但無法自動判定 Port 角色：' + data.auto.reason
          + '\n\n單端檢視仍可用；差動自動曲線需要檔頭有「! Port[n] = 名稱」'
          + '註解，且正負端命名對稱（例如 …TXP… / …TXN…）。')
      }
    } catch (e) {
      alert('載入 S 參數檔失敗: ' + String(e))
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
    if (!curves.length) { alert('圖上沒有曲線可以匯出'); return }
    setSpExporting(true)
    try {
      const data = await api('/api/cascade/export_excel', {
        series: curves.map(c => ({ label: c.label, freq: c.freq, db: c.db })),
        mode: spMode,
        near: spData?.near || '',
        far: spData?.far || '',
        source: cascadeResult?.output_path || '',
      })
      alert(`已匯出 ${data.series_count} 條曲線：
${data.output_path}`)
    } catch (e) {
      alert('匯出 Excel 失敗: ' + String(e))
    } finally {
      setSpExporting(false)
    }
  }

  const handleCascadeExportAs = async () => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) return
    try {
      const selected = await api('/api/browse_touchstone_output')
      if (!selected.path) return
      setCascadeBusy(true)
      const data = await api('/api/cascade/run', {
        metadata_path: metadataPath,
        output_path: selected.path,
      })
      setCascadeResult(data)
      alert(`完整 Touchstone 已輸出：\n${data.output_path}\n\n串接摘要：\n${data.summary_path}`)
    } catch (e) {
      alert('Touchstone 輸出失敗: ' + String(e))
    } finally {
      setCascadeBusy(false)
    }
  }

  const handleCircuitExport = async () => {
    if (circuitBusyRef.current || cascadeBusy) return
    if (!cascadeResult?.output_path) {
      alert('請先完成電路串接並產生完整 Touchstone。')
      return
    }
    if (circuitExportMode === 'segments' && cascadeMode !== 'tool') {
      alert('N 段展示模式只適用於本工具分段結果。')
      return
    }
    if (circuitExportMode === 'segments' && !normalizeUserPath(schedMetaPath)) {
      alert('分段展示模式需要本工具產生的 segments.json。')
      return
    }
    circuitBusyRef.current = true
    setCircuitBusy(true)
    try {
      const selected = await api('/api/browse_circuit_output')
      if (!selected.path) return
      if (!confirm(
        `將啟動獨立的 AEDT Circuit，建立「${
          circuitExportMode === 'segments' ? 'N 段展示' : '完整通道'
        }」專案但不求解。\n\n輸出：${selected.path}\n\n是否繼續？`,
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
      alert(`PyAEDT Circuit 專案已輸出：\n${data.output_path}`)
    } catch (e) {
      setCircuitError(String(e))
      alert('Circuit 輸出失敗：' + String(e))
    } finally {
      circuitBusyRef.current = false
      setCircuitBusy(false)
    }
  }

  const handleQuickEye = async () => {
    if (circuitBusyRef.current || cascadeBusy) return
    if (!cascadeResult?.output_path || !eyeSuggestion?.quick_eye_supported) {
      alert(eyeSuggestion?.note || '請先產生 2-Port 或 4-Port 完整 Touchstone。')
      return
    }
    const dataRate = Number(eyeDataRate)
    const riseTime = Number(eyeRiseTime)
    if (!(dataRate > 0) || !(riseTime > 0)) {
      alert('資料速率與上升時間必須大於 0。')
      return
    }
    const selectedPorts = eyeMode === 'differential'
      ? [eyeInputP, eyeInputN, eyeOutputP, eyeOutputN]
      : [eyeInputP, eyeOutputP]
    if (selectedPorts.some(port => !port) || new Set(selectedPorts).size !== selectedPorts.length) {
      alert('QuickEye 的輸入／輸出 Port 必須完整且不可重複。')
      return
    }
    const mapping = eyeMode === 'differential'
      ? `${eyeInputP}／${eyeInputN} → ${eyeOutputP}／${eyeOutputN}`
      : `${eyeInputP} → ${eyeOutputP}`
    if (!confirm(
      `請確認 QuickEye 設定：\n` +
      `模式：${eyeMode === 'differential' ? '差動' : '單端'}\n` +
      `資料速率：${dataRate} Gbps\n` +
      `上升／下降時間：${riseTime} ps\n` +
      `Port：${mapping}\n\n確認後才會建立並求解 Circuit。`,
    )) return
    circuitBusyRef.current = true
    setCircuitBusy(true)
    try {
      // 一鍵眼圖：不再要求選輸出路徑，後端自動放在 Touchstone 同層的
      // eye_results；背景求解後由輪詢取回結果並切到「眼圖」分頁。
      setCircuitResult(null)
      setCircuitError('')
      setEyeImageRevision(0)
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
        num_cores: Number(solverCores) || 4,
      })
      setActiveView('eye')
    } catch (e) {
      setCircuitError(String(e))
      alert('眼圖啟動失敗：' + String(e))
      circuitBusyRef.current = false
      setCircuitBusy(false)
    }
  }

  const handleCascadeModeChange = (mode: 'tool' | 'external') => {
    if (circuitBusyRef.current || cascadeBusy || mode === cascadeMode) return
    setCascadeMode(mode)
    setCascadeResult(null)
    setSchematicGraph(null)
    setCascSeries([])
    setCircuitResult(null)
    setCircuitError('')
    setEyeSuggestion(null)
    setEyeSuggestionError('')
  }

  // 串接預覽（本工具模式）：只讀 segments.json，解算前即可看接線示意圖
  const handleCascadePreview = async () => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert('請先完成 N 段分割（需要 segments.json）'); return }
    setSchedMetaPath(metadataPath)
    try {
      const g = await api('/api/cascade/preview', { metadata_path: metadataPath })
      setSchematicGraph(g)
      setActiveView('schematic')
    } catch (e) {
      alert('預覽失敗: ' + String(e))
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
      alert('檔案解析失敗: ' + String(e))
    }
  }

  const handleExtSuggest = async () => {
    if (extFiles.length < 2) { alert('請先加入至少兩個 S 參數檔'); return }
    try {
      const info = await api('/api/cascade/inspect_files', { paths: extFiles.map(f => f.path) })
      const s = info.suggestions
      setExtConns(s.connections)
      setExtShorts(s.shorts)
      if (s.connections.length === 0) {
        alert('無法自動建議（Port 名稱不符合本工具慣例且無同名 Port），請手動加入接線。')
      }
    } catch (e) {
      alert('自動建議失敗: ' + String(e))
    }
  }

  // 外部檔案：本地建立示意圖（不打後端）
  const handleExtPreview = () => {
    if (extFiles.length === 0) return
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
    if (circuitBusyRef.current) {
      alert('Circuit／QuickEye 處理中，請完成後再重新串接。')
      return
    }
    if (extFiles.length < 2) { alert('請先加入至少兩個 S 參數檔'); return }
    if (extConns.length === 0) { alert('請先加入接線（或按「自動建議接線」）'); return }
    setCascadeBusy(true)
    try {
      const data = await api('/api/cascade/run_custom', {
        files: extFiles.map(f => f.path),
        connections: extConns,
        shorts: extShorts,
        output_path: '',
      })
      setCascadeResult(data)
      setCascSeries([])
      if (data.port_names?.length >= 2) {
        setCascPortA(data.port_names[0])
        setCascPortB(data.port_names[1])
      }
    } catch (e) {
      alert('電路串接失敗: ' + String(e))
    } finally {
      setCascadeBusy(false)
    }
  }

  // S 參數分頁：向後端要自動曲線（近端／遠端與差動配對由 Port 名稱推斷）
  const loadSparamCurves = async (mode: 'single' | 'diff') => {
    setSpBusy(true); setSpError('')
    try {
      const data = await api('/api/cascade/auto_curves',
        { mode, include_xtalk: true })
      setSpData(data)
    } catch (e) {
      setSpData(null)
      setSpError(String(e))
    } finally {
      setSpBusy(false)
    }
  }

  // 切到 S 參數分頁或改變模式時自動載入
  useEffect(() => {
    if (activeView !== 'sparam' || !cascadeResult) return
    loadSparamCurves(spMode)
  }, [activeView, spMode, cascadeResult])

  const handleCascadeAddCurve = async () => {
    if (!cascPortA || !cascPortB) return
    try {
      const data = await api('/api/cascade/plot', { port_a: cascPortA, port_b: cascPortB })
      setCascSeries(prev => {
        if (prev.some(s => s.label === data.label)) return prev
        const color = CASC_COLORS[prev.length % CASC_COLORS.length]
        return [...prev, { label: data.label, color, freq: data.freq_ghz, db: data.db }]
      })
    } catch (e) {
      alert('取得曲線失敗: ' + String(e))
    }
  }

  // 一鍵眼圖：啟動後輪詢背景工作，完成或失敗時解除忙碌旗標並更新圖片
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const state = await api('/api/circuit/quick_eye/status')
        if (cancelled) return
        setEyeJob(state)
        if (!state.running && (state.status === 'done' || state.status === 'error')) {
          circuitBusyRef.current = false
          setCircuitBusy(false)
          if (state.status === 'done') {
            setCircuitResult(state.result)
            setEyeImageRevision(Date.now())   // 避免瀏覽器沿用舊圖快取
          } else if (state.error) {
            setCircuitError(state.error)
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
    if (!chartExpanded) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChartExpanded(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [chartExpanded])

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
          setEyeSuggestionError('無法讀取 Touchstone Port 建議；請確認檔案仍存在後重試。')
        }
      })
    return () => { cancelled = true }
  }, [cascadeResult, eyeSuggestionRevision])

  useEffect(() => {
    if (cascadeMode !== 'tool') {
      setCircuitExportMode('complete')
    }
  }, [cascadeMode])

  // 排程執行中每秒觸發重繪，讓「求解中」的段耗時平滑跳動（不打 API）
  useEffect(() => {
    if (!schedStatus?.running) return
    const t = window.setInterval(() => setNowTick(Date.now() / 1000), 1000)
    return () => window.clearInterval(t)
  }, [schedStatus?.running])

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
        if (!cancelled) setSchedStatus(s)
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

  const handleComplexityRun = async () => {
    if (!complexityAnalysis?.feasible) {
      alert('請先完成可執行的複雜度分析'); return
    }
    if (!segOutputDir) { alert('請設定分段輸出資料夾'); return }
    setLoadingMsg(
      `執行 ${complexityAnalysis.segments.length} 段分割中，每段需要重新裁切…`)
    setIsLoading(true)
    try {
      const data = await api('/api/segment/run', {
        signal_nets: signalNets,
        reference_nets: refNets,
        cuts: complexityAnalysis.cuts.map(cut => ({
          axis: cut.axis, position_mm: cut.position_mm,
        })),
        output_dir: segOutputDir,
        quality_threshold: segmentQuality,
      })
      setSegRun(data)
      setActiveSegIdx(-1)
      setActiveView('segments')
      setSchedMetaPath(data.metadata_path || '')
    } catch (e) {
      alert('依複雜度分段執行失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  /** 不分割：整條通道當成一段，直接產生 segments.json。
   *
   *  分段是為了讓大通道分頭求解，但常常只是想知道「整片解出來長什麼樣」
   *  ——當作分段結果的基準，或通道本來就小到不必切。這條路徑不需要先分析
   *  切割位置，也不會建立任何切面 Port。 */
  const handleSingleSegmentRun = async () => {
    if (!canSegment) { alert('請先完成裁切，或以直接分段模式載入通道檔案'); return }
    if (!segOutputDir) { alert('請設定輸出資料夾'); return }
    if (!signalNets.length) { alert('請先選擇訊號網路'); return }
    setLoadingMsg('建立不分割求解設定中…')
    setIsLoading(true)
    try {
      const data = await api('/api/segment/run-single', {
        signal_nets: signalNets,
        reference_nets: refNets,
        output_dir: segOutputDir,
      })
      setSegRun(data)
      setActiveSegIdx(-1)
      setActiveView('segments')
      setSchedMetaPath(data.metadata_path || '')
      setSegmentSolverPlans((data.segments || []).map((segment: any) => ({
        index: segment.index,
        path: segment.path,
        ...(segment.solver_plan || {}),
      })))
      setShowSolverRegionOverlay(false)
    } catch (e) {
      alert('不分割設定失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSegmentRun = async () => {
    if (!segAnalysis) { alert('請先分析切割位置'); return }
    if (!segOutputDir) { alert('請設定分段輸出資料夾'); return }
    if (!segAnalysis.threshold_feasible) {
      const looser = segAnalysis.threshold_report.filter(r => r.feasible)
      alert(looser.length
        ? `以 ${segAnalysis.quality_threshold} 級為門檻找不到可行的切點組合。`
          + `放寬到 ${looser.map(r => `${r.grade} 級（最大段 ${r.max_segment_mm!.toFixed(1)} mm）`).join('、')}`
          + `可行，請改選「可接受評分」後重新分析。`
        : `即使放寬到 C 級也找不到可行的切點組合，請降低分段數 N 後重新分析。`)
      return
    }
    if (!segAnalysis.requested_safe || segAnalysis.cuts.some(c => c.hard_blocked)) {
      alert(`硬性安全閘門未通過，不能執行 ${segAnalysis.n_segments} 段分割。此 Layout 最多只能安全切成 ${segAnalysis.max_safe_segments} 段，請降低 N 後重新分析。`)
      return
    }
    if (segAnalysis.balance_warning
        && !confirm(`${segAnalysis.balance_warning}\n\n分段是逐段依序求解，總時間與記憶體由最大段決定，差距過大等於沒有加速效果。仍要繼續執行嗎？`)) {
      return
    }
    if (segAnalysis.cuts.some(c => !c.valid || c.clearance_ok === false || c.poly_hit || c.risk_hit)) {
      if (!confirm('部分切割位置有警告（交點不唯一、角度、淨空或訊號銅箔），仍要繼續執行嗎？執行階段仍會以安全閘門拒絕錯誤模型。')) return
    }
    setLoadingMsg(`執行 ${segAnalysis.cuts.length + 1} 段分割中，每段需要重新裁切，可能需要數分鐘…`)
    setIsLoading(true)
    try {
      const data = await api('/api/segment/run', {
        signal_nets: signalNets,
        reference_nets: refNets,
        direction: segAnalysis.direction,
        positions_mm: segAnalysis.cuts.map(c => c.position_mm),
        output_dir: segOutputDir,
        quality_threshold: segmentQuality,
      })
      setSegRun(data)
      setActiveSegIdx(-1)   // 執行完先顯示整體視圖（完整板 + 切割線），方便確認每段位置
      setActiveView('segments')
      setSchedMetaPath(data.metadata_path || '')
      setSegmentSolverPlans((data.segments || []).map((segment: any) => ({
        index: segment.index,
        path: segment.path,
        ...(segment.solver_plan || {}),
      })))
      setShowSolverRegionOverlay(true)
    } catch (e) {
      alert('分段執行失敗: ' + String(e))
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

  const handleExportSignalNets = () => {
    if (signalNets.length === 0) { alert('目前沒有已選取的訊號網路'); return }
    const header = [
      '# PCB SI 3D 模擬分析工具－訊號網路清單',
      '# 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供',
      '# 每行一個 Net；以 # 開頭的行會在匯入時忽略。',
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
      alert(`已匯入 ${matched.length} 條訊號網路；${missing.length} 條在目前 EDB 找不到：\n${missing.slice(0, 12).join('\n')}${missing.length > 12 ? '\n…' : ''}`)
    } else {
      alert(`已匯入 ${matched.length} 條訊號網路。`)
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
  const menus: Record<string, { label: string; action: () => void; disabled?: boolean }[]> = {
    '檔案': [
      { label: '開啟電路板檔案…', action: handleBrowseInput },
      { label: '載入網路清單', action: handleLoadFile, disabled: !inputPath },
      { label: '重新載入原始檔', action: handleReloadOriginal, disabled: allNets.length === 0 },
    ],
    '執行': [
      { label: '執行裁切', action: handleCutout,
        disabled: signalNets.length === 0 },
      { label: '分析 N 段切割位置', action: handleSegmentAnalyze, disabled: !cutScene },
      { label: '執行 N 段分割', action: handleSegmentRun, disabled: !segAnalysis },
      { label: '不分割，整片求解', action: handleSingleSegmentRun, disabled: !canSegment },
      { label: 'S 參數串接', action: () => {}, disabled: true },
    ],
    '檢視': [
      { label: showLogs ? '隱藏系統日誌' : '顯示系統日誌', action: () => setShowLogs(!showLogs) },
      { label: '完整 Layout', action: () => setActiveView('full') },
      { label: '裁切後 Layout', action: () => setActiveView('cut'), disabled: !cutScene },
      { label: '清理前後對比', action: () => setActiveView('cleanup'), disabled: !cleanupAfterScene },
      { label: '一鍵 HTML 報告中心', action: () => setActiveView('report') },
    ],
    '說明': [
      { label: '關於本工具', action: () => alert('PCB SI 3D 模擬分析工具\n\n電路板裁切與 Port 自動建立\n疊構更換、背鑽與 Layout 清理\nN 段分割與 HFSS／SIwave 混合求解\n遠端求解包（求解機不需安裝 Python）\nS 參數串接與眼圖\n\n此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供') },
    ],
  }

  // 分段檢視：activeSegIdx === -1 代表「整體視圖」（完整板 + 切割線疊圖，
  // 分析完成後、執行後都可切回來看），>= 0 代表執行後的第 N 段實際 Layout
  const isOverviewMode = activeSegIdx === -1
  const segScene = (isOverviewMode || !segRun)
    ? (cutScene || fullScene)
    : (segRun.previews?.[activeSegIdx] || cutScene || fullScene)
  const scene = activeView === 'cut' ? cutScene
    : activeView === 'cleanup' ? cleanupAfterScene
    : activeView === 'segments' ? segScene : fullScene
  // 哪些分頁真的在畫 Layout。上方那條「左鍵平移、滾輪縮放…」提示與「請先載入
  // 電路板」浮水印都只對這些成立——原本兩處各自用「不是 A 也不是 B 也不是 C」
  // 的排除清單，新增分頁時必然漏掉：S 參數分頁就同時吃到了那條 Layout 提示
  // （疊在自己的標題上）與浮水印（壓在曲線圖中央）。
  const isLayoutView = (['full', 'cut', 'segments'] as ViewMode[])
    .includes(activeView)

  // 每個分頁都要明確給一個標題，這裡刻意用 Record<ViewMode, string> 而不是
  // 一串 `? :`。原本最後落到「完整電路板 Layout」當預設，新增的「眼圖」分頁
  // 沒有自己的分支就掉進那個預設，報告快照因此被存成「完整電路板 Layout」
  // ——上面那段註解講的正是同一個坑，隔幾行就又踩一次。改成 Record 之後，
  // 漏掉任何一個分頁 TypeScript 會直接編不過。
  const sceneLabels: Record<ViewMode, string> = {
    full: '完整電路板 Layout',
    cut: '裁切後 Layout',
    cleanup: 'Layout 清理前後對比',
    segments: segRun
      ? (isOverviewMode
          ? `整體 Layout（切割線，共 ${segRun.segments.length} 段）`
          : `第 ${activeSegIdx + 1} 段 Layout（共 ${segRun.segments.length} 段）`)
      : 'N 段分割預覽',
    schematic: '串接電路示意圖 · 黃點 = 短路節點（stripline T+B）· 虛線框 = 尚未解算',
    sparam: '串接後 S 參數 · 單端／差動可切換 · 兩端與差動對由 Port 名稱自動判斷',
    eye: 'QuickEye 眼圖 · 眼高與眼寬由 AEDT 量測',
    report: '一鍵 HTML 報告中心',
  }
  const sceneLabel = sceneLabels[activeView]
  // 切割線疊圖：執行前（!segRun，此時無論 activeSegIdx 是什麼都要顯示）
  // 或執行後切回「整體視圖」時都要顯示
  const segCutsOverlay: SegmentCutsInfo | null =
    activeView === 'segments' && complexityAnalysis && (!segRun || isOverviewMode)
      ? {
          // 依複雜度分段：逐刀帶軸向、每段是矩形，Preview2D 會走新路徑。
          direction: complexityAnalysis.cuts[0]?.direction || 'x',
          positions_mm: complexityAnalysis.cuts.map(c => c.position_mm),
          cuts: complexityAnalysis.cuts.map(c => ({
            direction: c.direction,
            position_mm: c.position_mm,
            quality_grade: c.quality_grade,
            region: c.region,
            manual: c.manual,
            auto_position_mm: c.auto_position_mm,
          })),
          segment_boxes: complexityAnalysis.segments.map(seg => ({
            index: seg.index,
            bounds_mm: seg.bounds_mm,
            solver: seg.solver,
          })),
          complexity_regions: complexityAnalysis.regions.map(region => ({
            index: region.index,
            bounds_mm: region.bounds_mm,
            feature_count: region.feature_count,
          })),
        }
    : activeView === 'segments' && segAnalysis && (!segRun || isOverviewMode)
      ? {
          direction: segAnalysis.direction,
          positions_mm: segAnalysis.cuts.map(c => c.position_mm),
          valids: segAnalysis.cuts.map(c => c.valid),
          ideal_positions_mm: segAnalysis.ideal_positions_mm,
          rejected_candidates: segAnalysis.rejected_candidates,
          safety_overlay: segAnalysis.safety_overlay,
          region_solvers: segmentSolverPlans.map(plan => plan.requested_solver),
          region_scores: segmentSolverPlans.map(plan => plan.complexity_score),
        }
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
  const visibleEstimatedBoundary = activeView === 'cut'
    ? completedBoundary?.estimated || null
    : activeView === 'full' ? fullEstimatedBoundary : null
  const visibleActualBoundary = activeView === 'cut'
    ? completedBoundary?.actual || null
    : null
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
    (inputPath || cascadeResult?.output_path || '').split(/[\/]/).pop()
    || 'PCB SI 分析專案'
  ).replace(/\.(aedb|brd|tgz|s\d+p)$/i, '')
  const reportSectionByView: Record<ViewMode, string> = {
    full: 'board', cut: 'cutout', cleanup: 'cleanup', segments: 'segments',
    schematic: 'schematic', sparam: 'sparam', eye: 'eye',
    report: 'results',
  }
  const reportSourceRevision = activeView === 'segments'
    ? (schedMetaPath || segOutputDir)
    : activeView === 'schematic' || activeView === 'sparam'
      ? String(cascadeResult?.output_path || schedMetaPath || '')
      : activeView === 'eye'
        ? String(eyeJob?.result?.image_path || '')
        : activeView === 'cut' || activeView === 'cleanup'
          ? outputPath
          : inputPath
  const reportSnapshotAvailable = activeView !== 'report' && Boolean(
    scene
    || (activeView === 'schematic' && schematicGraph)
    || (activeView === 'sparam' && cascadeResult)
    || (activeView === 'eye' && eyeJob?.status === 'done'),
  )
  useReportStaleRevision(reportWorkspace, ['board'], fullScene, '完整板資料已重新載入')
  useReportStaleRevision(reportWorkspace, ['cutout'], cutScene, '裁切結果已更新')
  useReportStaleRevision(reportWorkspace, ['cleanup'], cleanupAfterScene, 'Layout 清理結果已更新')
  useReportStaleRevision(reportWorkspace, ['segments'], segRun, 'N 段分割結果已更新')
  useReportStaleRevision(reportWorkspace, ['schematic', 'sparam'], cascadeResult, '電路串接結果已更新')
  useReportStaleRevision(reportWorkspace, ['eye'], eyeJob?.result, '眼圖結果已更新')
  const formatBytes = (value: number) => {
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / 1024 / 1024).toFixed(1)} MB`
  }

  const toggleTask = (key: TaskKey, checked: boolean) =>
    setEnabledTasks(prev => (checked
      ? (prev.includes(key) ? prev : [...prev, key])
      : prev.filter(item => item !== key)))

  const closePicker = () => {
    saveTasks(enabledTasks)
    setPickerOpen(false)
    setPickerReturning(false)
  }

  // 被隱藏但仍在執行的工作：不提示的話，長時間求解會變成黑箱。
  const hiddenRunning: string[] = []
  if (!show.schedule && schedStatus?.running) hiddenRunning.push('排程求解')
  if (!show.eye && eyeJob?.running) hiddenRunning.push('眼圖')

  return (
    <div className="app-shell" onClick={() => setOpenMenu(null)}>
      {pickerOpen && (
        <TaskPicker
          flags={show}
          onToggle={toggleTask}
          onSetAll={keys => setEnabledTasks([...keys])}
          onStart={closePicker}
          returning={pickerReturning}
        />
      )}
      {hiddenRunning.length > 0 && (
        <div
          onClick={() => { setPickerReturning(true); setPickerOpen(true) }}
          title="點此回到入口，重新勾選以顯示該項目"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
            background: '#243b2a', color: '#b9f0c6', fontSize: 12,
            padding: '4px 12px', cursor: 'pointer',
            borderBottom: '1px solid #35603f',
            fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
          }}
        >
          {hiddenRunning.join('、')} 執行中（項目已隱藏，點此調整）
        </div>
      )}
      {isLoading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent)'
        }}>
          <div style={{ maxWidth: '70vw', textAlign: 'center' }}>{loadingMsg}</div>
          {cutoutJobId && (
            <button className="btn" onClick={handleStopCutout} disabled={cutoutStopping}
              style={{ minWidth: 150, borderColor: 'var(--danger)', color: 'var(--danger)', background: '#fff' }}>
              {/* 這個背景工作機制裁切、疊構更換、背鑽都共用，寫死「裁切」
                  在套用疊構時會變成錯的字。 */}
              {cutoutStopping ? '停止中…' : '停止目前工作'}
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
              <div key={i} style={{ color: logColor(l) }}>{l}</div>
            ))}
            {logs.length === 0 && <div style={{ color: 'var(--faint)' }}>目前無日誌…</div>}
          </div>
        </div>
      )}
      {chartExpanded && (
        <div onClick={() => setChartExpanded(false)} style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.78)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
        }}>
          <div onClick={event => event.stopPropagation()} style={{
            width: '92vw', height: '84vh', background: '#11151c',
            border: '1px solid var(--border)', borderRadius: 10,
            padding: 18, position: 'relative', overflow: 'auto',
          }}>
            <button className="btn" onClick={() => setChartExpanded(false)}
              style={{ position: 'absolute', right: 14, top: 12, zIndex: 1 }}>關閉（Esc）</button>
            <div style={{ paddingTop: 36 }}>
              <SParamChart series={cascSeries} height={Math.max(520, window.innerHeight * 0.7)}
                interactive />
            </div>
          </div>
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="app-title">PCB SI 3D 模擬分析工具</h1>
          <p className="app-sub">
            HFSS 3D Layout 通道裁切、Port 建立與分段模擬。此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供。
          </p>
        </div>
        <img
          src="/logo.png"
          alt="虎門科技"
          style={{ height: '64px', objectFit: 'contain', marginLeft: '24px', display: 'block' }}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </header>

      {/* 選單列。入口畫面開著時隱藏——那些動作都要先選好項目才有意義。 */}
      <nav className="menubar" hidden={pickerOpen}
        onClick={(e) => e.stopPropagation()}>
        {Object.entries(menus).map(([name, entries]) => (
          <div key={name} className="menubar__item">
            <button
              className={'menubar__btn' + (openMenu === name ? ' menubar__btn--open' : '')}
              onClick={() => setOpenMenu(openMenu === name ? null : name)}
              onMouseEnter={() => { if (openMenu) setOpenMenu(name) }}
            >{name}</button>
            {openMenu === name && (
              <div className="menubar__dropdown">
                {entries.map(entry => (
                  <button
                    key={entry.label}
                    className="menubar__entry"
                    disabled={entry.disabled}
                    onClick={() => { setOpenMenu(null); entry.action() }}
                  >{entry.label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <main style={{ flex: 1, minHeight: 0 }}>
        <Allotment defaultSizes={splitSizes} onChange={saveSplitSizes}>
          {/* 左側：設定面板 */}
          <Allotment.Pane minSize={320}>
            <div style={{ paddingRight: 7, height: '100%' }}>
              <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%', gap: '12px', overflowY: 'auto' }}>

                {/* 入口：回去調整這次要顯示哪些項目。狀態一律保留。 */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  paddingBottom: 8,
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                    已選 {enabledTasks.length} 項
                  </span>
                  <button
                    className="btn--mini"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => { setPickerReturning(true); setPickerOpen(true) }}
                    title="回到入口重新勾選；已載入的板子與工作進度都會保留"
                  >調整項目</button>
                </div>

                {/* 輸入檔案 */}
                <div hidden={!(show.load)}>
                  <h3 className="panel-title">輸入檔案（.aedb / .brd / .tgz）</h3>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input
                      type="text"
                      className="input"
                      value={inputPath}
                      onChange={e => setInputPath(e.target.value)}
                      placeholder="path\to\board.aedb"
                    />
                    <button className="btn" onClick={handleBrowseInput}>瀏覽…</button>
                  </div>
                  {/* 原本這裡有「直接匯入分段」勾選框。入口的「局部裁切」已經
                      決定了同一件事，再擺一個框只是要使用者把同樣的決定講第二遍。
                      模式改由按鈕文字與下方這行說明表達。 */}
                  <div className="panel-hint" style={{ marginTop: 6, fontSize: 11 }}>
                    {directSegmentMode
                      ? '入口未勾「局部裁切」，此檔案將直接作為通道進入後續步驟，不再裁切。'
                      : '入口已勾「局部裁切」，載入後可設定裁切範圍。'}
                  </div>
                  <button className="btn--primary" onClick={handleLoadFile} style={{ marginTop: 6 }}>
                    {directSegmentMode ? '載入檔案（不裁切）' : '載入電路板'}
                  </button>
                </div>

                {/* 「選擇網路」：網路選擇 */}
                <div hidden={!(show.load)} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 220 }}>
                  <h3 className="panel-title">選擇網路（Nets）</h3>
                  <p className="panel-hint">左列雙擊或按「訊」加入訊號網路、按「參」加入參考網路；右列雙擊移除。</p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input ref={signalFileRef} type="file" accept=".txt,text/plain" hidden
                      onChange={handleImportSignalFile} />
                    <button className="btn" style={{ flex: 1 }} onClick={() => signalFileRef.current?.click()}
                      disabled={allNets.length === 0}>匯入訊號清單</button>
                    <button className="btn" style={{ flex: 1 }} onClick={handleExportSignalNets}
                      disabled={signalNets.length === 0}>匯出訊號清單</button>
                  </div>
                  <input
                    type="text"
                    className="input"
                    placeholder="過濾關鍵字…"
                    value={filterText}
                    onChange={e => setFilterText(e.target.value)}
                    style={{ margin: '6px 0' }}
                  />
                  <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0 }}>
                    {/* 可選網路 */}
                    <div className="netlist" style={{ flex: 1 }}>
                      {availableFiltered.map(net => (
                        <div key={net} className="netlist__row" onDoubleClick={() => addSignal(net)}>
                          <span className="netlist__name" title={net}>{net}</span>
                          <button className="btn--mini" title="加入訊號網路" onClick={() => addSignal(net)}>訊</button>
                          <button className="btn--mini" title="加入參考網路" onClick={() => addRef(net)}>參</button>
                        </div>
                      ))}
                    </div>
                    {/* 已選：訊號 + 參考 */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
                      <div className="netlist" style={{ flex: 3 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', padding: '2px 6px' }}>
                          訊號網路（{signalNets.length}）
                        </div>
                        {signalNets.map(net => (
                          <div key={net} className="netlist__row netlist__row--sig" onDoubleClick={() => removeSignal(net)} title="雙擊移除">
                            <span className="netlist__name">{net}</span>
                          </div>
                        ))}
                      </div>
                      <div className="netlist" style={{ flex: 2 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ok)', padding: '2px 6px' }}>
                          參考網路（{refNets.length}）
                        </div>
                        {refNets.map(net => (
                          <div key={net} className="netlist__row netlist__row--ref" onDoubleClick={() => removeRef(net)} title="雙擊移除">
                            <span className="netlist__name">{net}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 「裁切設定」：裁切設定（直接分段模式不需要） */}
                <div hidden={!(show.cutout)} style={directSegmentMode ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <h3 className="panel-title">裁切設定</h3>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">向外擴張距離（mm）</div>
                      <input type="number" className="input" min="0" step="0.5"
                        value={expansionMm} onChange={e => setExpansionMm(e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">框選範圍形狀</div>
                      <select className="input" value={extentType} onChange={e => {
                        setExtentType(e.target.value)
                        setActualCutoutExtentType('')
                      }}>
                        <option value="Conforming">貼合走線（Conforming）</option>
                        <option value="ConvexHull">凸包（ConvexHull）</option>
                        <option value="Bounding">矩形（Bounding Box）</option>
                      </select>
                    </div>
                  </div>
                  <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>
                    {actualCutoutExtentType
                      ? `上次實際裁切形狀：${EXTENT_LABEL[actualCutoutExtentType] || actualCutoutExtentType}`
                      : extentType === 'Conforming'
                        ? '外框會沿著走線轉彎，真正只向外擴張所設距離。彎折或斜向通道用凸包時，內側會被一條弦線切過而包進大量無關的 Via。'
                        : extentType === 'ConvexHull'
                          ? '凸包依定義是凸的：斜向或彎折通道的內側必然被弦線切過，會多包無關銅箔。要貼著走線請改選「貼合走線」。'
                          : '矩形最保守也最大；實際裁切會遵照所選形狀，只有 PyEDB 明確失敗時才回退並通知。'}
                  </div>
                  {boundaryAreaSaving !== null && extentType === 'Conforming' && (
                    <div className="status" style={{ marginTop: 4, fontSize: 11.5, color: 'var(--accent)' }}>
                      貼合外框比凸包少包 {boundaryAreaSaving.toFixed(1)}% 的面積。
                    </div>
                  )}
                  <button
                    className="btn"
                    style={{ width: '100%', marginTop: 7 }}
                    onClick={handlePreciseBoundaryPreview}
                    disabled={!fullScene || signalNets.length === 0 || refNets.length === 0 || isLoading}
                    title="唯讀呼叫與正式裁切相同的 PyEDB 外框演算法，不會修改目前 EDB">
                    分析精確裁切外框
                  </button>
                  <div className="status" style={{ marginTop: 5, fontSize: 11.5 }}>
                    {preciseBoundaryPreview
                      && preciseBoundaryPreviewKey === cutoutBoundaryKey(signalNets, refNets, expansionMm, extentType)
                      ? `已顯示 PyEDB 精確預估外框（${preciseBoundaryPreview.length} 點）。`
                      : '按上方按鈕才會顯示外框；顯示的是與正式裁切完全相同的演算法結果，不是估算值。'}
                  </div>
                </div>

                {/* 「執行裁切」：輸出與執行（直接分段模式不需要） */}
                <div hidden={!(show.cutout)} style={directSegmentMode ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <h3 className="panel-title">執行裁切</h3>
                  <p className="panel-hint">
                    這一步只裁出通道，不建立 Port。元件端 Port 要建立在最終幾何上，
                    所以排在背鑽與 Layout 清理之後——見下方〈設定 Port 與求解器〉。
                  </p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input
                      type="text"
                      className="input"
                      value={outputPath}
                      onChange={e => setOutputPath(e.target.value)}
                      placeholder="輸出路徑…"
                    />
                    <button className="btn" onClick={handleBrowseOutput}>瀏覽…</button>
                  </div>
                  <button
                    className="btn--primary"
                    onClick={handleCutout}
                    disabled={signalNets.length === 0 || refNets.length === 0}
                    style={{ marginTop: 6 }}
                  >
                    執行裁切
                  </button>
                </div>

                {/* 「疊構更換」：疊構更換 */}
                <div hidden={!(show.stackup)} style={{ opacity: boardLoaded ? 1 : 0.5, pointerEvents: boardLoaded ? undefined : 'none' }}>
                  <h3 className="panel-title">疊構更換</h3>
                  <p className="panel-hint">
                    指定疊構檔即可直接分析並套用，支援 XML／CSV／JSON；XML 為 Ansys
                    Control 格式。<b>套用前一定會先列出差異</b>，永遠另存新檔。
                  </p>
                  <p className="panel-hint">
                    <b>排在裁切之後、背鑽與設定 Port 之前。</b>pyedb 換疊構時會把每一個
                    padstack instance 的 layer_map 讀出再寫回，耗時與板上 Via 數量成
                    正比——全板要十幾分鐘，裁完只剩通道範圍就快得多。但一定要在背鑽與
                    Port 之前，那兩者都必須建立在最終疊構上。
                  </p>

                  <div className="field-label" style={{ marginTop: 6 }}>疊構檔</div>
                  <div className="field-row">
                    <input type="text" className="input" value={stackupFilePath}
                      onChange={e => { setStackupFilePath(e.target.value); setStackupDiff(null) }}
                      placeholder="疊構檔路徑…（.xml／.csv／.json）" />
                    <button className="btn" onClick={handleBrowseStackup}>瀏覽…</button>
                  </div>
                  <button className="btn--primary" style={{ width: '100%', marginTop: 6 }}
                    onClick={handleStackupAnalyze} disabled={!stackupFilePath}>
                    分析差異
                  </button>

                  {/* 匯出是選用的輔助功能，不是流程的第一步——手上已經有疊構檔
                      （例如來自其他工具）時完全不需要先匯出。
                      全站的操作按鈕都不加步驟編號：按鈕本來就照順序排，後續動作
                      也要前一步完成才會出現或啟用，編號沒有多給資訊，反而讓人以為
                      自己漏了某個步驟、或誤以為選用步驟是必經的。 */}
                  <div className="field-row" style={{ marginTop: 8 }}>
                    <span className="panel-hint" style={{ flex: 1, margin: 0 }}>
                      沒有現成檔案？可先匯出目前疊構當範本再編輯：
                    </span>
                    <select className="input" style={{ width: 76 }} value={stackupExportFormat}
                      onChange={e => setStackupExportFormat(e.target.value as 'xml' | 'csv' | 'json')}>
                      <option value="xml">XML</option>
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                    </select>
                    <button className="btn" onClick={handleStackupExport}>
                      匯出
                    </button>
                  </div>

                  <PortWarning warning={stackupDiff?.port_warning} />
                  {stackupDiff && (
                    <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>
                      {stackupDiff.comparable === false ? (
                        <span style={{ color: '#ffb347' }}>{stackupDiff.reason}</span>
                      ) : (
                        <>
                          <div>
                            導體層 {stackupDiff.signal_layer_count} → {stackupDiff.incoming_signal_layer_count}｜
                            改名 {stackupDiff.renames?.length || 0}、
                            介電層重建 {stackupDiff.dielectric_rebuilt ?? 0}、
                            新增 {stackupDiff.added.length}、變更 {stackupDiff.changed.length}、
                            材料異動 {stackupDiff.material_changes.length}
                          </div>
                          <div style={{ marginTop: 3, opacity: 0.8 }}>
                            導體層依順序就地改名，銅箔保留；介電層一律移除重建
                            （介電層不帶銅箔）。兩者都不是資料遺失。
                          </div>
                          {stackupDiff.signal_count_matches === false && (
                            <div style={{ marginTop: 4, color: '#ff6b6b', fontWeight: 650 }}>
                              ⚠ 導體層數對不上，pyedb 會直接拒絕套用。
                            </div>
                          )}
                          {stackupDiff.renames?.length > 0 && (
                            <div style={{ marginTop: 5 }}>
                              <div style={{ fontWeight: 650 }}>
                                導體層依「順序」改名（銅箔保留，不是刪除）
                              </div>
                              <div style={{ marginTop: 3, maxHeight: 132, overflowY: 'auto',
                                            fontFamily: '"Calibri", monospace', fontSize: 11 }}>
                                {stackupDiff.renames.map((item: any) => (
                                  <div key={item.index}>
                                    {String(item.index).padStart(2, '0')}　{item.from} → <b>{item.to}</b>
                                  </div>
                                ))}
                              </div>
                              <div style={{ marginTop: 3, color: '#ffb347' }}>
                                請核對這個對應：順序若與預期不同，銅箔會落在錯的層上，
                                而這是名字比對看不出來的。
                              </div>
                            </div>
                          )}
                          {stackupDiff.removed.length > 0 && (
                            <div style={{ marginTop: 4, color: '#ff6b6b', fontWeight: 650 }}>
                              ⚠ 套用後會刪除 {stackupDiff.removed.length} 層（連同其上的銅箔）：
                              {stackupDiff.removed.slice(0, 8).join('、')}
                              {stackupDiff.removed.length > 8 ? '…' : ''}
                            </div>
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
                        ? '我知道導體層數不符，仍要嘗試'
                        : '我確認要刪除上列圖層'}
                    </label>
                  )}

                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input type="text" className="input" value={stackupOutputPath}
                      onChange={e => setStackupOutputPath(e.target.value)}
                      placeholder="輸出路徑…（例如 xxx_stackup.aedb）" />
                    <button className="btn" onClick={async () => {
                      try {
                        const data = await api('/api/browse_output')
                        if (data.path) setStackupOutputPath(data.path)
                      } catch (e) { console.error(e) }
                    }}>瀏覽…</button>
                  </div>
                  <button className="btn--primary" style={{ width: '100%', marginTop: 6 }}
                    onClick={handleStackupApply}
                    disabled={!stackupDiff || stackupDiff.comparable === false
                      || (stackupDiff.requires_confirmation && !stackupConfirmRemoval)}>
                    套用疊構並另存
                  </button>
                </div>

                {/* 「背鑽」：背鑽 */}
                <div hidden={!(show.backdrill)} style={{ opacity: canSegment ? 1 : 0.5, pointerEvents: canSegment ? undefined : 'none' }}>
                  <h3 className="panel-title">背鑽</h3>
                  <p className="panel-hint">
                    自動推導每顆訊號 Via 的連接層與應鑽側，確認後批次寫入。
                    貫穿孔出線後剩下的殘樁會在四分之一波長處造成深陷波。
                    永遠另存新檔，並輸出逐顆的設定報告。
                  </p>

                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <div className="field-label" style={{ minWidth: 66 }}>保留殘樁</div>
                    <input type="number" className="input" style={{ width: 70 }} min="0" step="0.5"
                      value={bdTargetStubMil} onChange={e => setBdTargetStubMil(e.target.value)} />
                    <span className="panel-hint" style={{ margin: 0, fontSize: 11 }}>mil</span>
                    <div className="field-label" style={{ minWidth: 66, marginLeft: 8 }}>鑽頭加大</div>
                    <input type="number" className="input" style={{ width: 70 }} min="0" step="1"
                      value={bdDiameterIncMil} onChange={e => setBdDiameterIncMil(e.target.value)}
                      title="鑽頭直徑 = 原孔徑 + 此增量。回鑽鑽頭與原孔同徑會鑽不乾淨孔壁鍍銅，實際值請依板廠規格。" />
                    <span className="panel-hint" style={{ margin: 0, fontSize: 11 }}>mil</span>
                  </div>

                  <button className="btn" style={{ width: '100%', marginTop: 6 }}
                    onClick={handleBackdrillAnalyze} disabled={signalNets.length === 0}>
                    分析殘樁
                  </button>

                  <PortWarning warning={bdResult?.port_warning} />
                  {bdResult && (
                    <>
                      <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>
                        訊號 Via {bdResult.via_count} 顆｜需背鑽 {bdResult.stub_count} 段｜
                        共振預測取疊構平均 Dk {bdResult.dielectric_constant?.toFixed(2)}（指示值，約 ±10%）
                      </div>
                      <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 6,
                                    border: '1px solid var(--border)', borderRadius: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead>
                            <tr style={{ color: 'var(--faint)' }}>
                              <th style={{ padding: '3px 5px' }}>鑽</th>
                              <th style={{ padding: '3px 5px', textAlign: 'left' }}>Net</th>
                              <th style={{ padding: '3px 5px' }}>連接層</th>
                              <th style={{ padding: '3px 5px' }}>側</th>
                              <th style={{ padding: '3px 5px' }}>To</th>
                              <th style={{ padding: '3px 5px' }}>殘樁mm</th>
                              <th style={{ padding: '3px 5px' }}>共振GHz</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bdResult.entries.map((entry: any, i: number) => (
                              entry.stubs.length === 0 ? (
                                <tr key={`${entry.id}-none`} style={{ opacity: 0.5 }}>
                                  <td style={{ padding: '3px 5px' }}>—</td>
                                  <td style={{ padding: '3px 5px' }}>{entry.net.split('.')[0].slice(7)}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    {entry.connected_layers.join(',') || '-'}</td>
                                  <td colSpan={4} style={{ padding: '3px 5px' }}>{entry.note}</td>
                                </tr>
                              ) : entry.stubs.map((stub: any, j: number) => (
                                <tr key={`${entry.id}-${j}`}>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    <input type="checkbox" checked={stub.selected !== false}
                                      onChange={() => toggleBackdrillStub(i, j)} />
                                  </td>
                                  <td style={{ padding: '3px 5px' }}>{entry.net.split('.')[0].slice(7)}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    {entry.connected_layers.join(',')}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    {stub.side === 'top' ? '頂面' : '底面'}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>{stub.to_layer}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'right' }}>
                                    {stub.stub_mm?.toFixed(3)}</td>
                                  <td style={{ padding: '3px 5px', textAlign: 'right' }}>
                                    {stub.resonance_ghz ? stub.resonance_ghz.toFixed(1) : '-'}</td>
                                </tr>
                              ))
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="field-row" style={{ marginTop: 6 }}>
                        <input type="text" className="input" value={bdOutputPath}
                          onChange={e => setBdOutputPath(e.target.value)}
                          placeholder="輸出路徑…（例如 xxx_backdrill.aedb）" />
                      </div>
                      <button className="btn--primary" style={{ width: '100%', marginTop: 6 }}
                        onClick={handleBackdrillApply}>
                        寫入背鑽並另存
                      </button>
                    </>
                  )}
                </div>

                {/* 「Layout 清理」：Layout 清理 */}
                <div hidden={!(show.cleanup)} style={{ opacity: canSegment ? 1 : 0.5 }}>
                  <h3 className="panel-title">Layout 清理</h3>
                  <p className="panel-hint">
                    保留訊號、參考平面、元件 Pin 與 Port；可使用固定保護距離，或依 Stackup 電磁影響範圍判斷。
                    永遠另存新檔，不覆寫目前 Layout。
                  </p>
                  <div className="field-label" style={{ marginTop: 6 }}>清理等級</div>
                  <div className="field-row">
                    <select className="input" value={cleanupMode}
                      onChange={e => {
                        const mode = e.target.value as 'conservative' | 'em_field'
                        setCleanupMode(mode)
                        setCleanupGuardMm(mode === 'em_field' ? '0.2' : '2')
                        setCleanupAnalysis(null)
                      }}
                      disabled={!canSegment}>
                      <option value="conservative">第一級：固定距離保守清理</option>
                      <option value="em_field">第二級：依電磁影響範圍判斷</option>
                    </select>
                    <button className="btn cleanup-recommended-btn"
                      onClick={applyCleanupRecommendedSettings}
                      disabled={!canSegment}
                      title="切換至第二級並帶入建議值：最小距離 0.2 mm、隔離度 40 dB">
                      帶入建議設定
                    </button>
                  </div>
                  {cleanupMode === 'em_field' && (
                    <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>
                      依訊號層到最近參考層的高度 h 與目標隔離度計算逐層保護半徑；參考 Net 仍完整保留。
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'flex-end' }}>
                    <div style={{ width: 110 }}>
                      <div className="field-label">{cleanupMode === 'em_field' ? '最小保護距離（mm）' : '保護距離（mm）'}</div>
                      <input type="number" className="input" min="0.1" step="0.1"
                        value={cleanupGuardMm} onChange={e => { setCleanupGuardMm(e.target.value); setCleanupAnalysis(null) }}
                        disabled={!canSegment} />
                    </div>
                    {cleanupMode === 'em_field' && (
                      <div style={{ width: 105 }}>
                        <div className="field-label">目標隔離度（dB）</div>
                        <input type="number" className="input" min="20" max="80" step="5"
                          value={cleanupIsolationDb} onChange={e => { setCleanupIsolationDb(e.target.value); setCleanupAnalysis(null) }}
                          disabled={!canSegment} />
                      </div>
                    )}
                    <button className="btn" style={{ flex: 1 }} onClick={handleCleanupAnalyze} disabled={!canSegment}>
                      分析與紅框預覽
                    </button>
                  </div>
                  <PortWarning warning={(cleanupAnalysis as any)?.port_warning} />
                  {cleanupAnalysis && !cleanupAnalysis.deleted && (
                    <div className="status status--warn" style={{ marginTop: 6, fontSize: 11.5 }}>
                      候選移除 {cleanupAnalysis.remove_count} 個：銅箔／走線
                      {cleanupAnalysis.stats.primitive_remove || 0} 個、Via
                      {cleanupAnalysis.stats.via_remove || 0} 個。
                      {cleanupAnalysis.overlay.truncated ? ` 畫面僅顯示前 ${cleanupAnalysis.overlay.boxes.length} 個紅框。` : ''}
                    </div>
                  )}
                  {cleanupAnalysis?.em_field && !cleanupAnalysis.deleted && (
                    <div className="cleanup-em-rules">
                      <div>電磁倍率：{cleanupAnalysis.em_field.field_factor.toFixed(2)} × h；Reference Layer：{cleanupAnalysis.em_field.reference_layers.join('、')}</div>
                      {Object.entries(cleanupAnalysis.em_field.layer_rules).map(([layer, rule]) => (
                        <div key={layer}>{layer}：h={rule.reference_height_mm.toFixed(3)} mm，保護半徑={rule.same_layer_radius_mm.toFixed(3)} mm</div>
                      ))}
                    </div>
                  )}
                  {cleanupAnalysis?.mode === 'conservative_fallback' && (
                    <div className="status status--warn" style={{ marginTop: 6, fontSize: 11.5 }}>
                      Stackup／參考層資料不足，本次分析已自動退回第一級固定距離模式。
                    </div>
                  )}
                  {cleanupAnalysis?.deleted && (
                    <div className="status status--ok" style={{ marginTop: 6, fontSize: 11.5 }}>
                      清理完成：刪除銅箔／走線 {cleanupAnalysis.deleted.primitive} 個、Via
                      {cleanupAnalysis.deleted.via} 個、失敗 {cleanupAnalysis.deleted.failed} 個。
                      報告已輸出至 {cleanupAnalysis.report_path}。
                    </div>
                  )}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input type="text" className="input" value={cleanupOutputPath}
                      onChange={e => setCleanupOutputPath(e.target.value)}
                      placeholder="清理後 .aedb 輸出路徑…" disabled={!canSegment} />
                  </div>
                  <button className="btn--primary" style={{ marginTop: 6 }}
                    onClick={handleCleanupRun}
                    disabled={!cleanupAnalysis || cleanupAnalysis.remove_count === 0 || !!cleanupAnalysis.deleted}>
                    另存並執行{cleanupMode === 'em_field' ? '第二級清理' : '保守清理'}
                  </button>
                </div>

                {/* 「Port 設定」：挑要建 Port 的端點元件與 Port 型別。
                    這裡不再依 directSegmentMode 壓暗——裁切拆出 Port 之後，
                    這一格是「設定 Port 與求解器」唯一的元件來源，壓暗它等於讓
                    checkedComps 永遠是空的，下面那顆按鈕就再也按不下去。 */}
                <div hidden={!show.ports}>
                  <h3 className="panel-title">Port 設定</h3>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">Port 類型</div>
                      <select className="input" value={portType} onChange={e => setPortType(e.target.value)}>
                        <option value="coax">Coax（同軸，建議）</option>
                        <option value="circuit">Circuit（電路埠）</option>
                      </select>
                    </div>
                    <div style={{ flex: 1.4 }}>
                      <div className="field-label">建立 Port 的元件（{candidateComps.filter(c => checkedComps[c.name]).length}/{candidateComps.length}）</div>
                      <div className="field-row" style={{ margin: '4px 0' }}>
                        <button className="btn" style={{ flex: 1, padding: '3px 6px', fontSize: 11.5 }}
                          onClick={selectRecommendedPortComponents} disabled={candidateComps.length === 0}>
                          建議端點（最多 2 個）
                        </button>
                        <button className="btn" style={{ padding: '3px 8px', fontSize: 11.5 }}
                          onClick={() => setCheckedComps(Object.fromEntries(candidateComps.map(c => [c.name, false])))}
                          disabled={candidateComps.length === 0}>全不選</button>
                      </div>
                      <div className="netlist" style={{ maxHeight: 110, overflowY: 'auto' }}>
                        {candidateComps.length === 0 && (
                          <div style={{ fontSize: 11.5, color: 'var(--faint)', padding: 6 }}>選擇訊號網路後自動列出</div>
                        )}
                        {candidateComps.map(c => (
                          <label key={c.name} className="netlist__row" style={{ cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={!!checkedComps[c.name]}
                              onChange={() => setCheckedComps(prev => ({ ...prev, [c.name]: !prev[c.name] }))}
                            />
                            <span className="netlist__name" title={c.nets.join(', ')}>
                              {c.name}（{c.pin_count} 腳）
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 「模擬設定」：裁切 Setup 與排程共用；直接分段模式仍可設定求解器 */}
                <div hidden={!showSolverSetup}>
                  <h3 className="panel-title">模擬設定</h3>
                  <p className="panel-hint" style={{ marginTop: 4 }}>
                    <b>掃頻設定 SIwave 與 HFSS 共用</b>；Solution Frequency 與收斂條件
                    只有 HFSS 會用到。實際每段用哪一種求解器，由「排程求解」的
                    「混合求解區域」決定。
                  </p>

                  {/* Sweep Type & Solution Freq */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <div className="field-label" style={{ minWidth: 60 }}>掃頻模式</div>
                    <select className="input" style={{ width: 140 }} value={sweepType} onChange={e => setSweepType(e.target.value)}>
                      <option value="Interpolating">Interpolating</option>
                      <option value="Discrete">Discrete</option>
                      <option value="Fast">Fast</option>
                    </select>
                    <div className="field-label" style={{ minWidth: 80, marginLeft: 12 }}>工作頻率 (GHz)</div>
                    <input type="number" className="input" style={{ width: 100 }} min="0" step="0.1" value={solutionFreq} onChange={e => setSolutionFreq(e.target.value)} title="預設為掃頻頻寬的一半" />
                    <div className="field-label" style={{ minWidth: 100, marginLeft: 12 }}>Error Tolerance (%)</div>
                    <input type="number" className="input" style={{ width: 80 }} min="0.001" step="0.05" value={errorTolerance} onChange={e => setErrorTolerance(e.target.value)} title="Interpolating Sweep 收斂容差（AEDT 預設 0.5%，本工具預設 0.1%）" />
                  </div>

                  {/* Sweeps Table */}
                  <div style={{ marginTop: 12 }}>
                    <div className="field-label" style={{ marginBottom: 4 }}>多段式掃頻 (Frequency Sweeps)</div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Distribution</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Start</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600 }}>End</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Value</th>
                            <th style={{ padding: '6px 8px', width: 30 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sweeps.map((sw, idx) => (
                            <tr key={idx} style={{ borderBottom: idx < sweeps.length - 1 ? '1px solid var(--border)' : 'none' }}>
                              <td style={{ padding: 4 }}>
                                <select 
                                  className="input" 
                                  style={{ padding: '2px 4px', height: 24, fontSize: 12 }} 
                                  value={sw.distribution} 
                                  onChange={e => {
                                    const newSweeps = [...sweeps];
                                    newSweeps[idx].distribution = e.target.value;
                                    setSweeps(newSweeps);
                                  }}
                                >
                                  <option value="Linear Count">Linear Count</option>
                                  <option value="Log Scale">Log Scale</option>
                                  <option value="Linear Step">Linear Step</option>
                                </select>
                              </td>
                              <td style={{ padding: 4 }}>
                                <input className="input" style={{ padding: '2px 4px', height: 24, fontSize: 12 }} value={sw.start} onChange={e => { const ns = [...sweeps]; ns[idx].start = e.target.value; setSweeps(ns); }} />
                              </td>
                              <td style={{ padding: 4 }}>
                                <input className="input" style={{ padding: '2px 4px', height: 24, fontSize: 12 }} value={sw.end} onChange={e => { const ns = [...sweeps]; ns[idx].end = e.target.value; setSweeps(ns); }} />
                              </td>
                              <td style={{ padding: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ fontSize: 11, color: 'var(--faint)', width: 50, flexShrink: 0 }}>
                                  {sw.distribution === 'Linear Count' ? 'Points' : sw.distribution === 'Log Scale' ? 'Samples' : 'Step size'}
                               </span>
                                <input className="input" style={{ flex: 1, padding: '2px 4px', height: 24, fontSize: 12, minWidth: 0 }} value={sw.value} onChange={e => { const ns = [...sweeps]; ns[idx].value = e.target.value; setSweeps(ns); }} />
                              </td>
                              <td style={{ padding: 4, textAlign: 'center' }}>
                                <button className="btn--mini" style={{ padding: '2px 6px' }} onClick={() => setSweeps(sweeps.filter((_, i) => i !== idx))}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ padding: '4px', background: 'rgba(255,255,255,0.02)' }}>
                        <button className="btn" style={{ fontSize: 11, padding: '2px 8px', width: '100%' }} onClick={() => setSweeps([...sweeps, { distribution: 'Linear Step', start: '0Hz', end: '1GHz', value: '0.1GHz' }])}>+ 新增掃頻段</button>
                      </div>
                    </div>
                  </div>

                  {/* HFSS Adaptive Options */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="field-label" style={{ minWidth: 74 }}>自適應方式</div>
                    <select className="input" style={{ width: 190 }} value={adaptiveMode}
                      onChange={e => setAdaptiveMode(e.target.value as 'broadband' | 'multi' | 'single')}
                      title="Ansys BKM 建議寬頻自適應：範圍 1 GHz ~ 掃頻上限/2。單點自適應若低於掃頻上限，高頻網格會相對過粗而產生數值反射。">
                      <option value="broadband">寬頻（Ansys BKM 建議）</option>
                      <option value="multi">多頻（3 點）</option>
                      <option value="single">單一頻率</option>
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5,
                                    fontSize: 11.5, cursor: 'pointer' }}
                      title="BKM：Parallel Adaptive Region">
                      <input type="checkbox" checked={parallelRefinement}
                        onChange={e => setParallelRefinement(e.target.checked)} />
                      平行自適應區（PAR）
                    </label>
                  </div>
                  {adaptiveMode !== 'single' && (
                    <div className="panel-hint" style={{ marginTop: 4, fontSize: 11 }}>
                      自適應頻率範圍由掃頻上限自動推導為 1 GHz ~ 上限/2，不需手填；
                      「工作頻率」僅在選單一頻率時生效。
                    </div>
                  )}
                  <div className="panel-hint" style={{ marginTop: 4, fontSize: 10.5, opacity: 0.75 }}>
                    BKM 的兩項 Beta 選項（low memory mesh adaptive、frequency sweep
                    acceleration via disk caching）EDB API 無對應設定，需自行在 AEDT 端開啟。
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <div className="field-label" style={{ minWidth: 74 }}>網格方法</div>
                    <select className="input" style={{ width: 150 }} value={hfssMeshMethod}
                      onChange={e => setHfssMeshMethod(e.target.value as 'Phi' | 'PhiPlus' | 'Classic')}
                      title="HFSS 3D Layout 的網格產生方法。PhiPlus 對多層複雜結構較不易失敗；Classic 為舊版方法，可在前兩者卡住時嘗試。">
                      <option value="PhiPlus">Phi Plus（建議）</option>
                      <option value="Phi">Phi</option>
                      <option value="Classic">Classic</option>
                    </select>
                    <span className="panel-hint" style={{ margin: 0, fontSize: 11 }}>
                      僅 HFSS 分段適用，求解時套用並寫入 segments.json
                    </span>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="field-label" style={{ marginBottom: 4 }}>收斂條件 (Adaptive Options)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--faint)' }}>Max Refinement Per Pass (%)</div>
                        <input type="number" className="input" min="1" step="1" value={maxRefinementPerPass} onChange={e => setMaxRefinementPerPass(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--faint)' }}>Min Converged Passes</div>
                        <input type="number" className="input" min="1" step="1" value={minConvergedPasses} onChange={e => setMinConvergedPasses(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--faint)' }}>Max Passes</div>
                        <input type="number" className="input" min="1" step="1" value={maxPasses} onChange={e => setMaxPasses(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--faint)' }}>Max Delta S</div>
                        <input type="number" className="input" min="0.001" step="0.01" value={maxDeltaS} onChange={e => setMaxDeltaS(e.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 設定 Port 與求解器：對目前的工作檔建立 Port 與 Setup，不裁切。
                    啟用條件用 canSegment 而不是 directSegmentMode——拆分後
                    「先裁切、再單獨設 Port」也是合法路徑，那時 directSegmentMode
                    是 false，用它當條件會把面板鎖死。 */}
                <div hidden={!(show.ports)} style={canSegment ? undefined : { opacity: 0.4, pointerEvents: 'none' }}>
                  <h3 className="panel-title">設定 Port 與求解器</h3>
                  <p className="panel-hint">
                    在目前的通道上建立元件端 Port 並套用求解器設定，不執行裁切。
                    適用於自己裁切好的檔案，或上一步只做了裁切的輸出。
                    <b>跳過這一步，通道頭尾不會有元件端 Port</b>，分段與求解都會白做，
                    最後電路串接必定失敗。永遠另存新檔，來源檔不會被修改。
                  </p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input
                      type="text"
                      className="input"
                      value={portsOutputPath}
                      onChange={e => setPortsOutputPath(e.target.value)}
                      placeholder="輸出路徑…（例如 xxx_ports.aedb）"
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
                      !canSegment
                      || signalNets.length === 0
                      || refNets.length === 0
                      || Object.keys(checkedComps).filter(c => checkedComps[c]).length === 0
                    }
                    style={{ marginTop: 6 }}
                  >
                    建立 Port 並套用求解器設定
                  </button>
                </div>

                {/* 「N 段分割」：N 段分割 */}
                <div hidden={!(show.segment)} style={{ opacity: canSegment ? 1 : 0.5 }}>
                  <h3 className="panel-title">N 段分割</h3>
                  <p className="panel-hint">
                    將裁切後的板子分成 N 段，切面自動截斷走線並建立 Gap Port。
                    {directSegmentMode && <span style={{ color: 'var(--accent)' }}>（載入的檔案已是通道，未經裁切）</span>}
                  </p>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '80px 1fr',
                    gap: 8, marginTop: 7, alignItems: 'end',
                  }}>
                    <div>
                      <div className="field-label">分段數 N</div>
                      <input type="number" className="input" min="2" max="10" step="1"
                        value={nSegments} onChange={e => setNSegments(e.target.value)} disabled={!canSegment} />
                    </div>
                    <div>
                      <div className="field-label">可接受評分</div>
                      <select className="input" value={segmentQuality}
                        onChange={e => {
                          setSegmentQuality(e.target.value as QualityThreshold)
                          setSegAnalysis(null)
                        }}
                        disabled={!canSegment}>
                        <option value="A">A 級以上（最嚴，候選最少）</option>
                        <option value="B">B 級以上（建議）</option>
                        <option value="C">C 級以上（最容易平分，需人工複核）</option>
                      </select>
                    </div>
                    <button className="btn--primary" style={{ gridColumn: '1 / -1' }}
                      onClick={handleSegmentAnalyze} disabled={!canSegment}>
                      分析切割位置（等分）
                    </button>
                    <div className="panel-hint" style={{ gridColumn: '1 / -1', marginTop: -2 }}>
                      適合<b>全段都用 HFSS</b> 求解：各段大小相近，逐段求解的時間與
                      記憶體才不會被某一段拖垮。段數由上面的 N 決定。
                    </div>
                    <button className="btn--primary" style={{ gridColumn: '1 / -1', marginTop: 4 }}
                      onClick={handleComplexityAnalyze} disabled={!canSegment}>
                      依 3D 複雜度分析切割位置
                    </button>
                    <div className="panel-hint" style={{ gridColumn: '1 / -1', marginTop: -2 }}>
                      適合 <b>HFSS＋SIwave 混合求解</b>：把換層 Via 與元件端 launch
                      所在的區域切成獨立分段交給 HFSS，中間的平面走線交給 SIwave
                      ——那正是 SIwave 最擅長也最快的情形。段數是偵測結果，不需要填 N。
                    </div>
                  </div>
                  <div className="status" style={{ marginTop: 5, fontSize: 11.5 }}>
                    工具會在這個評分之上，把各段長度盡可能平分——分段是逐段依序求解，
                    總時間與記憶體由最大的那一段決定。
                    {segmentQuality === 'C' && (
                      <b style={{ color: 'var(--warn, #d79a35)' }}>
                        　C 級切點的角度或淨空已放寬，執行前建議人工複核切面位置。
                      </b>
                    )}
                  </div>
                  {complexityAnalysis && (
                    <div className="segment-analysis">
                      <div className="segment-analysis__summary">
                        <strong>依 3D 複雜度分段</strong>
                        <span>垂直結構 {complexityAnalysis.feature_count} 個</span>
                        <span>複雜區 {complexityAnalysis.regions.length} 個</span>
                        <span>{complexityAnalysis.segments.length} 段</span>
                      </div>

                      {!complexityAnalysis.feasible && (
                        <strong className="segment-analysis__gate-error">
                          {complexityAnalysis.reason}
                        </strong>
                      )}
                      {complexityAnalysis.corner_crossings.length > 0 && (
                        <strong className="segment-analysis__gate-error">
                          {complexityAnalysis.corner_crossings.length} 條訊號從兩刀的
                          交叉點附近穿過——那兩格只共用一個點，切面會退化成點而
                          建不出 Port。
                        </strong>
                      )}

                      <div className="segment-analysis__table-wrap">
                        <table className="segment-analysis__table">
                          <thead>
                            <tr>
                              <th>段</th><th>求解器</th><th>範圍</th>
                              <th>走線</th><th>理由</th>
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
                                <td>
                                  x {seg.bounds_mm[0].toFixed(1)}～{seg.bounds_mm[2].toFixed(1)}
                                  <br />
                                  y {seg.bounds_mm[1].toFixed(1)}～{seg.bounds_mm[3].toFixed(1)}
                                </td>
                                <td>{seg.signal_length_mm.toFixed(1)} mm</td>
                                <td style={{ fontSize: 11 }}>{seg.solver_reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>
                        刀：{complexityAnalysis.cuts.map(cut => (
                          `${cut.manual ? '✋ ' : ''}`
                          + `${cut.direction.toUpperCase()}=${cut.position_mm.toFixed(2)}mm`
                          + `（${cut.quality_grade} 級，離最後一個 3D 結構 `
                          + `${cut.margin_mm.toFixed(2)}mm）`
                        )).join('　')}
                      </div>
                      <div className="status" style={{ marginTop: 4, fontSize: 11 }}>
                        餘裕是「從最後一個垂直結構往外走到第一個符合評分門檻的位置」
                        算出來的，尚未以雙求解器實測校準——這是目前最沒把握的一環，
                        數值一併記進 segments.json 供日後回頭校準。
                      </div>
                      <div className="status" style={{ marginTop: 4, fontSize: 11 }}>
                        自動位置不合意時，可在預覽圖上<b>直接拖曳刀線</b>。放開後會依
                        新位置重新評分——拖到不好的地方就會看到等級掉下來，不會沿用
                        舊分數。刀的把數與方向由偵測到的複雜區決定，拖曳不能增減。
                      </div>

                      {complexityAnalysis.cuts.some(cut => cut.manual) && (
                        <button className="btn" style={{ width: '100%', marginTop: 6 }}
                          onClick={handleComplexityAnalyze}>
                          ↺ 回到自動刀線
                        </button>
                      )}

                      {complexityAnalysis.feasible && (
                        <button className="btn--primary" style={{ width: '100%', marginTop: 7 }}
                          onClick={handleComplexityRun} disabled={!segOutputDir}>
                          依複雜度執行分段（{complexityAnalysis.segments.length} 段）
                        </button>
                      )}
                    </div>
                  )}

                  {segAnalysis && (
                    <div className="segment-analysis">
                      <div className="segment-analysis__summary">
                        <strong>切面評估表</strong>
                        <span>主方向 {segAnalysis.direction.toUpperCase()}</span>
                        <span>門檻 {segAnalysis.quality_threshold} 級以上</span>
                        <span>{segAnalysis.cuts.length} 個切面</span>
                      </div>

                      {/* 段長分布：這是「有沒有加速效果」的關鍵，放在最前面。 */}
                      {segAnalysis.threshold_feasible && (
                        <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>
                          各段長度　{segAnalysis.segment_lengths_mm.map(v => v.toFixed(1)).join('／')} mm
                          　·　最大／最小 <b>{segAnalysis.balance_ratio.toFixed(2)} 倍</b>
                          {segAnalysis.balance_ratio <= 1.5 && '（分布良好）'}
                        </div>
                      )}

                      {!segAnalysis.threshold_feasible && (
                        <strong className="segment-analysis__gate-error">
                          以 {segAnalysis.quality_threshold} 級為門檻找不到可行的切點組合。
                          {segAnalysis.threshold_report.some(r => r.feasible)
                            ? `　放寬到 ${segAnalysis.threshold_report.filter(r => r.feasible)
                                .map(r => `${r.grade} 級（最大段 ${r.max_segment_mm!.toFixed(1)} mm、`
                                  + `${r.balance_ratio!.toFixed(2)} 倍）`).join('、')}`
                              + ' 可行，請改選「可接受評分」後重新分析。'
                            : '　即使放寬到 C 級也無解，請降低分段數 N。下方切面位置僅供參考，不可執行。'}
                        </strong>
                      )}

                      {segAnalysis.balance_warning && (
                        <strong className="segment-analysis__gate-error">
                          {segAnalysis.balance_warning}
                        </strong>
                      )}

                      {!segAnalysis.requested_safe && segAnalysis.threshold_feasible && (
                        <strong className="segment-analysis__gate-error">
                          硬性安全閘門未通過：要求 {segAnalysis.n_segments} 段，最多只能安全切成 {segAnalysis.max_safe_segments} 段。
                        </strong>
                      )}

                      {/* 三個門檻的對照，讓「放寬一級值不值得」一眼可判斷。 */}
                      <div className="status" style={{ marginTop: 6, fontSize: 11 }}>
                        門檻對照：{segAnalysis.threshold_report.map(item => (
                          <span key={item.grade} style={{ marginRight: 10 }}>
                            <b style={{
                              color: item.grade === segAnalysis.quality_threshold
                                ? 'var(--accent)' : undefined,
                            }}>{item.grade} 級</b>
                            {item.feasible
                              ? ` 最大 ${item.max_segment_mm!.toFixed(1)} mm／${item.balance_ratio!.toFixed(2)} 倍`
                              : ' 無解'}
                          </span>
                        ))}
                      </div>
                      <div className="segment-analysis__table-wrap">
                        <table className="segment-analysis__table">
                          <thead>
                            <tr>
                              <th>區域</th>
                              <th>評分</th>
                              <th>位置</th>
                              <th>交點</th>
                              <th>最差角度</th>
                              <th>淨空／建議</th>
                              <th>偏移</th>
                              <th>狀態</th>
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
                              const state = forbidden ? '禁止' : warning ? '警告' : '通過'
                              const details = [
                                ...c.hard_reasons,
                                ...c.risk_reasons,
                                c.poly_hit ? '切到訊號銅箔' : '',
                                c.clearance_ok === false ? '淨空低於建議' : '',
                              ].filter(Boolean).join('；')
                              return (
                                <tr key={i} className={`segment-analysis__row segment-analysis__row--${state}`} title={details || c.quality_reason}>
                                  <td className="segment-analysis__region">S{i + 1}–S{i + 2}</td>
                                  <td>
                                    <span className={`segment-grade segment-grade--${c.quality_grade.toLowerCase()}`}>
                                      {c.quality_grade}
                                    </span>
                                  </td>
                                  <td>{segAnalysis.direction.toUpperCase()}＝{c.position_mm.toFixed(1)} mm</td>
                                  <td>{c.crossing_count}</td>
                                  <td>{c.worst_angle_deg === null ? 'N/A' : `${c.worst_angle_deg.toFixed(1)}°`}</td>
                                  <td>
                                    {c.min_obstacle_mm === null ? 'N/A' : c.min_obstacle_mm.toFixed(2)}／
                                    {c.recommended_clearance_mm.toFixed(2)} mm
                                  </td>
                                  <td>{c.deviation_mm.toFixed(2)} mm</td>
                                  <td><span className={`segment-state segment-state--${state}`}>{state}</span></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      {segAnalysis.auto_profile && (
                        <div className="segment-analysis__rule">
                          自動規則：3×線寬、2×參考層高度，淨空限制
                          {segAnalysis.auto_profile.minimum_clearance_mm.toFixed(2)}～
                          {segAnalysis.auto_profile.maximum_clearance_mm.toFixed(2)}mm；
                          Stackup {segAnalysis.auto_profile.stackup_available ? '已套用' : '資料不足，採線寬與最低值'}。
                        </div>
                      )}
                      {segAnalysis.rejected_candidates.length > 0 && (
                        <details className="segment-analysis__rejected">
                          <summary>
                            查看被拒絕候選與原因（顯示 {segAnalysis.rejected_candidates.length} 筆）
                          </summary>
                          <div className="segment-analysis__rejected-list">
                            {segAnalysis.rejected_candidates.slice(0, 80).map((candidate, index) => (
                              <div key={`${candidate.position_mm}-${index}`}>
                                {segAnalysis.direction.toUpperCase()}={candidate.position_mm.toFixed(3)}mm：
                                {candidate.reasons.join('、')}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input type="text" className="input" value={segOutputDir}
                      onChange={e => setSegOutputDir(e.target.value)}
                      placeholder="分段輸出資料夾…" disabled={!canSegment} />
                  </div>
                  <button
                    className="btn--primary"
                    onClick={handleSegmentRun}
                    disabled={!segAnalysis || !segAnalysis.requested_safe || segAnalysis.cuts.some(c => c.hard_blocked)}
                    style={{ marginTop: 6 }}
                  >
                    執行 N 段分割
                  </button>
                  <button
                    className="btn"
                    onClick={handleSingleSegmentRun}
                    disabled={!canSegment}
                    style={{ marginTop: 6, width: '100%' }}
                    title="整條通道當成一段求解，不做任何切割"
                  >
                    不分割，整片求解
                  </button>
                  <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>
                    不分割不需要先分析切割位置，也不會建立切面 Port——Port 完全
                    來自〈設定 Port 與求解器〉。之後的排程求解、遠端求解包、S 參數
                    與眼圖都照常使用，適合拿來當分段結果的對照基準，或通道本來就
                    小到不必切的情形。
                  </div>
                  {segRun && (
                    <div className="status status--ok" style={{ marginTop: 6, fontSize: 11.5 }}>
                      已產生 {segRun.segments.length} 段，切面 Port 配對
                      {segRun.cut_pairs.reduce((a, c) => a + c.pairs.length, 0)} 組，
                      對應表 segments.json 已輸出。
                    </div>
                  )}
                </div>

                {/* 「排程求解」：排程求解 */}
                <div hidden={!show.schedule}
                  style={{ opacity: (schedMetaPath || segRun) ? 1 : 0.5 }}>
                  <h3 className="panel-title">
                    排程求解{segmentSolverPlans.length > 0 ? '（混合求解區域）' : ''}
                  </h3>
                  <p className="panel-hint">
                    每個 Segment 為一個求解區域。工具會先完成工作副本與 Port 契約預檢，
                    再依序執行 SIwave、HFSS，並寫回 segments.json 供「電路串接」使用。
                  </p>
                  {segmentSolverPlans.length > 0 && (
                    <div className="segment-solver-plan">
                      <div className="segment-solver-plan__toolbar">
                        <strong>混合求解區域</strong>
                        <button className="btn" onClick={() => applySegmentSolverPreset('recommended')}>套用自動建議</button>
                        <button className="btn" onClick={() => applySegmentSolverPreset('hfss')}>全部 HFSS</button>
                        <button className="btn" onClick={() => applySegmentSolverPreset('siwave')}>全部 SIwave</button>
                      </div>
                      <div className="segment-solver-plan__table-wrap">
                        <table className="segment-solver-plan__table">
                          <thead><tr>
                            <th>區域</th><th>建議</th><th>指定</th><th>複雜度</th><th>信心</th><th>判斷原因</th>
                          </tr></thead>
                          <tbody>
                            {segmentSolverPlans.map(plan => (
                              <tr key={plan.index} className={plan.overridden ? 'is-overridden' : ''}>
                                <td>S{plan.index}</td>
                                <td><span className={`solver-badge solver-badge--${plan.recommended_solver}`}>
                                  {plan.recommended_solver.toUpperCase()}
                                </span></td>
                                <td>
                                  <select
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
                                  {plan.overridden && <span className="segment-solver-plan__warning" title="使用者已覆寫工具建議">⚠</span>}
                                </td>
                                <td>{plan.complexity_score}</td>
                                <td>{Math.round(plan.confidence * 100)}%</td>
                                <td className="segment-solver-plan__reason" title={(plan.reasons || []).join('；')}>
                                  {(plan.reasons || []).join('；')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">求解核心數</div>
                      <input type="number" className="input" min="1" step="1"
                        value={solverCores}
                        onChange={event => setSolverCores(event.target.value)}
                        disabled={schedStatus?.running} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">記憶體安全預算（%）</div>
                      <input type="number" className="input" min="10" max="95" step="5"
                        value={solverMemoryPercent}
                        onChange={event => setSolverMemoryPercent(event.target.value)}
                        disabled={schedStatus?.running} />
                    </div>
                  </div>
                  {solverResourcePreview && (
                    <div className="status" style={{ marginTop: 5, fontSize: 11 }}>
                      實際套用 {solverResourcePreview.effective_cores}／
                      {solverResourcePreview.available_cores} 核心；記憶體安全預算
                      {solverResourcePreview.memory_limit_gb.toFixed(1)} GB
                      （{solverResourcePreview.effective_memory_percent}%），保留至少 4 GB 給系統。
                    </div>
                  )}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input type="text" className="input" value={schedMetaPath}
                      onChange={e => setSchedMetaPath(e.target.value)}
                      onBlur={() => {
                        const path = normalizeUserPath(schedMetaPath)
                        setSchedMetaPath(path)
                        if (path) loadSegmentSolverPlan(path, false)
                      }}
                      placeholder="segments.json 路徑（分段後自動帶入，也可指向既有的）…" />
                    <button className="btn" onClick={async () => {
                      try {
                        const data = await api('/api/browse_segments_json')
                        if (!data.path) return
                        const path = normalizeUserPath(data.path)
                        setSchedMetaPath(path)
                        loadSegmentSolverPlan(path, false)
                      } catch (e) { alert('選取失敗: ' + String(e)) }
                    }}>瀏覽…</button>
                  </div>
                  {/* 分段一次要二十分鐘以上。換個求解器設定、改核心數或重打一次包
                      都不該逼人整段重跑——指向既有的 segments.json 就能直接接上。 */}
                  <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>
                    <b>不必重跑分段</b>：指向先前產生的 segments.json（在分段輸出
                    資料夾內）即可直接排程求解或打包，逐段的求解器指派會一併載入。
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button
                      className="btn--primary"
                      style={{ flex: 2 }}
                      onClick={handleScheduleStart}
                      disabled={!schedMetaPath || schedStatus?.running}
                    >
                      {schedStatus?.running
                        ? `${schedStatus.solver === 'mixed' ? '混合求解器' : schedStatus.solver === 'siwave' ? 'SIwave' : 'HFSS'} 排程執行中…`
                        : segmentSolverPlans.length > 0
                          ? '開始混合求解排程模擬'
                          : '開始排程模擬'}
                    </button>
                    <button
                      className="btn"
                      style={{ flex: 1 }}
                      onClick={handleScheduleStop}
                      disabled={!schedStatus?.running}
                    >停止</button>
                  </div>
                  {schedMetaPath && !schedStatus?.running && (
                    <button
                      className="btn"
                      style={{ width: '100%', marginTop: 6 }}
                      onClick={() => handleRetryTouchstoneExports()}
                    >
                      檢查並重試待匯出的 Touchstone（不重新求解）
                    </button>
                  )}
                  {show.remotepack && schedMetaPath && !schedStatus?.running && (
                    <div style={{ marginTop: 8, paddingTop: 8,
                                  borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="field-label">遠端求解包（求解機不需安裝 Python）</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <input className="input" style={{ flex: 1 }} value={packDir}
                          onChange={e => setPackDir(e.target.value)}
                          placeholder="輸出資料夾…（需為新資料夾，例如 jobs\\pack1）" />
                        <button className="btn" onClick={handleBuildRemotePack}
                          disabled={packBusy}>
                          {packBusy ? '打包中…' : '匯出求解包'}
                        </button>
                      </div>
                      <div className="panel-hint" style={{ marginTop: 4, fontSize: 11 }}>
                        SIwave 與 HFSS 段可混在同一包。複製到求解機後雙擊
                        run_all.bat，跑完把 results 複製回來；腳本會自動偵測求解機
                        本地的 AEDT 版本。
                      </div>
                      <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>
                        <b>上面的求解核心數兩種段都會套用</b>，用的是你填的值，不會被
                        這台電腦的核心數夾住：SIwave 寫進 .exec 的 SetNumCpus，HFSS 以
                        ansysedt 的 -batchoptions 傳入。
                        <b style={{ color: 'var(--warn)' }}>但它受 HPC 授權限制</b>——
                        HFSS 求解內含 4 核，超出的每一核要一張 anshpc 授權
                        （12 核就佔 8 張）。授權不夠時求解包會明白寫出「只有 N 核
                        可用」與建議值。
                      </div>
                      <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>
                        HPC 授權型別不必設定：SIwave 段先試 Pack，取不到足夠授權就
                        自動改用 Workgroup 重試；HFSS 段一律用 <b>Auto</b> 讓 AEDT
                        自己挑當下取得到的授權——實測寫死 Pack 反而會落到 Parametric
                        而只拿到 4 核。同一包在兩種機器上都跑得動。
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <input className="input" style={{ flex: 1 }} value={ingestDir}
                          onChange={e => setIngestDir(e.target.value)}
                          placeholder="求解完的資料夾…（求解包或其中的 results）" />
                        <button className="btn" onClick={handleIngestResults}
                          disabled={ingestBusy}>
                          {ingestBusy ? '收檔中…' : '收回結果'}
                        </button>
                      </div>
                      <div className="panel-hint" style={{ marginTop: 4, fontSize: 11 }}>
                        收回時會驗證 Port 數、頻點與格式，通過才寫入 segments.json；
                        之後串接與眼圖都能直接使用。
                      </div>
                    </div>
                  )}
                  {schedStatus && schedStatus.jobs?.length > 0 && (
                    <div className="netlist" style={{ marginTop: 6, maxHeight: 130, overflowY: 'auto' }}>
                      {schedStatus.jobs.map((j: any) => {
                        const labels: Record<string, [string, string]> = {
                          pending: ['等待中', 'var(--faint)'],
                          running: ['求解中…', 'var(--accent)'],
                          solved_pending_export: ['待匯出', 'var(--warn)'],
                          done: ['完成', 'var(--ok)'],
                          failed: ['失敗', 'var(--danger)'],
                          stopped: ['已停止', 'var(--warn)'],
                          skipped: ['已跳過', 'var(--warn)'],
                        }
                        const [txt, color] = labels[j.status] || [j.status, 'var(--muted)']
                        const elapsed = jobElapsedSec(j, nowTick)
                        return (
                          <div key={j.index} className="netlist__row" title={j.error || j.touchstone || ''}>
                            <span style={{ fontWeight: 700, minWidth: 42 }}>段 {j.index}</span>
                            <span className={`solver-badge solver-badge--${j.solver || 'hfss'}`}>
                              {(j.solver || 'hfss').toUpperCase()}
                            </span>
                            <span style={{ color, fontWeight: 600, minWidth: 56 }}>{txt}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 68 }}>
                              {elapsed !== null ? formatElapsed(elapsed) : ''}
                            </span>
                            <span className="netlist__name" style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {j.status === 'done' && j.touchstone ? j.touchstone.split(/[\\/]/).pop()
                                : j.status === 'failed' ? (j.error || '')
                                  : j.status === 'solved_pending_export'
                                    ? (j.error || '求解結果已保留，可重新匯出')
                                    : j.status === 'running'
                                      ? <>
                                          <span>{j.phase || '活動中'}
                                            {j.progress_detail ? `：${j.progress_detail}` : ''}
                                          </span>
                                          {!j.progress_detail && j.monitor_data && (
                                            <span>（Adaptive {j.monitor_data.convergence || 0}／
                                              Sweep {j.monitor_data.sweptvar || 0}）</span>
                                          )}
                                          {j.stall_warning && (
                                            <span style={{ display: 'block', color: 'var(--warn)', fontWeight: 700 }}>
                                              ⚠ 約 {Math.max(1, Math.floor((j.stall_seconds || 0) / 60))}
                                              分鐘沒有可觀測活動；工具不會自動停止。
                                            </span>
                                          )}
                                        </>
                                      : ''}
                            </span>
                            {j.status === 'solved_pending_export' && !schedStatus?.running && (
                              <button
                                className="btn"
                                style={{ padding: '2px 7px', fontSize: 10.5 }}
                                onClick={() => handleRetryTouchstoneExports(j.index)}
                                title="只開啟既有 AEDT 結果並匯出，不會重新求解"
                              >
                                重新匯出
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 「電路串接」：電路串接 */}
                <div hidden={!(show.cascade)}>
                  <h3 className="panel-title">電路串接</h3>
                  <p className="panel-hint">
                    切面 Port 依配對表對接（Stripline 雙參考 Port 先短路成節點），
                    還原完整通道 S 參數。可先「預覽接線」看電路示意圖再執行。
                  </p>
                  {/* 模式切換 */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {([['tool', '本工具分段結果'], ['external', '外部 S 參數檔']] as const).map(([m, label]) => (
                      <button key={m} className="btn" onClick={() => handleCascadeModeChange(m)}
                        disabled={circuitBusy || cascadeBusy}
                        style={{
                          flex: 1, fontWeight: cascadeMode === m ? 700 : 400,
                          borderColor: cascadeMode === m ? 'var(--accent)' : undefined,
                          color: cascadeMode === m ? 'var(--accent)' : undefined,
                        }}>{label}</button>
                    ))}
                  </div>

                  {cascadeMode === 'tool' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, opacity: schedMetaPath ? 1 : 0.5 }}>
                      <button className="btn" style={{ flex: 1 }}
                        onClick={handleCascadePreview} disabled={!schedMetaPath}
                        title="只讀 segments.json，分段完成（尚未解算）即可預覽接線">
                        預覽接線
                      </button>
                      <button
                        className="btn--primary"
                        style={{ flex: 1.4 }}
                        onClick={handleCascadeRun}
                        disabled={!schedMetaPath || cascadeBusy || circuitBusy}
                      >
                        {cascadeBusy ? '串接中…' : '執行電路串接'}
                      </button>
                    </div>
                  )}

                  {cascadeMode === 'external' && (
                    <div style={{ marginTop: 6 }}>
                      {/* 檔案清單 */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn" style={{ flex: 1 }} onClick={handleBrowseTouchstone}>
                          + 加入 S 參數檔（可多選）
                        </button>
                        <button className="btn" onClick={() => { setExtFiles([]); setExtConns([]); setExtShorts([]) }}
                          disabled={extFiles.length === 0}>清空</button>
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
                            {cascadeBusy ? '載入中…' : '直接檢視這個檔（不接線）'}
                          </button>
                          <div className="status" style={{ marginTop: 5, fontSize: 11.5 }}>
                            單一檔案沒有段可接。整片板子一次解完的 .sNp 用這個
                            按鈕直接進「S 參數」分頁，切到<b>差動</b>就會自動列出
                            每一對的 Sdd21（IL）、Sdd11（RL）與 NEXT／FEXT——
                            差動對由檔頭的 Port 名稱自動配（…TXP… ↔ …TXN…），
                            遠近端由兩端的元件代號判定。
                          </div>
                          <div className="status" style={{ marginTop: 4, fontSize: 11 }}>
                            要接線請再加入第二個檔。
                          </div>
                        </>
                      )}

                      {extFiles.length >= 2 && (
                        <>
                          <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={handleExtSuggest}
                            title="Port 名稱符合本工具慣例（SEGk_R/L_…）或相鄰檔同名時自動配對">
                            自動建議接線
                          </button>

                          {/* 接線表 */}
                          <div className="field-label" style={{ marginTop: 8 }}>
                            接線（{extConns.length}）
                          </div>
                          {extConns.map((c, i) => (
                            <div key={i} style={{ display: 'flex', gap: 3, marginTop: 3, alignItems: 'center' }}>
                              <select className="input" style={{ width: 46, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.a_file}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, a_file: +e.target.value, a_port: extFiles[+e.target.value]?.port_names[0] || '' } : x))}>
                                {extFiles.map((_, fi) => <option key={fi} value={fi}>#{fi + 1}</option>)}
                              </select>
                              <select className="input" style={{ flex: 1, minWidth: 0, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.a_port}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, a_port: e.target.value } : x))}>
                                {(extFiles[c.a_file]?.port_names || []).map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                              <span style={{ fontSize: 10 }}>↔</span>
                              <select className="input" style={{ width: 46, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.b_file}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, b_file: +e.target.value, b_port: extFiles[+e.target.value]?.port_names[0] || '' } : x))}>
                                {extFiles.map((_, fi) => <option key={fi} value={fi}>#{fi + 1}</option>)}
                              </select>
                              <select className="input" style={{ flex: 1, minWidth: 0, padding: '2px 3px', fontSize: 10.5 }}
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
                            }])}>+ 新增接線</button>

                          {/* 短路群組表（stripline T/B）*/}
                          <div className="field-label" style={{ marginTop: 8 }}>
                            短路群組（{extShorts.length}）——同檔兩個 Port 短接成一個節點
                          </div>
                          {extShorts.map((s, i) => (
                            <div key={i} style={{ display: 'flex', gap: 3, marginTop: 3, alignItems: 'center' }}>
                              <select className="input" style={{ width: 46, padding: '2px 3px', fontSize: 10.5 }}
                                value={s.file}
                                onChange={e => {
                                  const fi = +e.target.value
                                  const pn = extFiles[fi]?.port_names || []
                                  setExtShorts(prev => prev.map((x, k) => k === i ? { file: fi, ports: [pn[0] || '', pn[1] || pn[0] || ''] } : x))
                                }}>
                                {extFiles.map((_, fi) => <option key={fi} value={fi}>#{fi + 1}</option>)}
                              </select>
                              {[0, 1].map(pi => (
                                <select key={pi} className="input" style={{ flex: 1, minWidth: 0, padding: '2px 3px', fontSize: 10.5 }}
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
                            }])}>+ 新增短路群組</button>

                          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            <button className="btn" style={{ flex: 1 }} onClick={handleExtPreview}>
                              預覽接線
                            </button>
                            <button className="btn--primary" style={{ flex: 1.4 }}
                              onClick={handleExtRun}
                              disabled={cascadeBusy || circuitBusy || extConns.length === 0}>
                              {cascadeBusy ? '串接中…' : '執行串接'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {cascadeResult && (
                    <>
                      <div className="status status--ok" style={{ marginTop: 6, fontSize: 11.5 }}>
                        完成：{cascadeResult.n_ports} port、
                        {cascadeResult.freq_min_ghz?.toFixed(2)}~{cascadeResult.freq_max_ghz?.toFixed(2)} GHz
                        （{cascadeResult.freq_points} 點），max|S|={cascadeResult.max_s_magnitude?.toFixed(3)}
                        <div style={{ wordBreak: 'break-all', color: 'var(--muted)', marginTop: 2 }}>
                          {cascadeResult.output_path}
                        </div>
                        {cascadeResult.summary_path && (
                          <div style={{ wordBreak: 'break-all', color: 'var(--faint)', marginTop: 2 }}>
                            JSON 摘要：{cascadeResult.summary_path}
                          </div>
                        )}
                      </div>
                      {cascadeMode === 'tool' && (
                        <button className="btn" onClick={handleCascadeExportAs}
                          disabled={cascadeBusy}
                          style={{ width: '100%', marginTop: 6 }}>
                          一鍵另存完整 Touchstone
                        </button>
                      )}
                      <div hidden={!show.eye} style={{
                        marginTop: 8, padding: 8, border: '1px solid var(--border)',
                        borderRadius: 7, background: 'rgba(40, 70, 110, 0.08)',
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>眼圖（QuickEye）</div>
                        <div className="panel-hint" style={{ marginTop: 3 }}>
                          直接以上方串接完成的 Touchstone 求解眼圖，不需先輸出 Circuit 專案；
                          背景執行，結果顯示於「眼圖」分頁。
                        </div>
                        <details style={{ marginTop: 6 }}>
                          <summary className="panel-hint" style={{ cursor: 'pointer' }}>
                            進階：另外輸出 Circuit 專案（不求解）
                          </summary>
                          <div className="field-row" style={{ marginTop: 6 }}>
                            <div style={{ flex: 1 }}>
                              <div className="field-label">Circuit 形式</div>
                              <select className="input" value={circuitExportMode}
                                onChange={event => setCircuitExportMode(event.target.value as 'complete' | 'segments')}>
                                <option value="complete">完整通道單一元件</option>
                                <option value="segments" disabled={cascadeMode !== 'tool'}>保留 N 段展示接線</option>
                              </select>
                            </div>
                            <button className="btn" onClick={handleCircuitExport}
                              disabled={circuitBusy || cascadeBusy} style={{ flex: 1 }}>
                              {circuitBusy ? 'Circuit 處理中…' : '輸出 Circuit（不求解）'}
                            </button>
                          </div>
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
                                <div className="field-label">眼圖模式</div>
                                <select className="input" value={eyeMode}
                                  onChange={event => setEyeMode(event.target.value as 'single' | 'differential')}>
                                  <option value="single" disabled={cascadeResult.n_ports !== 2}>單端（2-Port）</option>
                                  <option value="differential" disabled={cascadeResult.n_ports !== 4}>差動（4-Port）</option>
                                </select>
                              </div>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">資料速率（Gbps）</div>
                                <input className="input" type="number" min="0.001" step="0.1"
                                  value={eyeDataRate}
                                  onChange={event => {
                                    setEyeDataRate(event.target.value)
                                    // Tr／Tf 依速率自動更新；仍可手動覆寫
                                    const auto = riseTimePsFor(Number(event.target.value))
                                    if (auto !== null) setEyeRiseTime(String(auto))
                                  }} />
                              </div>
                              <div style={{ flex: 1 }}
                                title="Tr = 0.2 × UI，即發送端驅動器的邊緣速率（高速串列連結常見 20～35% UI）。改資料速率會自動重算，也可自行覆寫。">
                                <div className="field-label">Tr／Tf（ps）</div>
                                <input className="input" type="number" min="0.001" step="0.1"
                                  value={eyeRiseTime} onChange={event => setEyeRiseTime(event.target.value)} />
                              </div>
                            </div>
                            <div className="field-row" style={{ marginTop: 5 }}>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">輸入 P</div>
                                <select className="input" value={eyeInputP}
                                  onChange={event => setEyeInputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {eyeMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">輸入 N</div>
                                  <select className="input" value={eyeInputN}
                                    onChange={event => setEyeInputN(event.target.value)}>
                                    {cascadeResult.port_names.map((name: string) =>
                                      <option key={name} value={name}>{name}</option>)}
                                  </select>
                                </div>
                              )}
                              <div style={{ flex: 1 }}>
                                <div className="field-label">輸出 P</div>
                                <select className="input" value={eyeOutputP}
                                  onChange={event => setEyeOutputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {eyeMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">輸出 N</div>
                                  <select className="input" value={eyeOutputN}
                                    onChange={event => setEyeOutputN(event.target.value)}>
                                    {cascadeResult.port_names.map((name: string) =>
                                      <option key={name} value={name}>{name}</option>)}
                                  </select>
                                </div>
                              )}
                            </div>
                            <button className="btn btn--primary" style={{ width: '100%', marginTop: 6 }}
                              disabled={circuitBusy || cascadeBusy || !eyeSuggestion.quick_eye_supported}
                              onClick={handleQuickEye}>
                              {circuitBusy ? '眼圖求解中…（背景執行）' : '執行眼圖'}
                            </button>
                          </>
                        )}
                        {eyeSuggestionError && (
                          <div className="status status--warn" style={{ marginTop: 6, fontSize: 11 }}>
                            {eyeSuggestionError}
                            <button className="btn" style={{ marginLeft: 6, padding: '2px 7px' }}
                              disabled={circuitBusy || cascadeBusy}
                              onClick={() => setEyeSuggestionRevision(value => value + 1)}>
                              重新取得建議
                            </button>
                          </div>
                        )}
                        {circuitError && (
                          <div className="status status--warn"
                            style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
                            上次 Circuit／QuickEye 執行失敗：{circuitError}
                          </div>
                        )}
                        {circuitResult && (
                          <div className="status status--ok"
                            style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
                            {circuitResult.solved ? 'QuickEye 完成' : 'Circuit 已輸出'}：
                            {circuitResult.output_path}
                            {circuitResult.image_path && <div>眼圖：{circuitResult.image_path}</div>}
                          </div>
                        )}
                      </div>
                      {/* S 參數曲線檢視 */}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'flex-end' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="field-label">Port A</div>
                          <select className="input" value={cascPortA} onChange={e => setCascPortA(e.target.value)}>
                            {cascadeResult.port_names.map((p: string) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="field-label">Port B</div>
                          <select className="input" value={cascPortB} onChange={e => setCascPortB(e.target.value)}>
                            {cascadeResult.port_names.map((p: string) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button className="btn" style={{ flex: 1 }} onClick={handleCascadeAddCurve}>
                          加入曲線 S(A,B)
                        </button>
                        <button className="btn" onClick={() => setCascSeries([])} disabled={cascSeries.length === 0}>
                          清除
                        </button>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <div onDoubleClick={() => cascSeries.length && setChartExpanded(true)}
                          title="雙擊放大 S 參數圖" style={{ cursor: cascSeries.length ? 'zoom-in' : 'default' }}>
                          <SParamChart series={cascSeries} />
                        </div>
                        <button className="btn" style={{ width: '100%', marginTop: 5 }}
                          disabled={cascSeries.length === 0}
                          onClick={() => setChartExpanded(true)}>
                          ⛶ 放大 S 參數圖
                        </button>
                      </div>
                    </>
                  )}
                </div>

              </div>
            </div>
          </Allotment.Pane>

          {/* 右側：預覽與日誌 */}
          <Allotment.Pane>
            <div style={{ paddingLeft: 7, height: '100%', display: 'flex', flexDirection: 'column' }}>
              {/* 檢視分頁 */}
              <div className="viewtabs" style={{ marginBottom: 0 }}>
                <button
                  className={'viewtab' + (activeView === 'full' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('full')}
                >完整 Layout</button>
                <button
                  hidden={!(show.cutout || show.ports || show.stackup || show.backdrill)}
                  className={'viewtab' + (activeView === 'cut' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('cut')}
                  disabled={!cutScene}
                >裁切後 Layout</button>
                <button
                  hidden={!(show.cleanup)}
                  className={'viewtab' + (activeView === 'cleanup' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('cleanup')}
                  disabled={!cleanupAfterScene}
                >清理對比</button>
                <button
                  hidden={!(show.segment || show.schedule)}
                  className={'viewtab' + (activeView === 'segments' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('segments')}
                  disabled={!segAnalysis && !segRun}
                >N 段分割</button>
                <button
                  hidden={!(show.cascade)}
                  className={'viewtab' + (activeView === 'schematic' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('schematic')}
                  disabled={!schematicGraph}
                >串接電路</button>
                <button
                  hidden={!(show.sparam)}
                  className={'viewtab' + (activeView === 'sparam' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('sparam')}
                  disabled={!cascadeResult}
                >S 參數</button>
                <button
                  hidden={!(show.eye)}
                  className={'viewtab' + (activeView === 'eye' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('eye')}
                  disabled={!eyeJob || eyeJob.status === 'idle'}
                >眼圖</button>
                <button
                  hidden={!(show.report)}
                  className={'viewtab' + (activeView === 'report' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('report')}
                >報告</button>
                {show.report && reportSnapshotAvailable && (
                  <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                    <ReportSnapshotButton
                      basePath={reportBasePath}
                      projectName={reportProjectName}
                      targetId="report-result-capture"
                      kind={activeView === 'segments' && segRun && !isOverviewMode
                        ? `segments-${activeSegIdx + 1}` : activeView}
                      title={sceneLabel}
                      section={reportSectionByView[activeView]}
                      sourceRevision={reportSourceRevision}
                      sourceMetadata={{
                        signal_net_count: signalNets.length,
                        reference_net_count: refNets.length,
                        segment_count: segRun?.segments?.length || segAnalysis?.n_segments || 0,
                      }}
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
                      <div id="report-result-capture" className="panel" style={{ overflow: 'hidden', position: 'relative', height: '100%', background: '#0c0e12', borderTopLeftRadius: 0 }}>
                        {(isLayoutView || activeView === 'schematic') && <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 1, fontSize: 12.5, fontWeight: 700, color: activeView === 'cut' ? '#7ee787' : '#9fb0c3', pointerEvents: 'none' }}>
                          {sceneLabel}
                          {scene?.preview_mode === 'coarse' ? ' · 大板快速預覽（實際 EDB 未簡化）' : ''}
                          {activeView !== 'schematic' ? ' · 左鍵平移、滾輪縮放 · 右側 ◀▶ 展開圖層面板' : ''}
                          {activeView === 'cut' && completedBoundary?.comparison?.available
                            ? ` · 外框最大差異 ${completedBoundary.comparison.max_boundary_error_mm?.toFixed(3)} mm`
                            : ''}
                        </div>}
                        {activeView === 'report' ? (
                          <ReportCenter basePath={reportBasePath} projectName={reportProjectName}
                            onWorkspaceChange={rememberReportWorkspace} />
                        ) : activeView === 'eye' ? (
                          <div style={{
                            height: '100%', overflow: 'hidden', padding: 14,
                            display: 'flex', flexDirection: 'column', gap: 8,
                            fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
                            color: '#d8e1ec',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                              <div>
                                <h2 style={{ margin: 0, fontSize: 20 }}>QuickEye 眼圖</h2>
                                <div style={{ color: '#8fa1b5', fontSize: 12, marginTop: 4 }}>
                                  直接以現有串接 Touchstone 求解；專案檔保留於 eye_results，可用 AEDT 開啟檢查。
                                </div>
                              </div>
                              {eyeJob?.result && (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {([
                                    ['資料速率', `${eyeJob.result.data_rate_gbps} Gbps`],
                                    ['上升／下降', `${eyeJob.result.rise_time_ps} ps`],
                                    ['模式', eyeJob.result.mode === 'differential' ? '差動' : '單端'],
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
                              <div className="status" style={{ marginTop: 14 }}>
                                {eyeJob.phase}…　已耗時 {eyeJob.started_at
                                  ? Math.max(0, Math.round(nowTick - eyeJob.started_at))
                                  : 0} 秒（背景求解，可切換到其他分頁）
                              </div>
                            )}
                            {eyeJob?.status === 'error' && (
                              <div className="status status--warn" style={{ marginTop: 14 }}>
                                眼圖求解失敗：{eyeJob.error}
                              </div>
                            )}

                            {eyeJob?.result?.measurements && Object.keys(eyeJob.result.measurements).length > 0 && (
                              <div style={{
                                display: 'grid', gap: 8,
                                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                              }}>
                                {Object.entries(eyeJob.result.measurements).map(([key, item]: [string, any]) => (
                                  <div key={key} style={{
                                    border: '1px solid #303a48', borderRadius: 7,
                                    background: '#131820', padding: '8px 10px',
                                  }}>
                                    <div style={{ color: '#93a4b8', fontSize: 11 }}>{item.label || key}</div>
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
                                  alt="QuickEye 眼圖"
                                  style={{
                                    flex: 1, minHeight: 0, maxWidth: '100%',
                                    objectFit: 'contain', borderRadius: 6, background: '#fff',
                                  }}
                                />
                                <div style={{
                                  color: '#718096', fontSize: 10.5, marginTop: 6,
                                  wordBreak: 'break-all', flexShrink: 0,
                                }}>
                                  {eyeJob.result?.image_path}
                                </div>
                              </div>
                            )}
                            {!eyeJob?.running && eyeJob?.status !== 'done' && eyeJob?.status !== 'error' && (
                              <div className="status" style={{ marginTop: 14 }}>
                                尚未執行眼圖。請先完成「電路串接」後按「執行眼圖」。
                              </div>
                            )}
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
                              <h2 style={{ margin: 0, fontSize: 15 }}>串接後 S 參數</h2>
                              <div style={{ color: '#8fa1b5', fontSize: 10.5 }}>
                                {spData ? `近端 ${spData.near} → 遠端 ${spData.far}｜`
                                  + `${spData.mode === 'diff' ? `${spData.pair_count} 對差動` : `${spData.net_count} 條單端`}`
                                  : '由 Port 名稱自動判斷兩端與差動配對'}
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                              <div style={{ display: 'flex', gap: 4 }}>
                                {([['diff', '差動模式'], ['single', '單端模式']] as const).map(([m, label]) => (
                                  <button key={m}
                                    className={'btn' + (spMode === m ? ' btn--primary' : '')}
                                    style={{ padding: '3px 12px', fontSize: 11.5 }}
                                    onClick={() => setSpMode(m as 'single' | 'diff')}>{label}</button>
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: '#b8c6d8' }}>
                                {([['il', '插入損耗'], ['rl', '回波損耗'],
                                   ['next', 'NEXT 近端串音'], ['fext', 'FEXT 遠端串音']] as const).map(([k, label]) => (
                                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                                    <input type="checkbox" checked={!!spKinds[k]}
                                      onChange={e => setSpKinds({ ...spKinds, [k]: e.target.checked })} />
                                    {label}
                                  </label>
                                ))}
                              </div>
                              {spBusy && <span style={{ fontSize: 11, color: '#8fa1b5' }}>計算中…</span>}
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
                                // undefined.map() 讓整個畫面崩掉。
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
                              <span>來源：{cascadeResult.output_path}</span>
                              <span>
                                {spMode === 'diff'
                                  ? '差動模式：以 scikit-rf 混合模式轉換，Sdd21＝差模插入損耗、Sdd11＝差模回波損耗'
                                  : '單端模式：IL＝近端至遠端、RL＝近端反射'}
                              </span>
                            </div>
                          </div>
                        ) : activeView === 'cleanup' && cleanupBeforeScene && cleanupAfterScene ? (
                          <div className="cleanup-compare">
                            <div className="cleanup-compare__toolbar">
                              <strong>Layout 清理前後對比</strong>
                              <div className="cleanup-compare__modes">
                                {([
                                  ['overlay', '差異高亮'],
                                  ['side-by-side', '並排'],
                                  ['before', '清理前'],
                                  ['after', '清理後'],
                                ] as [CleanupCompareMode, string][]).map(([mode, label]) => (
                                  <button key={mode}
                                    className={'cleanup-compare__mode' + (cleanupCompareMode === mode ? ' cleanup-compare__mode--active' : '')}
                                    onClick={() => setCleanupCompareMode(mode)}>{label}</button>
                                ))}
                              </div>
                              {cleanupAnalysis?.comparison && (
                                <div className="cleanup-compare__stats">
                                  <span>Primitive：{cleanupAnalysis.comparison.before.primitive.toLocaleString()} → {cleanupAnalysis.comparison.after.primitive.toLocaleString()}</span>
                                  <span>Padstack：{cleanupAnalysis.comparison.before.padstack.toLocaleString()} → {cleanupAnalysis.comparison.after.padstack.toLocaleString()}</span>
                                  <span>EDB：{formatBytes(cleanupAnalysis.comparison.before.file_bytes)} → {formatBytes(cleanupAnalysis.comparison.after.file_bytes)}</span>
                                </div>
                              )}
                            </div>
                            {cleanupCompareMode === 'overlay' && (
                              <div className="cleanup-compare__filters">
                                <select value={cleanupDiffKind} onChange={e => setCleanupDiffKind(e.target.value as 'all' | 'primitive' | 'via')}>
                                  <option value="all">全部差異</option>
                                  <option value="primitive">僅銅箔／走線</option>
                                  <option value="via">僅 Via</option>
                                </select>
                                <select value={cleanupDiffLayer} onChange={e => setCleanupDiffLayer(e.target.value)}>
                                  <option value="">全部 Layer</option>
                                  {cleanupDifferenceLayers.map(layer => <option key={layer} value={layer}>{layer}</option>)}
                                </select>
                              </div>
                            )}
                            <div className={'cleanup-compare__canvas cleanup-compare__canvas--' + cleanupCompareMode}>
                              {(cleanupCompareMode === 'side-by-side' || cleanupCompareMode === 'before') && (
                                <div className="cleanup-compare__pane">
                                  <div className="cleanup-compare__label cleanup-compare__label--before">清理前</div>
                                  <Preview2D data={cleanupBeforeScene} fitKey={`cleanup-before-${cleanupCompareMode}`}
                                    signalNets={signalNets} refNets={refNets} highlightNets={[...signalNets, ...refNets]}
                                    layerPanelEnabled={cleanupCompareMode !== 'side-by-side'} />
                                </div>
                              )}
                              {(cleanupCompareMode === 'side-by-side' || cleanupCompareMode === 'after') && (
                                <div className="cleanup-compare__pane">
                                  <div className="cleanup-compare__label cleanup-compare__label--after">清理後</div>
                                  <Preview2D data={cleanupAfterScene} fitKey={`cleanup-after-${cleanupCompareMode}`}
                                    signalNets={signalNets} refNets={refNets} highlightNets={[...signalNets, ...refNets]}
                                    layerPanelEnabled={cleanupCompareMode !== 'side-by-side'} />
                                </div>
                              )}
                              {cleanupCompareMode === 'overlay' && (
                                <div className="cleanup-compare__pane">
                                  <div className="cleanup-compare__label cleanup-compare__label--overlay">
                                    紅色＝移除銅箔／走線　橘色＝移除 Via
                                  </div>
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
                                      <div className="cleanup-regions__title">差異密集區</div>
                                      <button className={cleanupFocusRegion === null ? 'active' : ''}
                                        onClick={() => setCleanupFocusRegion(null)}>全部差異</button>
                                      {cleanupAnalysis.difference_regions.map((region, index) => (
                                        <button key={index} className={cleanupFocusRegion === index ? 'active' : ''}
                                          onClick={() => setCleanupFocusRegion(index)}>
                                          區域 {index + 1}<small>{region.count} 個（銅 {region.primitive}／Via {region.via}）</small>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  {cleanupAnalysis?.removed_geometry?.truncated && (
                                    <div className="cleanup-compare__warning">
                                      差異物件過多，已高亮前 {cleanupAnalysis.removed_geometry.rendered.toLocaleString()} 個；統計仍包含全部物件。
                                    </div>
                                  )}
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
                          data={scene}
                          fitKey={activeView + inputPath + (activeView === 'segments' && segRun ? `_seg${activeSegIdx}` : '') + (cleanupOverlay ? `_clean${cleanupOverlay.total}` : '')}
                          signalNets={signalNets}
                          refNets={refNets}
                          highlightNets={[...signalNets, ...refNets]}
                          expansionMm={activeView === 'full' && signalNets.length > 0 ? parseFloat(expansionMm) || 0 : undefined}
                          extentType={extentType}
                          estimatedCutoutBoundary={visibleEstimatedBoundary}
                          actualCutoutBoundary={visibleActualBoundary}
                          showBoundaryDifferenceFill={showCutoutDifferenceFill}
                          onBoundaryDifferenceFillChange={activeView === 'cut' ? setShowCutoutDifferenceFill : undefined}
                          boundaryComparison={activeView === 'cut' ? completedBoundary?.comparison || null : null}
                          segmentCuts={segCutsOverlay}
                          showSegmentSafetyOverlay={showSegmentSafetyOverlay}
                          onSegmentSafetyOverlayChange={activeView === 'segments' ? setShowSegmentSafetyOverlay : undefined}
                          showSolverRegionOverlay={showSolverRegionOverlay}
                          onSolverRegionOverlayChange={activeView === 'segments' ? setShowSolverRegionOverlay : undefined}
                          onSegmentRegionClick={activeView === 'segments' && showSolverRegionOverlay && segmentSolverPlans.length > 0
                            ? index => {
                                const plan = segmentSolverPlans[index]
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
                              title="顯示完整板 + 切割線，確認每段在整體電路中的位置"
                            >整體視圖</button>
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
                                title={`切面 Port：${s.cut_ports.flatMap((t: any) => (t.ports || []).map((p: any) => p.name)).join('、') || '無'}`}
                              >第 {s.index} 段</button>
                            ))}
                          </div>
                        )}

                        {!scene && isLayoutView && (
                          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#5c677d', fontSize: 14, pointerEvents: 'none' }}>
                            請先於左側載入電路板檔案
                          </div>
                        )}
                      </div>
                    </div>
                  </Allotment.Pane>

                  {/* 日誌面板 */}
                  {showLogs && (
                    <Allotment.Pane minSize={90}>
                      <div style={{ paddingTop: 7, height: '100%' }}>
                        <div className="panel" style={{ height: '100%', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <h3 className="panel-title" style={{ margin: 0 }}>系統日誌</h3>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn" style={{ fontSize: 12, padding: '2px 10px' }}
                                onClick={() => navigator.clipboard.writeText(logs.join('\n'))}>複製</button>
                              <button className="btn" style={{ fontSize: 12, padding: '2px 10px' }}
                                onClick={() => setLogs([])}>清除</button>
                            </div>
                          </div>
                          <div ref={logBoxRef} style={{ flex: 1, overflowY: 'auto', fontSize: '12px', fontFamily: '"Cascadia Mono", monospace', color: 'var(--muted)', background: 'rgba(255,255,255,0.5)', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                            {logs.map((l, i) => (
                              <div key={i} style={{ color: logColor(l) }}>{l}</div>
                            ))}
                            {logs.length === 0 && <div style={{ color: 'var(--faint)' }}>目前無日誌…</div>}
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
    </div>
  )
}
