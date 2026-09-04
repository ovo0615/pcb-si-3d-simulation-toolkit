// PCB SI 3D 模擬分析工具 — 前端主程式
// 裁切流程：載入電路板 → 選擇訊號／參考網路 → 裁切設定 → Port 設定 → 執行裁切
import { useState, useEffect, useMemo, useRef, type CSSProperties, type ChangeEvent } from 'react'
import { Allotment } from 'allotment'
import {
  loadLogSplit, loadMainSplit, saveLogSplit, saveMainSplit,
  loadReportWorkspace, saveReportWorkspace,
} from './splitLayout'
import { logColor } from './logLevel'
import { revealPath } from './revealPath'
import RunHistory from './components/RunHistory'
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
import TdrChart from './components/TdrChart'
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
import ModelLibrary from './components/ModelLibrary'
import { modelsReportMetadata } from './components/reportMetadataStore'
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
  /** 單參考（微帶線）切面的提示。不影響評級，但要讓人看到。
   *  後端刻意讓每一刀的文字相同，所以顯示時去重、只出現一次。 */
  stitch_return_path_risk?: string | null
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
    /** 單參考（微帶線）切面的提示。每一刀文字相同，顯示時去重。 */
    stitch_return_path_risk?: string | null
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

// 已選網路清單的最小高度。
//
// 原本只給 flex: 3 / flex: 2，左側面板一長（多勾幾個任務就會）兩個清單就被
// 壓到只剩一行——選了兩條訊號網路卻只看得到一條，看起來像是沒選到。
// 一列約 24 px，另外留 27 px 給標題與內距。訊號五列、參考兩列——夠看出「選了
// 幾條」，又不會把下面的面板擠掉。清單本身可捲動，超過的看得到。
/** 側向收斂驗證的加寬倍率。1.5 是常用的起點，也是回報訊息裡那個「加寬 50%」。 */
const WIDEN_FACTOR = 1.5

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

/** 前後端之間的介面版號，必須與後端 `main.py` 的 `API_CONTRACT_VERSION` 相同。
 *
 *  前端是靜態檔：`npm run build` 一跑，**還在跑的舊後端就會開始供應新前端**。
 *  新前端呼叫新端點會撞上根路徑的 StaticFiles，而它只收 GET／HEAD，於是 POST
 *  得到 `405 Method Not Allowed`——訊息完全沒有指向真正的原因。更難查的是
 *  另一半：舊後端看不懂新送的欄位會**安靜忽略**，畫面上只表現為「按鈕是灰的」。
 *  2026-08-19 實測兩種都發生了。
 *
 *  加端點或改送出欄位時兩邊一起 +1；`test_api_contract_version.py` 會擋住只改一邊。 */
const API_CONTRACT_VERSION = 6

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

type StorageInfo = {
  locations: { label: string; path: string; exists: boolean; note: string }[]
  board_outputs: string
  network: string
}

export default function App() {
  // ── 檔案與載入狀態 ──
  const [inputPath, setInputPath] = useState('')
  const [outputPath, setOutputPath] = useState('')
  // 資料放在哪裡：由後端回報實際路徑，前端不寫死。
  // 環境變數改得動模型庫與設定檔的位置，寫死的字串會安靜地說謊。
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
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
  // DDR 自動分類的結果與使用者勾選的角色。null = 還沒分類過。
  const [ddrResult, setDdrResult] = useState<any>(null)
  const [ddrRoles, setDdrRoles] = useState<string[]>([])
  const [ddrBusy, setDdrBusy] = useState(false)
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
  // 甲1（2026-08-29 拍板）：預設自動——細間距陣列整板 Pin Group，其餘 Coax。
  const [portType, setPortType] = useState('auto')
  const [checkedComps, setCheckedComps] = useState<Record<string, boolean>>({})
  const [cutoutJobId, setCutoutJobId] = useState('')
  const [cutoutStopping, setCutoutStopping] = useState(false)

  // ── 模擬設定（HFSS 3D Layout／SIwave SYZ）──
  const [sweepType, setSweepType] = useState('Interpolating')
  // 預設抽成常數：「由資料率導出」要判斷掃頻表是不是還維持預設形狀，
  // 是的話把上限一併帶入（50 GHz 對 DDR3L 是白算五倍頻寬）。
  const DEFAULT_SWEEPS = [
    { distribution: 'Linear Count', start: '0Hz', end: '1Hz', value: '2' },
    { distribution: 'Log Scale', start: '1Hz', end: '100MHz', value: '20' },
    { distribution: 'Linear Step', start: '100MHz', end: '50GHz', value: '0.05GHz' }
  ]
  const [sweeps, setSweeps] = useState(DEFAULT_SWEEPS)
  /** 掃頻表是否仍是預設形狀（末段上限可以是我們上次帶入的值）。
   *  使用者親手改過的表**絕不自動更動**——那是他的設定，不是預設。 */
  const sweepsFollowDefault = (rows: typeof DEFAULT_SWEEPS) =>
    rows.length === 3
    && JSON.stringify(rows.slice(0, 2)) === JSON.stringify(DEFAULT_SWEEPS.slice(0, 2))
    && rows[2].distribution === 'Linear Step'
    && rows[2].start === '100MHz'
    && rows[2].value === '0.05GHz'
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
  const [pickerClosing, setPickerClosing] = useState(false)
  const pickerCloseTimer = useRef<number | null>(null)
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
  // TDR 阻抗定位：背景求解 + 劇變位置映射到 Layout
  const [tdrSuggestion, setTdrSuggestion] = useState<any | null>(null)
  const [tdrMode, setTdrMode] = useState<'single' | 'differential'>('single')
  const [tdrInputP, setTdrInputP] = useState('')
  const [tdrInputN, setTdrInputN] = useState('')
  const [tdrOutputP, setTdrOutputP] = useState('')
  const [tdrOutputN, setTdrOutputN] = useState('')
  const [tdrDkHint, setTdrDkHint] = useState('')
  const [tdrNet, setTdrNet] = useState('')          // 被探測的訊號網路（路徑長度與標記映射用）
  const [tdrFlipStart, setTdrFlipStart] = useState(false) // 起點在走線的另一端
  const [tdrPath, setTdrPath] = useState<any | null>(null) // /api/tdr/path 結果
  const [tdrJob, setTdrJob] = useState<any | null>(null)
  const [tdrAnalysisIdx, setTdrAnalysisIdx] = useState(0)  // A 法／B 法切換
  const [tdrMarkers, setTdrMarkers] = useState<TdrMarkerSpan[] | null>(null)
  const [tdrMapError, setTdrMapError] = useState('')
  // 量測波形匯入（乙路）：示波器 CSV → 錨點指認 → 同一套劇變定位
  const [tmCsvPath, setTmCsvPath] = useState('')
  const [tmPreview, setTmPreview] = useState<any | null>(null)
  const [tmT0, setTmT0] = useState('')       // 板端入口（ns）
  const [tmTEnd, setTmTEnd] = useState('')   // 線尾反射（ns）
  const [tmRise, setTmRise] = useState('')   // 歐姆／rho 波形的儀器上升時間（ps）
  const [tmBusy, setTmBusy] = useState(false)
  const [tmError, setTmError] = useState('')

  // 截面阻抗（Q2D）：在 Layout 上框工作範圍、拉一條切線，從 EDB 還原截面。
  // 工作範圍同時是二維模型的側向截斷邊界，不只是畫面上的框（ADR-0051）。
  const [xsMode, setXsMode] = useState<CrossSectionMode>('none')
  const [xsRegion, setXsRegion] = useState<CrossSectionRegion | null>(null)
  const [xsCut, setXsCut] = useState<CrossSectionCut | null>(null)
  const [xsScan, setXsScan] = useState<CrossSectionScan | null>(null)
  const [xsBusy, setXsBusy] = useState(false)
  const [xsError, setXsError] = useState('')
  const [xsResolutionUm, setXsResolutionUm] = useState('2')
  const [xsHeightUm, setXsHeightUm] = useState('')   // 導體到參考面，判側向截斷用
  const [xsRoleOverrides, setXsRoleOverrides] = useState<Record<string, string>>({})
  const [xsSavedCuts, setXsSavedCuts] = useState<any[]>([])
  const [xsCutsSource, setXsCutsSource] = useState('')
  const [xsSolveMode, setXsSolveMode] = useState('standard')
  const [xsFrequency, setXsFrequency] = useState('8GHz')
  const [xsWidenCheck, setXsWidenCheck] = useState(false)
  const [xsJob, setXsJob] = useState<any | null>(null)
  const [xsResultIdx, setXsResultIdx] = useState(0)
  // TDR 捷徑（第 4 期）：把劇變的距離或沿線取樣直接換成切線
  const [xsFromTdrBusy, setXsFromTdrBusy] = useState(false)
  const [xsSampleSpacingMm, setXsSampleSpacingMm] = useState('10')
  const [xsHalfWidthUm, setXsHalfWidthUm] = useState('7000')
  const [xsCompare, setXsCompare] = useState<ComparisonResult | null>(null)
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

  // 切面的接地縫合檢查需要知道要解到幾 GHz——縫合間距的可信上限與頻率相關。
  // 取目前掃頻設定的最高頻；讀不到就送 null，後端會退回不看頻率的舊規則。
  const targetFmaxGHz = useMemo(() => {
    if (!sweeps.length) return null
    const end = parseFreqToGHz(sweeps[sweeps.length - 1].end)
    return Number.isFinite(end) && end > 0 ? end : null
  }, [sweeps])

  /** 這次**真正要用到**的頻寬（GHz）。空字串＝跟著掃頻上限走。
   *
   *  為什麼不能直接用掃頻上限：掃頻常常開得比需要的寬（留給 TDR、留餘裕），
   *  而求解器要不要用 HFSS 取決於「你要用到幾 GHz」。DDR3L-1866 的邊緣拐點
   *  約 2～3.5 GHz，掃到 10 GHz 只是保險，不代表 10 GHz 的精度要成立。 */
  /** 後端介面版號與前端對不上（＝後端沒重啟）。 */
  const [staleBackend, setStaleBackend] = useState<number | null>(null)
  const [usableBandwidthGHz, setUsableBandwidthGHz] = useState<string>('')
  /** 資料率（Gbps）。填了就由工具導出可用頻寬，使用者不必自己算拐點。
   *  DDR 的人知道自己跑幾 Gbps，不見得知道邊緣拐點在哪。 */
  const [dataRateGbps, setDataRateGbps] = useState<string>('')
  const [bandwidthBasis, setBandwidthBasis] = useState<string>('')
  const effectiveFmaxGHz = usableBandwidthGHz
    ? (Number(usableBandwidthGHz) > 0 ? Number(usableBandwidthGHz) : null)
    : targetFmaxGHz

  // ── 預覽場景 ──
  const [fullScene, setFullScene] = useState<PreviewData | null>(null)
  const [cutScene, setCutScene] = useState<PreviewData | null>(null)
  const [activeView, setActiveView] = useState<ViewMode>('full')
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
      alert(`已切換為 AEDT ${d.current}。

`
        + '請從「匯入原始板檔」重新開始——先前用其他版本產生的 .aedb 未必打得開。')
    } catch (e) {
      alert('切換版本失敗：' + String(e))
      void refreshAedtVersion()
    }
  }

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

  /** 「建立 Port 並套用求解器設定」還缺什麼。
   *
   *  這顆按鈕有四個前提，全部滿足才亮。灰掉卻不說原因的話，使用者只能一格
   *  一格試——實際回報過：板子載入了、Port 類型也選了、元件也勾了，就是按
   *  不下去，因為**還沒執行裁切**，而那件事發生在畫面另一區。 */
  const portsSetupBlockers = [
    !cutScene && !directSegmentMode ? '請先執行裁切' : '',
    signalNets.length === 0 ? '請選訊號網路' : '',
    refNets.length === 0 ? '請選參考網路' : '',
    Object.keys(checkedComps).filter(c => checkedComps[c]).length === 0
      ? '請勾選要建立 Port 的元件' : '',
  ].filter(Boolean)

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
  /** 把後端的錯誤攤成一句人看得懂的話。
   *
   *  FastAPI 的驗證錯誤（422）`detail` 是一個**陣列**，每項長得像
   *  `{loc: ["body","metadata_path"], msg: "Field required"}`。
   *  直接丟進 `new Error()` 會得到 **`[object Object]`**——2026-08-19 實測
   *  就是這樣：真正的原因是「少送了 metadata_path」，而畫面上完全看不出來。
   */
  const describeApiError = (data: any, res: Response): string => {
    const detail = data?.detail
    if (typeof detail === 'string' && detail) return detail
    if (Array.isArray(detail)) {
      const parts = detail.map((item: any) => {
        const where = Array.isArray(item?.loc)
          ? item.loc.filter((x: any) => x !== 'body').join('.')
          : ''
        const message = item?.msg || JSON.stringify(item)
        return where ? `${where}：${message}` : String(message)
      })
      return `HTTP ${res.status}　${parts.join('；')}`
    }
    if (detail) return JSON.stringify(detail)
    return res.statusText || `HTTP ${res.status}`
  }

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
    if (!res.ok) throw new Error(describeApiError(data, res))
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

  /** 挑一個 CSV 填進指定欄位。示波器匯出的檔名又長又帶時間戳，
   *  手打路徑打錯一個字元得到的是「找不到檔案」，看不出是路徑的問題。 */
  const browseCsvInto = async (setter: (path: string) => void, title: string) => {
    try {
      const data = await api(`/api/browse_csv?title=${encodeURIComponent(title)}`)
      if (data.path) setter(data.path)
    } catch (e) { console.error(e) }
  }

  const revealInExplorer = async (path: string) => {
    const failure = await revealPath(path)
    if (failure) setLogs(prev => [...prev, failure])
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
  // 開場先確認後端不是舊的。這個檢查放在最前面，因為版本對不上時後面每一個
  // 症狀都會指向錯的方向（405、按鈕灰掉、欄位被安靜忽略）。
  useEffect(() => {
    void (async () => {
      try {
        const status = await api('/api/status')
        const version = Number(status?.api_contract_version ?? 0)
        setStaleBackend(version === API_CONTRACT_VERSION ? null : version)
      } catch { /* 連不上就讓其他地方去報，不在這裡疊一層 */ }
    })()
  }, [])

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
      // 載入之後版本就鎖住了，把選單狀態同步過來，免得它看起來還能改。
      setAedtLocked(true)
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
          // 後端這條路收的是 required_bandwidth_ghz。原本送 target_fmax_ghz，
          // 名字對不上被 pydantic 靜默丟掉，依複雜度分段因此永遠純看幾何。
          required_bandwidth_ghz: effectiveFmaxGHz,
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
    if (!canSegment) { alert('請先執行「局部裁切」，或在入口不勾「局部裁切」直接載入已裁切的通道'); return }
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
        target_fmax_ghz: targetFmaxGHz,
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
      // 帶著這次串接的產出當預設檔名與目錄開啟——檔名裡的埠數與日期
      // 正是之後辨識這個檔的依據，每次要人自己想一個並不合理。
      const suggested = cascadeResult?.output_path || ''
      const selected = await api(
        '/api/browse_touchstone_output'
        + (suggested ? `?suggested=${encodeURIComponent(suggested)}` : ''))
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
      `Port：${mapping}\n` +
      `\n確認後才會建立並求解 Circuit。`,
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
  const [layoutOnlySelectedNets, setLayoutOnlySelectedNets] = useState(false)
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
    setTdrJob(null)
    setTdrMarkers(null)
    setTdrMapError('')
    setTdrAnalysisIdx(0)
    if (!touchstonePath || !show.tdr) return
    let cancelled = false
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
      .catch(() => { if (!cancelled) setTdrSuggestion(null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cascadeResult, show.tdr])

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
        setTdrJob((previous: any) =>
          JSON.stringify(previous) === JSON.stringify(state) ? previous : state)
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
          : analysis.method === 'end_anchor' ? '錨' : 'B'
        setTdrMarkers(result.markers.map((m: any, i: number): TdrMarkerSpan => ({
          points: m.points,
          distance_mm: m.distance_mm,
          excluded: m.excluded,
          label: `${methodTag}${i + 1}　${m.distance_mm.toFixed(1)}mm`
            + (m.excluded ? '（切面接縫）' : ''),
        })))
      })
      .catch(e => { if (!cancelled) setTdrMapError(String(e)) })
    return () => { cancelled = true }
    // 相依含 result 本體：量測波形匯入直接塞一個 status 已是 done 的
    // 結果進來，只看 status 的話標記不會重算。輪詢端在內容相同時沿用
    // 舊物件，所以不會因此白跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tdrJob?.status, tdrJob?.result, tdrAnalysisIdx, tdrPath, tdrScene, tdrNet])

  const handleTdrRun = async () => {
    if (!cascadeResult?.output_path || !tdrSuggestion?.supported) {
      alert(tdrSuggestion?.note || '請先完成電路串接（2-Port 或 4-Port）。')
      return
    }
    const selected = tdrMode === 'differential'
      ? [tdrInputP, tdrInputN, tdrOutputP, tdrOutputN]
      : [tdrInputP, tdrOutputP]
    if (selected.some(name => !name) || new Set(selected).size !== selected.length) {
      alert('TDR 的輸入／輸出 Port 必須完整且不可重複。')
      return
    }
    const dk = tdrDkHint.trim() ? Number(tdrDkHint) : null
    if (dk !== null && (!Number.isFinite(dk) || dk <= 0)) {
      alert('介電常數必須是正數。')
      return
    }
    const lengthMm = tdrPath?.length_mm || null
    if (!lengthMm && dk === null) {
      alert('無法決定傳播速度：請先載入電路板——工具會自動由走線取得'
        + '通道長度（A 法），並由疊構取得介電常數（B 法）。')
      return
    }
    const mapping = tdrMode === 'differential'
      ? `${tdrInputP}／${tdrInputN} → ${tdrOutputP}／${tdrOutputN}`
      : `${tdrInputP} → ${tdrOutputP}`
    const ok = window.confirm(
      `請確認 TDR 設定：\n` +
      `模式：${tdrMode === 'differential' ? '差動' : '單端'}\n` +
      `探棒：${mapping}\n` +
      `上升時間：${Number(tdrSuggestion.rise_time_ps).toFixed(2)} ps（由頻寬自動決定）\n` +
      (lengthMm ? `通道長度：${Number(lengthMm).toFixed(2)} mm（A 法：群延遲）\n` : '') +
      (dk !== null ? `介電常數：${dk}（B 法：疊構 Dk）\n` : '') +
      `確定要開始背景求解嗎？`)
    if (!ok) return
    try {
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
      setTdrJob(snapshot)
      setTdrMarkers(null)
      setActiveView('tdr')
    } catch (e) {
      alert('TDR 啟動失敗：' + String(e))
    }
  }

  // ── 量測波形匯入（乙路）─────────────────────────────────
  const handleTmLoad = async () => {
    setTmError('')
    setTmPreview(null)
    setTmBusy(true)
    try {
      const preview = await api('/api/tdr/measured/load',
        { csv_path: tmCsvPath.trim() })
      setTmPreview(preview)
    } catch (e) {
      setTmError(String(e))
    } finally {
      setTmBusy(false)
    }
  }

  const handleTmAnalyze = async () => {
    const t0 = Number(tmT0)
    if (!Number.isFinite(t0)) { setTmError('t0 必須是數字（ns）。'); return }
    const tEnd = tmTEnd.trim() ? Number(tmTEnd) : null
    if (tEnd !== null && (!Number.isFinite(tEnd) || tEnd <= t0)) {
      setTmError('線尾反射時刻必須晚於 t0。'); return
    }
    setTmError('')
    setTmBusy(true)
    try {
      const result = await api('/api/tdr/measured/analyze', {
        csv_path: tmCsvPath.trim(),
        t0_ns: t0,
        t_end_ns: tEnd,
        path_length_mm: tdrPath?.length_mm || null,
        dk_hint: tdrDkHint.trim() ? Number(tdrDkHint) : null,
        rise_time_ps: tmRise.trim() ? Number(tmRise) : null,
      })
      // 塞進與模擬路同一個結果槽：曲線、劇變表、Layout 標記與
      // 「取此處截面」全部重用。輪詢只在 running 時覆寫，不會蓋掉它。
      setTdrAnalysisIdx(0)
      setTdrMarkers(null)
      setTdrMapError('')
      setTdrJob({
        running: false, status: 'done', phase: '量測波形',
        message: '量測波形分析完成。', result,
      })
      setActiveView('tdr')
    } catch (e) {
      setTmError(String(e))
    } finally {
      setTmBusy(false)
    }
  }

  // ── 截面阻抗（Q2D）───────────────────────────────────────
  //
  // 掃描不呼叫 AEDT：花掉一份 Q2D 授權才發現截面不能用，是最貴的學法。

  // 換板子就把上一片的標註清掉，再讀回這一片自己的（ADR-0053）。留著舊的
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
    if (!show.crosssection || !inputPath || !fullScene) return
    let cancelled = false
    api('/api/cross-section/cuts')
      .then(data => {
        if (cancelled) return
        setXsSavedCuts(data.cuts || [])
        setXsCutsSource(data.source || '')
      })
      .catch(() => { /* 讀不到就是還沒標註過，不是錯誤 */ })
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
    if (!xsRegion || !xsCut) {
      setXsError('請先在 Layout 上框出工作範圍，再點一條切線。')
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
        name: `XS_${xsCut.axis.toUpperCase()}_${xsCut.coordinateMm.toFixed(3)}`,
        reference_nets: refNets,
        excluded_nets: [],
        role_overrides: overrides,
        resolution_um: Number(xsResolutionUm) || 2,
        conductor_to_reference_um: Number.isFinite(height) ? height : 0,
      })
      setXsScan(scan)
    } catch (e) {
      setXsScan(null)
      setXsError(String(e))
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
    const entry = {
      name: xsScan?.cut?.name
        || `XS_${xsCut.axis.toUpperCase()}_${xsCut.coordinateMm.toFixed(3)}`,
      axis: xsCut.axis,
      coordinate_mm: xsCut.coordinateMm,
      region: {
        x0_mm: xsRegion.x0Mm, y0_mm: xsRegion.y0Mm,
        x1_mm: xsRegion.x1Mm, y1_mm: xsRegion.y1Mm,
      },
      resolution_um: Number(xsResolutionUm) || 2,
      role_overrides: xsRoleOverrides,
    }
    // 同名就覆蓋——同一條切線重標一次是修正，不是新增一條。
    const cuts = [...xsSavedCuts.filter(c => c.name !== entry.name), entry]
    try {
      const result = await api('/api/cross-section/cuts', { cuts })
      setXsSavedCuts(cuts)
      setXsCutsSource(result.path || '')
    } catch (e) {
      setXsError('切線存檔失敗：' + String(e))
    }
  }

  // 背景求解狀態輪詢（仿眼圖與 TDR）。開頁時也問一次：工作是後端在跑的，
  // 重新整理之後前端沒有這一下就接不上，進度會整個消失。
  useEffect(() => {
    if (!show.crosssection) return
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
    // 沒有工作在跑就不要一直問。開頁那一次（上面的 `poll()`）已經接上後端
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
    if (!show.crosssection || !show.tdr) { setXsCompare(null); return }
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
      .then(data => { if (!cancelled) setXsCompare(data) })
      .catch(() => { /* 對不起來就不顯示，不用打擾使用者 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xsJob?.result, tdrJob?.result, tdrAnalysisIdx, tdrPath, tdrNet,
      show.crosssection, show.tdr])

  /** 截面阻抗快照要帶進報告的數字。圖上的字縮小後未必讀得出來。 */
  const crossSectionReportMetadata = (): Record<string, any> => {
    const meta: Record<string, any> = {}
    const cuts = (xsJob?.result?.cuts || []) as any[]
    const solved = cuts.filter(c => c.solved)
    if (solved.length) {
      meta['已求解切線'] = solved.length
      meta['求解精度'] = solved[0].solve_mode || ''
      const impedances: string[] = []
      for (const cut of solved) {
        for (const [name, value] of Object.entries(cut.single_ended || {})) {
          impedances.push(`${cut.name} ${name} ${Number(value).toFixed(3)} Ω`)
        }
      }
      if (impedances.length) meta['單端阻抗'] = impedances.join('；')
      const converged = solved.filter(c => c.convergence)
      if (converged.length) {
        meta['側向收斂'] = converged
          .map(c => `${c.name}：加寬 ${(c.convergence.factor - 1) * 100}% 後最大變化 `
            + `${(c.convergence.worst_relative * 100).toFixed(2)}%`
            + `（${c.convergence.converged ? '已收斂' : '未收斂'}）`)
          .join('；')
      }
      const pairs = solved.flatMap(c => (c.pairs || [])
        .filter((p: any) => p.Zdiff != null)
        .map((p: any) => `${c.name} ${p.positive}／${p.negative} `
          + `Zdiff ${p.Zdiff.toFixed(3)} Ω（${p.exact ? '精確' : '近似'}）`))
      if (pairs.length) meta['差分阻抗'] = pairs.join('；')
    }
    if (xsScan) {
      meta['目前切線'] = `${xsScan.cut.name || ''} `
        + `${xsScan.cut.axis.toUpperCase()} = ${xsScan.cut.coordinate_mm.toFixed(3)} mm`
      meta['取樣間距'] = `${xsScan.resolution_um.toFixed(1)} µm`
      meta['導體數'] = xsScan.plan.conductor_count
    }
    if (xsCompare?.summary?.comparable) {
      const s = xsCompare.summary
      meta['與 TDR 對照'] = `${s.comparable} 條可比，`
        + `中位差 ${(s.median_delta_ohm ?? 0).toFixed(4)} Ω，`
        + `最大 ${((s.worst_relative ?? 0) * 100).toFixed(2)}%（${s.worst}）`
      meta['TDR 空間解析度'] = `${s.resolution_mm.toFixed(3)} mm`
    }
    return meta
  }

  const xsCutSpec = () => {
    if (!xsRegion || !xsCut) return null
    return {
      name: xsScan?.cut?.name
        || `XS_${xsCut.axis.toUpperCase()}_${xsCut.coordinateMm.toFixed(3)}`,
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
    const label = { fast: '快速', standard: '標準', accurate: '高精度' }[xsSolveMode]
      || xsSolveMode
    if (!window.confirm(
      `即將求解 ${cuts.length} 條切線：\n`
      + cuts.map(c => `　${c.name}（${c.axis.toUpperCase()} = ${c.coordinate_mm.toFixed(3)} mm）`).join('\n')
      + `\n\n精度：${label}　自適應頻率：${xsFrequency}\n`
      + '會開啟 AEDT 並佔用一份 Q2D 授權，一條切線約數分鐘。要繼續嗎？')) return
    try {
      const snapshot = await api('/api/cross-section/solve', {
        cuts,
        reference_nets: refNets,
        frequency: xsFrequency,
        solve_mode: xsSolveMode,
        widen_factor: xsWidenCheck ? WIDEN_FACTOR : 0,
      })
      setXsJob(snapshot)
      setXsResultIdx(0)
      setActiveView('crosssection')
    } catch (e) {
      setXsError('求解啟動失敗：' + String(e))
    }
  }

  const handleXsStop = async () => {
    try {
      setXsJob(await api('/api/cross-section/stop', {}))
    } catch (e) {
      setXsError('終止失敗：' + String(e))
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
    if (!base) { alert('需要先載入電路板並完成 TDR 路徑計算。'); return }
    setXsFromTdrBusy(true)
    try {
      const data = await api('/api/cross-section/from-tdr', {
        ...base, distances_mm: [distanceMm], names: [label],
      })
      const row = data.rows?.[0]
      if (!row?.accepted) {
        alert(`這個位置不能用二維截面看：\n\n${row?.reason || '未知原因'}`)
        return
      }
      handleXsLoadCut(row.cut)
      setActiveView('crosssection')
      if (row.severity === 'risk') {
        setXsError(`切線已定位，但 ${row.reason}`)
      } else {
        setXsError('')
      }
    } catch (e) {
      alert('產生切線失敗：' + String(e))
    } finally {
      setXsFromTdrBusy(false)
    }
  }

  /** 「沿線取樣 N 條」：一次鋪一排，角度過不了的跳過並回報。 */
  const handleSampleAlongTrace = async () => {
    const base = tdrShortcutPayload()
    if (!base) { alert('需要先載入電路板並完成 TDR 路徑計算。'); return }
    const spacing = Number(xsSampleSpacingMm)
    if (!(spacing > 0)) { alert('取樣間距要大於 0。'); return }
    setXsFromTdrBusy(true)
    try {
      const data = await api('/api/cross-section/from-tdr', {
        ...base, spacing_mm: spacing,
      })
      const cuts = data.cuts || []
      const skipped = data.skipped || []
      if (cuts.length === 0) {
        alert('沿線沒有任何位置適合取截面。' +
          (skipped.length ? `\n\n${skipped.length} 個取樣點因為角度過不了被跳過。` : ''))
        return
      }
      // 存進切線集，之後「解全部已存」就能整批送出。
      const merged = [...xsSavedCuts.filter(
        (c: any) => !cuts.some((n: any) => n.name === c.name)), ...cuts]
      const written = await api('/api/cross-section/cuts', { cuts: merged })
      setXsSavedCuts(merged)
      setXsCutsSource(written.path || '')
      handleXsLoadCut(cuts[0])
      setActiveView('crosssection')
      // 跳過幾條一定要講出來——靜靜略過會讓人以為那一段沒問題，
      // 而那一段正好是最可能有問題的地方。
      const parts = [`沿線取了 ${cuts.length} 條切線（實際間距 ${data.actual_spacing_mm.toFixed(2)} mm）。`]
      if (data.note) parts.push(data.note)
      if (skipped.length) {
        parts.push(`${skipped.length} 個取樣點因為與走線的夾角過大被跳過：`
          + skipped.map((s: any) => `${s.distance_mm.toFixed(1)} mm（${s.angle_deg?.toFixed(0) ?? '?'}°）`).join('、')
          + '。那些位置是轉角，二維截面刻畫不了，該用 HFSS 看。')
      }
      setXsError(parts.join('\n'))
    } catch (e) {
      alert('沿線取樣失敗：' + String(e))
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
    setXsScan(null)
    setXsMode('none')
  }

  // 任何長時間工作執行中都每秒觸發重繪，讓「已耗時」平滑跳動（不打 API）。
  //
  // 原本只看分段排程，於是眼圖、TDR 與截面求解的「已耗時」永遠顯示 0 秒——
  // nowTick 停在開頁那一刻，減去比它晚的 started_at 得到負數，再被
  // Math.max(0, …) 夾成 0。看起來像計時器壞了，實際上是它根本沒在跳。
  const anyJobRunning = Boolean(
    schedStatus?.running || eyeJob?.running || tdrJob?.running || xsJob?.running)
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
      // 依複雜度分段更需要這張表：每段的求解器本來就不一樣，不讓人看到就
      // 只能相信它。2026-08-18 之前這裡少了下面兩行，等分分段有表、依複雜度
      // 沒有——而後者才是混合求解真正的入口。
      setSegmentSolverPlans((data.segments || []).map((segment: any) => ({
        index: segment.index,
        path: segment.path,
        ...(segment.solver_plan || {}),
      })))
      setShowSolverRegionOverlay(true)
    } catch (e) {
      alert('依複雜度分段執行失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  /** 由資料率導出可用頻寬，填進欄位並顯示憑什麼填這個數字。 */
  const deriveBandwidth = async () => {
    // DDR 的人講的是「1866」（MT/s），不是「1.866」（Gbps）。兩種都收——
    // 沒有任何 DDR 會跑在 100 Gbps，所以這個門檻不會誤判。
    const typed = Number(dataRateGbps)
    const rate = typed >= 100 ? typed / 1000 : typed
    if (!rate || rate <= 0) { alert('請先填資料率（1866 或 1.866 都可以）'); return }
    try {
      const data = await api('/api/bandwidth/derive', { data_rate_gbps: rate })
      setUsableBandwidthGHz(String(data.usable_bandwidth_ghz))
      // 掃頻上限一併處理（HANDOFF 第 8 條）：固定 50 GHz 對 DDR3L-1866
      // 是白算五倍頻寬。表還是預設形狀就帶入導出的上限並講明；
      // 使用者改過的表不動，只附建議。
      const cap = Number(data.sweep_max_ghz)
      let note = ''
      if (cap > 0) {
        const end = `${Math.round(cap * 100) / 100}GHz`
        if (sweepsFollowDefault(sweeps)) {
          setSweeps(prev => [...prev.slice(0, 2), { ...prev[2], end }])
          note = `　掃頻表末段上限已一併帶入 ${end}（取代固定 50 GHz 的預設）。`
        } else if (sweeps.some(row => row.end !== end)) {
          note = `　掃頻表已被你改過，未自動更動；要對齊的話上限建議 ${end}。`
        }
      }
      setBandwidthBasis((data.basis || '') + note)
    } catch (e) {
      alert('導出頻寬失敗: ' + String(e))
    }
  }

  /** 依目前的頻寬重算每段的求解器建議。
   *
   *  分段當下使用者常常還不知道自己要用到幾 GHz——那要等他選好 IBIS 模型
   *  才定得下來，而選模型在分段之後。原本頻寬只在按下分段按鈕那一刻被讀到，
   *  事後再填等於白填：畫面上什麼都不會變。 */
  const reassessSolverBandwidth = async (metadataPath?: string) => {
    const path = normalizeUserPath(metadataPath || schedMetaPath)
    if (!path) { alert('請先執行分段，或輸入 segments.json 路徑'); return }
    try {
      const data = await api('/api/schedule/bandwidth', {
        metadata_path: path,
        required_bandwidth_ghz: effectiveFmaxGHz,
      })
      setSegmentSolverPlans((data.segments || []).map((segment: any) => ({
        index: segment.index, path: segment.path, ...segment,
      })))
      return data
    } catch (e) {
      alert('重新評估求解器失敗: ' + String(e))
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
        target_fmax_ghz: effectiveFmaxGHz,
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
      // 等分分段那條路沒有把頻寬送下去，跑完立刻依目前的頻寬重算一次，
      // 否則畫面上的建議與使用者已經填好的頻寬是脫節的。
      if (effectiveFmaxGHz) await reassessSolverBandwidth(data.metadata_path)
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

  // ── 設定檔（HANDOFF 乙6）──────────────────────────────────────────
  const [profileNames, setProfileNames] = useState<string[]>([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  /** 存進設定檔的欄位。語意欄位對（getter, setter）——套用是**合併**：
   *  舊設定檔缺的欄位保持現值，訊息講套用了哪些，不做無聲的重設。 */
  const profileFields: Record<string, [() => any, (v: any) => void]> = {
    sweepType: [() => sweepType, setSweepType],
    sweeps: [() => sweeps, setSweeps],
    solutionFreq: [() => solutionFreq, setSolutionFreq],
    errorTolerance: [() => errorTolerance, setErrorTolerance],
    maxPasses: [() => maxPasses, setMaxPasses],
    maxDeltaS: [() => maxDeltaS, setMaxDeltaS],
    maxRefinementPerPass: [() => maxRefinementPerPass, setMaxRefinementPerPass],
    minConvergedPasses: [() => minConvergedPasses, setMinConvergedPasses],
    hfssMeshMethod: [() => hfssMeshMethod, setHfssMeshMethod],
    expansionMm: [() => expansionMm, setExpansionMm],
    extentType: [() => extentType, setExtentType],
    portType: [() => portType, setPortType],
    dataRateGbps: [() => dataRateGbps, setDataRateGbps],
    usableBandwidthGHz: [() => usableBandwidthGHz, setUsableBandwidthGHz],
  }
  const refreshProfiles = async () => {
    try {
      const data = await api('/api/settings-profiles')
      setProfileNames((data.profiles || []).map((p: any) => p.name))
    } catch { /* 清單失敗不打斷畫面 */ }
  }
  useEffect(() => { void refreshProfiles() }, [])
  const saveProfile = async () => {
    const name = window.prompt('設定檔名稱（例如「DDR3L-1866 標準條件」）：')
    if (!name) return
    const settings: Record<string, any> = {}
    for (const [key, [get]] of Object.entries(profileFields)) settings[key] = get()
    try {
      await api('/api/settings-profiles/save', { name, settings })
      await refreshProfiles()
      setSelectedProfile(name)
      setProfileMsg(`已儲存「${name}」（${Object.keys(settings).length} 個欄位）。`)
    } catch (e) { alert('儲存失敗: ' + String(e)) }
  }
  const applyProfile = async (name: string) => {
    try {
      const data = await api('/api/settings-profiles/get', { name })
      const settings = data.settings || {}
      const applied: string[] = []
      for (const [key, value] of Object.entries(settings)) {
        const field = profileFields[key]
        if (field && value !== undefined) { field[1](value); applied.push(key) }
      }
      const skipped = Object.keys(profileFields).filter(k => !(k in settings))
      setProfileMsg(`已套用「${name}」的 ${applied.length} 個欄位`
        + (skipped.length ? `；${skipped.length} 個欄位設定檔裡沒有，保持現值。` : '。'))
    } catch (e) { alert('套用失敗: ' + String(e)) }
  }
  const deleteProfile = async (name: string) => {
    if (!window.confirm(`刪除設定檔「${name}」？`)) return
    try {
      await api('/api/settings-profiles/delete', { name })
      setSelectedProfile('')
      await refreshProfiles()
      setProfileMsg(`已刪除「${name}」。`)
    } catch (e) { alert('刪除失敗: ' + String(e)) }
  }

  /** 依平面銅面積建議參考網路（HANDOFF 第 9 條）。
   *  名稱猜得到 GND，猜不到 1V35 這種電源參考；面積是看得到的證據。 */
  const [refSuggestions, setRefSuggestions] = useState<
    { net: string; area_cm2: number; polygons: number }[] | null>(null)
  const suggestRefsByCopper = async () => {
    try {
      const data = await api('/api/nets/reference-suggestions', {})
      setRefSuggestions(data.suggestions || [])
    } catch (e) {
      alert('建議失敗: ' + String(e))
    }
  }

  // DDR 自動分類。純字串處理，後端不開 AEDT、不讀 EDB，所以按下去就回來。
  const handleClassifyNets = async () => {
    if (allNets.length === 0) { alert('請先載入電路板'); return }
    setDdrBusy(true)
    try {
      const res = await fetch('/api/nets/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nets: allNets }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || '分類失敗')
      setDdrResult(data)
      // 預設只勾資料、選通與遮罩：那是一個位元組通道實際要一起分析的東西。
      // 時脈與位址不預設勾選——它們是命令匯流排，跟資料的分析方式不同。
      setDdrRoles(['DQ', 'DQS_P', 'DQS_N', 'DM'])
    } catch (err: any) {
      alert('DDR 自動分類失敗：' + (err?.message || err))
    } finally {
      setDdrBusy(false)
    }
  }

  // 只加進訊號網路，不動參考網路。參考網路要選哪些是另一個判斷，
  // 自動替使用者決定 GND／電源會讓人以為工具確認過回流路徑。
  const applyDdrRoles = () => {
    if (!ddrResult) return
    const picked = (ddrResult.rows || [])
      .filter((r: any) => ddrRoles.includes(r.role))
      .map((r: any) => r.net)
    if (picked.length === 0) { alert('目前勾選的角色沒有對應的網路'); return }
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
    ]
    if (picked.length === 0) return
    setSignalNets(picked)
    setRefNets(prev => prev.filter(n => !picked.includes(n)))
  }

  const handleExportSignalNets = () => {
    if (signalNets.length === 0) { alert('目前沒有已選取的訊號網路'); return }
    const header = [
      '# PCB SI 3D 模擬分析工具－訊號網路清單',
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
      { label: 'IBIS 模型與眼圖分析', action: () => setActiveView('models'), disabled: !show.models },
      { label: '一鍵 HTML 報告中心', action: () => setActiveView('report') },
    ],
    '說明': [
      { label: '關於本工具', action: () => alert('PCB SI 3D 模擬分析工具\n\n電路板裁切與 Port 自動建立\n疊構更換、背鑽與 Layout 清理\nN 段分割與 HFSS／SIwave 混合求解\n遠端求解包（求解機不需安裝 Python）\nS 參數串接與眼圖') },
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
    schematic: '串接電路示意圖 · 黃點 = 短路節點 · 虛線框 = 尚未解算',
    sparam: '串接後 S 參數 · 單端／差動可切換',
    eye: 'QuickEye 眼圖 · 眼高與眼寬由 AEDT 量測',
    models: 'IBIS 模型與眼圖分析',
    tdr: 'TDR 阻抗定位 · 劇變位置標在 Layout 上',
    crosssection: '截面阻抗 · 先框工作範圍，再點一條切線 · 框寬同時是二維模型的側向邊界',
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
    (inputPath || cascadeResult?.output_path || '').split(/[\\/]/).pop()
    || 'PCB SI 分析專案'
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
  useReportStaleRevision(reportWorkspace, ['board'], fullScene, '完整板資料已重新載入')
  useReportStaleRevision(reportWorkspace, ['cutout'], cutScene, '裁切結果已更新')
  useReportStaleRevision(reportWorkspace, ['cleanup'], cleanupAfterScene, 'Layout 清理結果已更新')
  useReportStaleRevision(reportWorkspace, ['segments'], segRun, 'N 段分割結果已更新')
  useReportStaleRevision(reportWorkspace, ['schematic', 'sparam'], cascadeResult, '電路串接結果已更新')
  useReportStaleRevision(reportWorkspace, ['eye'], eyeJob?.result, '眼圖結果已更新')
  useReportStaleRevision(reportWorkspace, ['tdr'], tdrJob?.result, 'TDR 結果已更新')
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
  if (!show.schedule && schedStatus?.running) hiddenRunning.push('排程求解')
  if (!show.eye && eyeJob?.running) hiddenRunning.push('眼圖')
  if (!show.tdr && tdrJob?.running) hiddenRunning.push('TDR')

  return (
    <div className="app-shell" onClick={() => setOpenMenu(null)}>
      {pickerOpen && (
        <TaskPicker
          flags={show}
          onToggle={toggleTask}
          onSetAll={keys => setEnabledTasks([...keys])}
          onStart={closePicker}
          returning={pickerReturning}
          closing={pickerClosing}
          onClosed={finishClosingPicker}
        />
      )}
      {hiddenRunning.length > 0 && (
        <div
          className="app-banner"
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
        <div className="app-overlay" style={{
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
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="app-title">PCB SI 3D 模擬分析工具</h1>
          <p className="app-sub">
            通道裁切、分段與眼圖分析。
          </p>
        </div>
        <img
          src="/logo.png"
          alt="虎門科技"
          style={{ height: '64px', objectFit: 'contain', marginLeft: '24px', display: 'block' }}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
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
          <strong>後端還在跑舊程式，請重新啟動工具。</strong>
          <div>
            介面需要版號 {API_CONTRACT_VERSION}，後端回報
            {staleBackend ? ` ${staleBackend}` : '（沒有版號，更舊）'}。
          </div>
          <div>新功能會回「Method Not Allowed」，或是按鈕一直灰著。</div>
          <div>關掉視窗，用 <code>start.bat</code> 重新啟動即可。</div>
        </div>
      )}

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
                  {/* 只有一個可用版本時不顯示選單——一個選項的下拉是純噪音。
                      AEDT 出新版並納入支援後會自動出現。 */}
                  {aedtVersions.length > 1 && (
                    <>
                      <div className="field-row" style={{ marginTop: 6 }}>
                        <span className="field-label" style={{ margin: 0, minWidth: 78 }}>
                          AEDT 版本
                        </span>
                        <select aria-label="AEDT 版本" className="input" value={aedtVersion}
                          disabled={aedtLocked}
                          onChange={e => void handleSetAedtVersion(e.target.value)}>
                          {aedtVersions.map(v => (
                            <option key={v.version} value={v.version} disabled={!v.installed}>
                              {v.version.replace('.', ' R')}
                              {v.installed ? '' : '（未安裝）'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>
                        {aedtLocked
                          ? '已載入電路板，要換版本請先「重新載入原始檔」。'
                          : '整條流程都用這個版本。'}
                      </div>
                    </>
                  )}
                  {aedtVersions.length === 1 && !aedtVersions[0].installed && (
                    <div className="status status--warn" style={{ marginTop: 6, fontSize: 11.5 }}>
                      找不到 AEDT {aedtVersion} 的安裝。本工具只支援這一版——
                      pyedb 對更舊的版本會改用未經驗證的 .NET 後端。
                    </div>
                  )}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label="輸入檔案路徑"
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
                    <summary className="panel-hint" style={{ cursor: 'pointer' }}>
                      我的板子檔會去哪裡？
                    </summary>
                    <div className="panel-caveat" style={{ marginTop: 6 }}
                      title="後端沒有 requests／httpx／urllib 之類的對外連線函式庫，前端也沒有絕對網址的請求。">
                      <b>電路板檔案不會離開這台機器。</b>解析與求解都在本機，
                      後端只監聽 127.0.0.1。
                      {storageInfo ? (
                        <>
                          <div style={{ marginTop: 6 }}>{storageInfo.board_outputs}</div>
                          <div style={{ marginTop: 6 }}>工具本身會寫入的位置：</div>
                          {storageInfo.locations.map(loc => (
                            <div key={loc.path} style={{ marginTop: 5 }}>
                              <div>
                                {loc.label}
                                {!loc.exists && <span>（尚未建立）</span>}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <code style={{ flex: 1, wordBreak: 'break-all', fontSize: 10 }}>
                                  {loc.path}
                                </code>
                                {loc.exists && (
                                  <button className="btn" style={{ fontSize: 10, padding: '0 6px' }}
                                    onClick={() => void revealInExplorer(loc.path)}>開啟</button>
                                )}
                              </div>
                              <div style={{ opacity: 0.85 }}>{loc.note}</div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div style={{ marginTop: 6 }}>讀取實際路徑中…</div>
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
                  <h3 className="panel-title">選擇網路（Nets）</h3>
                  <p className="panel-hint">左列雙擊或按「訊」加入訊號網路、按「參」加入參考網路；右列雙擊移除。</p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label="訊號清單檔案" ref={signalFileRef} type="file" accept=".txt,text/plain" hidden
                      onChange={handleImportSignalFile} />
                    <button className="btn" style={{ flex: 1 }} onClick={() => signalFileRef.current?.click()}
                      disabled={allNets.length === 0}>匯入訊號清單</button>
                    <button className="btn" style={{ flex: 1 }} onClick={handleExportSignalNets}
                      disabled={signalNets.length === 0}>匯出訊號清單</button>
                  </div>

                  {/* DDR 自動分類。DDR 一組 8～16 條要手選，選錯只有等眼圖出來才知道。 */}
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <button className="btn" style={{ flex: 1 }} onClick={handleClassifyNets}
                      disabled={allNets.length === 0 || ddrBusy}>
                      {ddrBusy ? '分類中…' : 'DDR 自動分類'}
                    </button>
                    {ddrResult && (
                      <button className="btn" style={{ flex: 1 }}
                        onClick={() => { setDdrResult(null); setDdrRoles([]) }}>收起結果</button>
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
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        勾選要加進訊號網路的角色
                      </div>
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
                            <span>{ddrResult.labels?.[role] || role}</span>
                            <span style={{ opacity: .6 }}>{ddrResult.counts[role]} 條</span>
                          </label>
                        ))}

                      {(ddrResult.lanes || []).length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>
                            或直接挑一個位元組通道
                          </div>
                          {(ddrResult.lanes || []).map((l: any) => {
                            const total = (l.data?.length || 0) + (l.mask?.length || 0)
                              + (l.strobe_p?.length || 0) + (l.strobe_n?.length || 0)
                            return (
                              <button key={l.lane} className="btn"
                                style={{ width: '100%', marginBottom: 4, textAlign: 'left' }}
                                onClick={() => applyDdrLane(l)}
                                title={[...(l.data || []), ...(l.mask || []),
                                        ...(l.strobe_p || []), ...(l.strobe_n || [])].join('、')}>
                                Byte {l.lane}：{total} 條
                                {l.has_strobe ? '（含選通）' : '（無選通）'}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {/* 沒有選通參考的組不能當位元組通道分析——組內資料訊號的
                          眼圖沒有共同的時間基準。這一定要講出來。 */}
                      {(ddrResult.lanes || []).some((l: any) => !l.has_strobe) && (
                        <div style={{ marginTop: 4, color: '#b45309' }}>
                          有位元組通道缺選通參考，那一組不能當位元組通道分析。
                        </div>
                      )}

                      {(ddrResult.ambiguous || []).length > 0 && (
                        <div style={{ marginTop: 4, color: '#b45309' }}>
                          {ddrResult.ambiguous.length} 條同時符合多個角色，請自行確認：
                          {ddrResult.ambiguous.slice(0, 5).map((r: any) => r.net).join('、')}
                          {ddrResult.ambiguous.length > 5 ? ' …' : ''}
                        </div>
                      )}

                      <div style={{ marginTop: 4, opacity: .7 }}>
                        另有 {(ddrResult.unmatched || []).length} 條看不出角色（電源、地與
                        非 DDR 網路都會落在這裡），不會被加入。
                      </div>

                      <button className="btn--primary" style={{ marginTop: 8, width: '100%' }}
                        onClick={applyDdrRoles} disabled={ddrRoles.length === 0}>
                        加入訊號網路
                      </button>
                    </div>
                  )}
                  <input aria-label="網路名稱過濾關鍵字"
                    type="text"
                    className="input"
                    placeholder="過濾關鍵字…"
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
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', padding: '2px 6px' }}>
                        可選網路（{availableFiltered.length}）
                      </div>
                      {availableFiltered.length === 0 && (
                        <div className="empty-hint" style={{ padding: '10px 8px', fontSize: 11.5, lineHeight: 1.6 }}>
                          {allNets.length === 0 ? '載入電路板後，網路會列在這裡。' : '沒有符合過濾關鍵字的網路。'}
                        </div>
                      )}
                      {availableFiltered.map(net => (
                        <div key={net} className="netlist__row" onDoubleClick={() => addSignal(net)}>
                          <span className="netlist__name" title={net}>{net}</span>
                          <button className="btn--mini" title="加入訊號網路" onClick={() => addSignal(net)}>訊</button>
                          <button className="btn--mini" title="加入參考網路" onClick={() => addRef(net)}>參</button>
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
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', padding: '2px 6px' }}>
                          訊號網路（{signalNets.length}）
                        </div>
                        {signalNets.map(net => (
                          <div key={net} className="netlist__row netlist__row--sig" onDoubleClick={() => removeSignal(net)} title="雙擊移除">
                            <span className="netlist__name">{net}</span>
                          </div>
                        ))}
                      </div>
                      <div className="netlist"
                        style={{ flex: 2, minHeight: NETLIST_REFERENCE_MIN_HEIGHT }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ok)', padding: '2px 6px',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>參考網路（{refNets.length}）</span>
                          <button className="btn" style={{ fontSize: 10.5, padding: '1px 6px' }}
                            onClick={suggestRefsByCopper}
                            title="依平面銅面積排序建議；回流路徑必然是大片銅">
                            依銅面積建議
                          </button>
                        </div>
                        {refSuggestions && (
                          <div style={{ padding: '2px 6px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {refSuggestions.length === 0 && (
                              <span style={{ fontSize: 11, opacity: 0.7 }}>讀不到平面銅面積。</span>
                            )}
                            {refSuggestions.map(item => (
                              <button key={item.net} className="btn"
                                style={{ fontSize: 10.5, padding: '1px 6px',
                                  opacity: refNets.includes(item.net) ? 0.45 : 1 }}
                                disabled={refNets.includes(item.net)}
                                onClick={() => addRef(item.net)}
                                title={`平面銅 ${item.area_cm2} cm²（${item.polygons} 個多邊形）；點擊加入參考網路`}>
                                {item.net}（{item.area_cm2} cm²）
                              </button>
                            ))}
                          </div>
                        )}
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
                      <input aria-label="向外擴張距離（mm）" type="number" className="input" min="0" step="0.5"
                        value={expansionMm} onChange={e => setExpansionMm(e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">框選範圍形狀</div>
                      <select aria-label="框選範圍形狀" className="input" value={extentType} onChange={e => {
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
                        ? '沿著走線轉彎，只向外擴張所設距離。'
                        : extentType === 'ConvexHull'
                          ? '斜向或彎折通道的內側會被弦線切過，多包無關銅箔。'
                          : '最保守也最大。'}
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
                      : '按上方按鈕顯示外框（與正式裁切同一套演算法）。'}
                  </div>
                </div>

                {/* 「執行裁切」：輸出與執行（直接分段模式不需要） */}
                <div hidden={!(show.cutout)} style={directSegmentMode ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <h3 className="panel-title">執行裁切</h3>
                  <p className="panel-hint">
                    只裁出通道，不建立 Port。Port 排在背鑽與清理之後。
                  </p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label="裁切輸出路徑"
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
                    支援 XML／CSV／JSON。<b>套用前會先列出差異</b>，永遠另存新檔。
                  </p>
                  <p className="panel-hint">
                    <b>排在裁切之後、背鑽與設定 Port 之前。</b>
                  </p>

                  <div className="field-label" style={{ marginTop: 6 }}>疊構檔</div>
                  <div className="field-row">
                    <input aria-label="疊構檔" type="text" className="input" value={stackupFilePath}
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
                    <select aria-label="疊構範本匯出格式" className="input" style={{ width: 76 }} value={stackupExportFormat}
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
                    <input aria-label="疊構更換輸出路徑" type="text" className="input" value={stackupOutputPath}
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
                    自動推導每顆訊號 Via 的連接層與應鑽側，確認後批次寫入。永遠另存新檔。
                  </p>

                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <div className="field-label" style={{ minWidth: 66 }}>保留殘樁</div>
                    <input aria-label="保留殘樁" type="number" className="input" style={{ width: 70 }} min="0" step="0.5"
                      value={bdTargetStubMil} onChange={e => setBdTargetStubMil(e.target.value)} />
                    <span className="panel-hint" style={{ margin: 0, fontSize: 11 }}>mil</span>
                    <div className="field-label" style={{ minWidth: 66, marginLeft: 8 }}>鑽頭加大</div>
                    <input aria-label="鑽頭加大" type="number" className="input" style={{ width: 70 }} min="0" step="1"
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
                                  <td style={{ padding: '3px 5px' }}>
                                    <span style={BD_NET_STYLE} title={entry.net}>{entry.net}</span></td>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    {entry.connected_layers.join(',') || '-'}</td>
                                  <td colSpan={4} style={{ padding: '3px 5px' }}>{entry.note}</td>
                                </tr>
                              ) : entry.stubs.map((stub: any, j: number) => (
                                <tr key={`${entry.id}-${j}`}>
                                  <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                    <input aria-label={`選取 ${entry.net} 的第 ${j + 1} 個殘樁`} type="checkbox" checked={stub.selected !== false}
                                      onChange={() => toggleBackdrillStub(i, j)} />
                                  </td>
                                  <td style={{ padding: '3px 5px' }}>
                                    <span style={BD_NET_STYLE} title={entry.net}>{entry.net}</span></td>
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
                        <input aria-label="背鑽輸出路徑" type="text" className="input" value={bdOutputPath}
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
                    保留訊號、參考平面、元件 Pin 與 Port。永遠另存新檔。
                  </p>
                  <div className="field-label" style={{ marginTop: 6 }}>清理等級</div>
                  <div className="field-row">
                    <select aria-label="清理等級" className="input" value={cleanupMode}
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
                      <input aria-label={cleanupMode === 'em_field' ? '最小保護距離（mm）' : '保護距離（mm）'} type="number" className="input" min="0.1" step="0.1"
                        value={cleanupGuardMm} onChange={e => { setCleanupGuardMm(e.target.value); setCleanupAnalysis(null) }}
                        disabled={!canSegment} />
                    </div>
                    {cleanupMode === 'em_field' && (
                      <div style={{ width: 105 }}>
                        <div className="field-label">目標隔離度（dB）</div>
                        <input aria-label="目標隔離度（dB）" type="number" className="input" min="20" max="80" step="5"
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
                    <input aria-label="Layout 清理輸出路徑" type="text" className="input" value={cleanupOutputPath}
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
                      <select aria-label="Port 類型" className="input" value={portType} onChange={e => setPortType(e.target.value)}>
                        <option value="auto">自動（建議）：細間距陣列走 Pin Group，其餘 Coax</option>
                        <option value="coax">Coax（同軸）</option>
                        <option value="circuit">Circuit（電路埠）</option>
                        <option value="pingroup">Pin Group（細間距 BGA）</option>
                      </select>
                      {portType === 'auto' && (
                        <div className="status" style={{ marginTop: 4, fontSize: 11.5 }}>
                          腳數破百的元件會讓整板走 Pin Group，其餘 Coax。
                          判定依據寫進系統日誌。
                        </div>
                      )}
                      {/* 座標型負端在 BGA 底下站不住：訊號球正下方就是 antipad。
                          SIwave 的失敗方式是靜默丟掉 Port，不報錯照樣解完。 */}
                      {portType === 'pingroup' && (
                        <div className="hint" style={{ marginTop: 4 }}>
                          負端＝該元件所有參考腳，不找座標。整組一致，不與
                          Coax 混用。
                        </div>
                      )}
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
                    <b>掃頻 SIwave 與 HFSS 共用</b>；Solution Frequency 與收斂條件只有 HFSS 用得到。
                  </p>

                  {/* 設定檔（HANDOFF 乙6）：同案子板子一片接一片，條件每次
                      重填一遍，填錯一格不報錯、只讓兩片解在不同條件下。 */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    <div className="field-label" style={{ minWidth: 60 }}>設定檔</div>
                    <select aria-label="設定檔" className="input" style={{ flex: 1 }}
                      value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)}>
                      <option value="">（未選擇）</option>
                      {profileNames.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <button className="btn" disabled={!selectedProfile}
                      onClick={() => void applyProfile(selectedProfile)}
                      title="把選定設定檔的欄位套進目前畫面（合併，不清空未存的欄位）">套用</button>
                    <button className="btn" onClick={() => void saveProfile()}
                      title="把目前的掃頻、收斂、裁切與 Port 設定存成有名字的一組">儲存為…</button>
                    <button className="btn" disabled={!selectedProfile}
                      onClick={() => void deleteProfile(selectedProfile)}>刪除</button>
                  </div>
                  {profileMsg && <p className="panel-hint" style={{ marginTop: 2 }}>{profileMsg}</p>}

                  {/* Sweep Type & Solution Freq */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <div className="field-label" style={{ minWidth: 60 }}>掃頻模式</div>
                    <select aria-label="掃頻模式" className="input" style={{ width: 140 }} value={sweepType} onChange={e => setSweepType(e.target.value)}>
                      <option value="Interpolating">Interpolating</option>
                      <option value="Discrete">Discrete</option>
                      <option value="Fast">Fast</option>
                    </select>
                    <div className="field-label" style={{ minWidth: 80, marginLeft: 12 }}>工作頻率 (GHz)</div>
                    <input aria-label="工作頻率 (GHz)" type="number" className="input" style={{ width: 100 }} min="0" step="0.1" value={solutionFreq} onChange={e => setSolutionFreq(e.target.value)} title="預設為掃頻頻寬的一半" />
                    <div className="field-label" style={{ minWidth: 100, marginLeft: 12 }}>Error Tolerance (%)</div>
                    <input aria-label="Error Tolerance (%)" type="number" className="input" style={{ width: 80 }} min="0.001" step="0.05" value={errorTolerance} onChange={e => setErrorTolerance(e.target.value)} title="Interpolating Sweep 收斂容差（AEDT 預設 0.5%，本工具預設 0.1%）" />
                  </div>

                  {/* Sweeps Table */}
                  <div style={{ marginTop: 12 }}>
                    {/* 求解器建議看的是「要用到幾 GHz」，不是掃到幾 GHz。
                        掃頻常開得比需要的寬（留 TDR、留餘裕），拿它當依據會把
                        低頻就夠用的 DDR 通道整段推去 HFSS。 */}
                    <div style={{ marginBottom: 8 }}>
                      <div className="field-label">這次要用到的頻寬（GHz）</div>
                      <input aria-label="這次要用到的頻寬（GHz）" className="input" type="number" step="0.5"
                        placeholder={targetFmaxGHz ? `留空＝跟掃頻上限 ${targetFmaxGHz} GHz` : '留空＝跟掃頻上限'}
                        value={usableBandwidthGHz}
                        onChange={e => { setUsableBandwidthGHz(e.target.value)
                                         setBandwidthBasis('') }} />
                      <div className="hint">與分段面板那一格是同一個值。</div>
                      <div className="hint">只影響求解器建議，不改掃頻範圍。</div>
                      {schedMetaPath && (
                        <button className="btn" style={{ marginTop: 4 }}
                          onClick={() => void reassessSolverBandwidth()}>
                          用這個頻寬重新評估求解器
                        </button>
                      )}
                    </div>
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
                                <select aria-label={`第 ${idx + 1} 段掃頻的分佈方式`} 
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
                                <input aria-label={`第 ${idx + 1} 段掃頻的起始頻率`} className="input" style={{ padding: '2px 4px', height: 24, fontSize: 12 }} value={sw.start} onChange={e => { const ns = [...sweeps]; ns[idx].start = e.target.value; setSweeps(ns); }} />
                              </td>
                              <td style={{ padding: 4 }}>
                                <input aria-label={`第 ${idx + 1} 段掃頻的結束頻率`} className="input" style={{ padding: '2px 4px', height: 24, fontSize: 12 }} value={sw.end} onChange={e => { const ns = [...sweeps]; ns[idx].end = e.target.value; setSweeps(ns); }} />
                              </td>
                              <td style={{ padding: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ fontSize: 11, color: 'var(--faint)', width: 50, flexShrink: 0 }}>
                                  {sw.distribution === 'Linear Count' ? 'Points' : sw.distribution === 'Log Scale' ? 'Samples' : 'Step size'}
                               </span>
                                <input aria-label={`第 ${idx + 1} 段掃頻的點數或步進`} className="input" style={{ flex: 1, padding: '2px 4px', height: 24, fontSize: 12, minWidth: 0 }} value={sw.value} onChange={e => { const ns = [...sweeps]; ns[idx].value = e.target.value; setSweeps(ns); }} />
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
                    <select aria-label="自適應方式" className="input" style={{ width: 190 }} value={adaptiveMode}
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
                  <div className="panel-hint" style={{ marginTop: 4, fontSize: 10.5, opacity: 0.75 }}
                    title="low memory mesh adaptive、frequency sweep acceleration via disk caching">
                    兩項 Beta 選項要自行在 AEDT 端開啟。
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <div className="field-label" style={{ minWidth: 74 }}>網格方法</div>
                    <select aria-label="網格方法" className="input" style={{ width: 150 }} value={hfssMeshMethod}
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
                        <input aria-label="Max Refinement Per Pass (%)" type="number" className="input" min="1" step="1" value={maxRefinementPerPass} onChange={e => setMaxRefinementPerPass(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--faint)' }}>Min Converged Passes</div>
                        <input aria-label="Min Converged Passes" type="number" className="input" min="1" step="1" value={minConvergedPasses} onChange={e => setMinConvergedPasses(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--faint)' }}>Max Passes</div>
                        <input aria-label="Max Passes" type="number" className="input" min="1" step="1" value={maxPasses} onChange={e => setMaxPasses(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--faint)' }}>Max Delta S</div>
                        <input aria-label="Max Delta S" type="number" className="input" min="0.001" step="0.01" value={maxDeltaS} onChange={e => setMaxDeltaS(e.target.value)} />
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
                    <b>跳過這一步，通道頭尾不會有 Port</b>，分段與求解都會白做。永遠另存新檔。
                  </p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input aria-label="Port 與求解器設定的輸出路徑"
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
                  {portsSetupBlockers.length > 0 && (
                    <div className="hint" style={{ marginTop: 4 }}>
                      還不能建立：{portsSetupBlockers.join('、')}
                    </div>
                  )}
                </div>

                {/* 「N 段分割」：N 段分割 */}
                <div hidden={!(show.segment)} style={{ opacity: canSegment ? 1 : 0.5 }}>
                  <h3 className="panel-title">N 段分割</h3>
                  <p className="panel-hint">
                    將裁切後的板子分成 N 段，切面自動截斷走線並建立 Gap Port。
                    {directSegmentMode && <span style={{ color: 'var(--accent)' }}>（載入的檔案已是通道，未經裁切）</span>}
                  </p>
                  {/* 頻寬放在**做決定的地方**。原本它在下面的「模擬設定」，
                      排在分段之後——按下不分割時它還是空的，於是求解器建議
                      永遠是純幾何判斷；使用者事後再填，畫面上什麼都不會變。

                      不放進下面那個格線：那個格線是 `80px 1fr` ＋
                      `alignItems: end`，塞一列三個控制項進去會擠成一團。 */}
                  <div style={{ marginTop: 7 }}>
                    <div className="field-label">這次要用到的頻寬（GHz）</div>
                    <div style={{
                      display: 'flex', gap: 6, flexWrap: 'wrap',
                      alignItems: 'center', marginTop: 3,
                    }}>
                      <input aria-label="這次要用到的頻寬（GHz）" className="input" type="number" step="0.5"
                        style={{ width: 90 }}
                        placeholder="留空＝純看幾何"
                        value={usableBandwidthGHz}
                        onChange={e => { setUsableBandwidthGHz(e.target.value)
                                         setBandwidthBasis('') }} />
                      <input aria-label="資料率（Gbps 或 MT/s）" className="input" type="number" step="0.1"
                        style={{ width: 110 }} placeholder="資料率 1866 或 1.866"
                        value={dataRateGbps}
                        onChange={e => setDataRateGbps(e.target.value)} />
                      <button className="btn" onClick={deriveBandwidth}
                        title="由資料率導出拐點 0.5/Tr">由資料率導出</button>
                    </div>
                    <div className="panel-hint" style={{ marginTop: 3 }}>
                      決定這一段用 SIwave 還是 HFSS，不改掃頻範圍。
                    </div>
                    <div className="panel-hint">
                      資料率填 1866 或 1.866 都可以。
                    </div>
                    {bandwidthBasis && (
                      <div className="status" style={{ fontSize: 11, marginTop: 3 }}>
                        {bandwidthBasis}
                      </div>
                    )}
                  </div>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '80px 1fr',
                    gap: 8, marginTop: 7, alignItems: 'end',
                  }}>
                    <div>
                      <div className="field-label">分段數 N</div>
                      <input aria-label="分段數 N" type="number" className="input" min="2" max="10" step="1"
                        value={nSegments} onChange={e => setNSegments(e.target.value)} disabled={!canSegment} />
                    </div>
                    <div>
                      <div className="field-label">可接受評分</div>
                      <select aria-label="可接受評分" className="input" value={segmentQuality}
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
                      適合<b>全段都用 HFSS</b>：各段大小相近。段數由上面的 N 決定。
                    </div>
                    <button className="btn--primary" style={{ gridColumn: '1 / -1', marginTop: 4 }}
                      onClick={handleComplexityAnalyze} disabled={!canSegment}>
                      依 3D 複雜度分析切割位置
                    </button>
                    <div className="panel-hint" style={{ gridColumn: '1 / -1', marginTop: -2 }}>
                      適合 <b>HFSS＋SIwave 混合求解</b>：3D 結構交給 HFSS，平面走線交給 SIwave。段數是偵測結果。
                    </div>
                  </div>
                  <div className="status" style={{ marginTop: 5, fontSize: 11.5 }}>
                    在這個評分之上盡量平分——總時間由最大的那一段決定。
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
                        餘裕尚未以實測校準，是目前最沒把握的一環；數值記進 segments.json。
                      </div>
                      <div className="status" style={{ marginTop: 4, fontSize: 11 }}>
                        可在預覽圖上<b>直接拖曳刀線</b>，放開後重新評分。把數與方向不能改。
                      </div>

                      {/* 單參考切面的提示。這條路有自己的顯示區塊，等分那邊補了
                          這邊沒補的話，走複雜度分段的人照樣看不到。 */}
                      {[...new Set(complexityAnalysis.cuts
                        .map(c => c.stitch_return_path_risk)
                        .filter((m): m is string => !!m))].map(msg => (
                        <div key={msg} className="status status--warn"
                          style={{ marginTop: 6, fontSize: 11 }}>
                          {complexityAnalysis.cuts.length} 把刀：{msg}
                        </div>
                      ))}

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
                                .map(r => `${r.grade} 級`).join('、')} 可行。`
                            : '　C 級也無解，請降低分段數 N。'}
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
                      {/* 單參考切面的提示。誤差隨刀數累加，所以那是整條計畫的
                          性質、不是某一刀的性質——去重後只顯示一次，並帶上刀數。 */}
                      {[...new Set(segAnalysis.cuts
                        .map(c => c.stitch_return_path_risk)
                        .filter((m): m is string => !!m))].map(msg => (
                        <div key={msg} className="status status--warn"
                          style={{ marginTop: 6, fontSize: 11 }}>
                          {segAnalysis.cuts.length} 把刀：{msg}
                        </div>
                      ))}
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
                    <input aria-label="分段輸出資料夾" type="text" className="input" value={segOutputDir}
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
                    不建立切面 Port，Port 全部來自〈設定 Port 與求解器〉。適合當分段的對照基準。
                  </div>
                  {segRun && (
                    <div className="status status--ok" style={{ marginTop: 6, fontSize: 11.5 }}>
                      已產生 {segRun.segments.length} 段，切面 Port 配對
                      {segRun.cut_pairs.reduce((a, c) => a + c.pairs.length, 0)} 組，
                      對應表 segments.json 已輸出。
                    </div>
                  )}
                  <p className="panel-caveat">
                    <b>切面附近的場由 Gap Port 近似。</b>判斷整段的趨勢可靠，緊貼切面的
                    單點數值不可靠——要讀那裡的值就把切面移開。
                  </p>
                </div>

                {/* 「排程求解」：排程求解 */}
                <div hidden={!show.schedule}
                  style={{ opacity: (schedMetaPath || segRun) ? 1 : 0.5 }}>
                  <h3 className="panel-title">
                    排程求解{segmentSolverPlans.length > 0 ? '（混合求解區域）' : ''}
                  </h3>
                  <p className="panel-hint">
                    每段依序求解，結果寫回 segments.json。
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
                                  <select aria-label={`第 ${plan.index} 段要用的求解器`}
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
                      <input aria-label="求解核心數" type="number" className="input" min="1" step="1"
                        value={solverCores}
                        onChange={event => setSolverCores(event.target.value)}
                        disabled={schedStatus?.running} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">記憶體安全預算（%）</div>
                      <input aria-label="記憶體安全預算（%）" type="number" className="input" min="10" max="95" step="5"
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
                    <input aria-label="segments.json 路徑" type="text" className="input" value={schedMetaPath}
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
                    <b>不必重跑分段</b>：指向先前的 segments.json 即可直接排程或打包。
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
                        <input aria-label="遠端求解包輸出資料夾" className="input" style={{ flex: 1 }} value={packDir}
                          onChange={e => setPackDir(e.target.value)}
                          placeholder="輸出資料夾…（需為新資料夾，例如 jobs\\pack1）" />
                        <button className="btn" onClick={handleBuildRemotePack}
                          disabled={packBusy}>
                          {packBusy ? '打包中…' : '匯出求解包'}
                        </button>
                      </div>
                      <div className="panel-hint" style={{ marginTop: 4, fontSize: 11 }}>
                        複製到求解機雙擊 run_all.bat，再把 results 複製回來。
                      </div>
                      <div className="panel-hint" style={{ marginTop: 3, fontSize: 11 }}>
                        核心數兩種段都套用。
                        <b style={{ color: 'var(--warn)' }}>HFSS 超過 4 核需 anshpc 授權</b>。
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <input aria-label="求解完成的資料夾" className="input" style={{ flex: 1 }} value={ingestDir}
                          onChange={e => setIngestDir(e.target.value)}
                          placeholder="求解完的資料夾…（求解包或其中的 results）" />
                        <button className="btn" onClick={handleIngestResults}
                          disabled={ingestBusy}>
                          {ingestBusy ? '收檔中…' : '收回結果'}
                        </button>
                      </div>
                      <div className="panel-hint" style={{ marginTop: 4, fontSize: 11 }}>
                        驗證 Port 數與格式後才寫入 segments.json。
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
                  <p className="panel-caveat">
                    <b>SIwave 是準靜態近似</b>，篩選夠用；要簽核的那幾條建議改用 HFSS
                    全波重跑一次再比對。
                  </p>
                </div>

                {/* 「電路串接」：電路串接 */}
                <div hidden={!(show.cascade)}>
                  <h3 className="panel-title">電路串接</h3>
                  <p className="panel-hint">
                    依配對表對接，還原完整通道 S 參數。可先「預覽接線」再執行。
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
                            單一檔案沒有段可接，直接進「S 參數」分頁檢視。差動對由 Port 名稱自動配。
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
                              <select aria-label={`第 ${i + 1} 條接線的 A 端檔案`} className="input" style={{ width: 46, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.a_file}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, a_file: +e.target.value, a_port: extFiles[+e.target.value]?.port_names[0] || '' } : x))}>
                                {extFiles.map((_, fi) => <option key={fi} value={fi}>#{fi + 1}</option>)}
                              </select>
                              <select aria-label={`第 ${i + 1} 條接線的 A 端 Port`} className="input" style={{ flex: 1, minWidth: 0, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.a_port}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, a_port: e.target.value } : x))}>
                                {(extFiles[c.a_file]?.port_names || []).map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                              <span style={{ fontSize: 10 }}>↔</span>
                              <select aria-label={`第 ${i + 1} 條接線的 B 端檔案`} className="input" style={{ width: 46, padding: '2px 3px', fontSize: 10.5 }}
                                value={c.b_file}
                                onChange={e => setExtConns(prev => prev.map((x, k) => k === i ? { ...x, b_file: +e.target.value, b_port: extFiles[+e.target.value]?.port_names[0] || '' } : x))}>
                                {extFiles.map((_, fi) => <option key={fi} value={fi}>#{fi + 1}</option>)}
                              </select>
                              <select aria-label={`第 ${i + 1} 條接線的 B 端 Port`} className="input" style={{ flex: 1, minWidth: 0, padding: '2px 3px', fontSize: 10.5 }}
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
                              <select aria-label={`第 ${i + 1} 組短路的檔案`} className="input" style={{ width: 46, padding: '2px 3px', fontSize: 10.5 }}
                                value={s.file}
                                onChange={e => {
                                  const fi = +e.target.value
                                  const pn = extFiles[fi]?.port_names || []
                                  setExtShorts(prev => prev.map((x, k) => k === i ? { file: fi, ports: [pn[0] || '', pn[1] || pn[0] || ''] } : x))
                                }}>
                                {extFiles.map((_, fi) => <option key={fi} value={fi}>#{fi + 1}</option>)}
                              </select>
                              {[0, 1].map(pi => (
                                <select aria-label={`第 ${i + 1} 組短路的第 ${pi + 1} 個 Port`} key={pi} className="input" style={{ flex: 1, minWidth: 0, padding: '2px 3px', fontSize: 10.5 }}
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
                      {/* 證據徽章：這份 S 參數是誰、用什麼設定解出來的。
                          後端的判定早就有了，這是它第一個對使用者的出口。 */}
                      <EvidenceBadges path={cascadeResult.output_path}
                        expectedPorts={cascadeResult.n_ports} />
                      {cascadeMode === 'tool' && (
                        <button className="btn" onClick={handleCascadeExportAs}
                          disabled={cascadeBusy}
                          style={{ width: '100%', marginTop: 6 }}>
                          一鍵另存完整 Touchstone
                        </button>
                      )}
                      {/* 舊版串接後 QuickEye 設定保留在程式中供既有工作狀態相容，
                          但 UI 永久隱藏；新工作一律由右側「IBIS 模型與眼圖分析」執行。 */}
                      <div hidden style={{
                        marginTop: 8, padding: 8, border: '1px solid var(--border)',
                        borderRadius: 7, background: 'rgba(40, 70, 110, 0.08)',
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>眼圖（QuickEye）</div>
                        <div className="panel-hint" style={{ marginTop: 3 }}>
                          用上方串接結果直接求解，背景執行。
                        </div>
                        <details style={{ marginTop: 6 }}>
                          <summary className="panel-hint" style={{ cursor: 'pointer' }}>
                            進階：另外輸出 Circuit 專案（不求解）
                          </summary>
                          <div className="field-row" style={{ marginTop: 6 }}>
                            <div style={{ flex: 1 }}>
                              <div className="field-label">Circuit 形式</div>
                              <select aria-label="Circuit 形式" className="input" value={circuitExportMode}
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
                                <select aria-label="眼圖模式" className="input" value={eyeMode}
                                  onChange={event => setEyeMode(event.target.value as 'single' | 'differential')}>
                                  <option value="single" disabled={cascadeResult.n_ports !== 2}>單端（2-Port）</option>
                                  <option value="differential" disabled={cascadeResult.n_ports !== 4}>差動（4-Port）</option>
                                </select>
                              </div>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">資料速率（Gbps）</div>
                                <input aria-label="資料速率（Gbps）" className="input" type="number" min="0.001" step="0.1"
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
                                <input aria-label="Tr／Tf（ps）" className="input" type="number" min="0.001" step="0.1"
                                  value={eyeRiseTime} onChange={event => setEyeRiseTime(event.target.value)} />
                              </div>
                            </div>
                            <div className="field-row" style={{ marginTop: 5 }}>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">輸入 P</div>
                                <select aria-label="輸入 P" className="input" value={eyeInputP}
                                  onChange={event => setEyeInputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {eyeMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">輸入 N</div>
                                  <select aria-label="輸入 N" className="input" value={eyeInputN}
                                    onChange={event => setEyeInputN(event.target.value)}>
                                    {cascadeResult.port_names.map((name: string) =>
                                      <option key={name} value={name}>{name}</option>)}
                                  </select>
                                </div>
                              )}
                              <div style={{ flex: 1 }}>
                                <div className="field-label">輸出 P</div>
                                <select aria-label="輸出 P" className="input" value={eyeOutputP}
                                  onChange={event => setEyeOutputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {eyeMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">輸出 N</div>
                                  <select aria-label="輸出 N" className="input" value={eyeOutputN}
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
                      {/* 面板內原有的 S(A,B) 手動加曲線區塊已移除——「S 參數」
                          分頁的自動曲線（IL/RL/NEXT/FEXT、單端／差動切換）
                          已完整取代它。 */}
                    </>
                  )}
                  <p className="panel-caveat">
                    <b>串接假設段與段之間沒有電磁耦合。</b>段界靠得太近，或切面兩側共用
                    同一處參考層破口時，這個假設不成立。
                  </p>
                  <RunHistory kind="cascade" title="串接執行歷史" />
                  {/* TDR 面板刻意放在 cascadeResult 條件之外：量測波形匯入
                      只需要板子與示波器 CSV——客戶拿量測檔來的時候，常常
                      根本還沒跑過串接。模擬路的區塊自己再看 tdrSuggestion。 */}
                  <div hidden={!show.tdr} style={{
                        marginTop: 8, padding: 8, border: '1px solid var(--border)',
                        borderRadius: 7, background: 'rgba(110, 40, 70, 0.08)',
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>TDR 阻抗定位</div>
                        <div className="panel-hint" style={{ marginTop: 3 }}>
                          {cascadeResult
                            ? '用串接結果求解 TDR，換算成 Layout 位置。'
                            : '尚未串接。可先用下方「量測波形匯入」定位量測到的劇變。'}
                        </div>
                        {tdrSuggestion && (
                          <>
                            <div className={`status ${tdrSuggestion.supported ? '' : 'status--warn'}`}
                              style={{ marginTop: 6, fontSize: 11 }}>
                              頻寬 {Number(tdrSuggestion.f_max_ghz).toFixed(1)} GHz →
                              上升時間 {Number(tdrSuggestion.rise_time_ps).toFixed(2)} ps。
                              {tdrSuggestion.note}
                            </div>
                            <div className="field-row" style={{ marginTop: 6 }}>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">模式</div>
                                <select aria-label="模式" className="input" value={tdrMode}
                                  onChange={event => setTdrMode(event.target.value as 'single' | 'differential')}>
                                  {/* 單端不限 Port 數：4-Port 檔也常要探單一條線
                                      （其餘 Port 自動 50Ω 端接）。 */}
                                  <option value="single">單端（探單一條線）</option>
                                  <option value="differential" disabled={cascadeResult.n_ports < 4}>差動（P／N 一對）</option>
                                </select>
                              </div>
                              <div style={{ flex: 1 }}
                                title="B 法（疊構 Dk）的速度來源：由目前載入疊構的介電層厚度加權平均自動計算，不需輸入。">
                                <div className="field-label">介電常數（疊構自動）</div>
                                <div className="input" style={{
                                  display: 'flex', alignItems: 'center',
                                  color: tdrDkHint ? undefined : '#8fa1b5',
                                }}>
                                  {tdrDkHint
                                    ? Number(tdrDkHint).toFixed(2)
                                    : '未載入電路板，僅用 A 法'}
                                </div>
                              </div>
                            </div>
                            <div className="field-row" style={{ marginTop: 5 }}>
                              <div style={{ flex: 1 }}>
                                <div className="field-label">探棒（輸入）P</div>
                                <select aria-label="探棒（輸入）P" className="input" value={tdrInputP}
                                  onChange={event => setTdrInputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {tdrMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">輸入 N</div>
                                  <select aria-label="輸入 N" className="input" value={tdrInputN}
                                    onChange={event => setTdrInputN(event.target.value)}>
                                    {cascadeResult.port_names.map((name: string) =>
                                      <option key={name} value={name}>{name}</option>)}
                                  </select>
                                </div>
                              )}
                              <div style={{ flex: 1 }}>
                                <div className="field-label">遠端 P</div>
                                <select aria-label="遠端 P" className="input" value={tdrOutputP}
                                  onChange={event => setTdrOutputP(event.target.value)}>
                                  {cascadeResult.port_names.map((name: string) =>
                                    <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              {tdrMode === 'differential' && (
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">遠端 N</div>
                                  <select aria-label="遠端 N" className="input" value={tdrOutputN}
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
                                  <div className="field-label">被探測的訊號網路（Layout 標記）</div>
                                  <select aria-label="被探測的訊號網路（Layout 標記）" className="input" value={tdrNet}
                                    onChange={event => setTdrNet(event.target.value)}>
                                    {signalNets.map(net =>
                                      <option key={net} value={net}>{net}</option>)}
                                  </select>
                                </div>
                                <label style={{
                                  flex: 1, display: 'flex', alignItems: 'center', gap: 4,
                                  fontSize: 11, cursor: 'pointer', marginTop: 14,
                                }}
                                  title="TDR 距離從探棒端起算。若標記位置像是從走線另一端量的，勾這裡翻轉起點。">
                                  <input type="checkbox" checked={tdrFlipStart}
                                    onChange={event => setTdrFlipStart(event.target.checked)} />
                                  起點在另一端
                                </label>
                              </div>
                            )}
                            {tdrPath && (
                              <div className="panel-hint" style={{ marginTop: 4 }}>
                                通道實體長度 {Number(tdrPath.length_mm).toFixed(2)} mm
                                （起點 {tdrPath.start_mm.map((v: number) => v.toFixed(1)).join(', ')}）
                                {tdrPath.unchained > 0
                                  ? `　⚠ 有 ${tdrPath.unchained} 段走線未能串入路徑` : ''}
                              </div>
                            )}
                            <button className="btn btn--primary" style={{ width: '100%', marginTop: 6 }}
                              disabled={tdrJob?.running || cascadeBusy || !tdrSuggestion.supported}
                              onClick={handleTdrRun}>
                              {tdrJob?.running ? 'TDR 求解中…（背景執行）' : '執行 TDR'}
                            </button>
                          </>
                        )}
                        {tdrJob?.status === 'error' && (
                          <div className="status status--warn"
                            style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
                            上次 TDR 執行失敗：{tdrJob.error}
                          </div>
                        )}
                        {/* 量測波形匯入（乙路）：不依賴串接結果——客戶拿
                            示波器檔來的時候，常常手上只有板子與波形。 */}
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            量測波形匯入（示波器 TDR）
                          </summary>
                          <div className="panel-hint" style={{ marginTop: 4 }}>
                            兩欄 CSV（時間、電壓或阻抗）→ 指認 t0 與線尾 → 劇變標回 Layout。
                          </div>
                          <div className="panel-hint" style={{ marginTop: 2 }}>
                            t0 是板端 launch 反射的時刻，得由你指認——程式只給候選，不代答。
                          </div>
                          <div className="panel-hint" style={{ marginTop: 2 }}>
                            分析完成後，結果會出現在上方的「TDR」分頁——
                            <strong>在那之前它是暗的，這是正常的</strong>，不是壞掉。
                          </div>
                          <div className="field-row" style={{ marginTop: 5 }}>
                            <div style={{ flex: 2 }}>
                              <div className="field-label">波形 CSV 路徑</div>
                              <input aria-label="波形 CSV 路徑" className="input" value={tmCsvPath}
                                onChange={event => setTmCsvPath(event.target.value)}
                                placeholder="示波器匯出的 .csv" />
                            </div>
                            <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
                              onClick={() => void browseCsvInto(setTmCsvPath, '選擇示波器 TDR 波形 CSV')}>
                              瀏覽…
                            </button>
                            <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
                              disabled={tmBusy || !tmCsvPath.trim()} onClick={handleTmLoad}>
                              {tmBusy && !tmPreview ? '載入中…' : '載入'}
                            </button>
                            {tmCsvPath.trim() && (
                              <button className="btn" style={{ marginTop: 14, whiteSpace: 'nowrap' }}
                                title="在檔案總管開啟這個波形檔所在的資料夾"
                                onClick={() => void revealInExplorer(tmCsvPath)}>
                                開啟資料夾
                              </button>
                            )}
                          </div>
                          {tmPreview && (
                            <>
                              <div className="panel-hint" style={{ marginTop: 4 }}>
                                {tmPreview.point_count} 點｜單位 {tmPreview.time_unit}（自動判定）｜
                                {tmPreview.value_kind === 'volts' ? '電壓'
                                  : tmPreview.value_kind === 'ohms' ? '阻抗' : '反射係數'}
                                {tmPreview.edge_time_ns != null
                                  && `｜入射步階 ${Number(tmPreview.edge_time_ns).toFixed(3)} ns`}
                                {tmPreview.rise_time_ps != null
                                  && `｜實測上升 ${Number(tmPreview.rise_time_ps).toFixed(1)} ps`}
                              </div>
                              {(tmPreview.candidates_ns || []).length > 0 && (
                                <div style={{ marginTop: 5 }}>
                                  <div className="field-label">
                                    反射候選（t0＝板端 launch；線尾＝開路／端接反射）
                                  </div>
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
                                          onClick={() => setTmT0(candidate.toFixed(4))}>設 t0</button>
                                        <button className="btn" style={{ padding: '2px 7px' }}
                                          onClick={() => setTmTEnd(candidate.toFixed(4))}>設線尾</button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="field-row" style={{ marginTop: 5 }}>
                                <div style={{ flex: 1 }}>
                                  <div className="field-label">t0：板端入口（ns）</div>
                                  <input aria-label="t0：板端入口（ns）" className="input" value={tmT0}
                                    onChange={event => setTmT0(event.target.value)} />
                                </div>
                                <div style={{ flex: 1 }}
                                  title="線尾反射的時刻。配上走線實體長度就是雙錨點法：兩端依定義精確，Dk 公差的累積誤差被歸零。留空則只用疊構 Dk 法。">
                                  <div className="field-label">線尾反射（ns，可留空）</div>
                                  <input aria-label="線尾反射（ns，可留空）" className="input" value={tmTEnd}
                                    onChange={event => setTmTEnd(event.target.value)} />
                                </div>
                                {tmPreview.value_kind !== 'volts' && (
                                  <div style={{ flex: 1 }}
                                    title="阻抗／反射係數波形量不到入射邊緣，上升時間要填儀器的系統規格值（常見 20～50 ps）。">
                                    <div className="field-label">上升時間（ps）</div>
                                    <input aria-label="上升時間（ps）" className="input" value={tmRise}
                                      onChange={event => setTmRise(event.target.value)} />
                                  </div>
                                )}
                              </div>
                              <div className="panel-hint" style={{ marginTop: 3 }}>
                                速度來源：
                                {tdrPath?.length_mm
                                  ? `雙錨點（走線 ${Number(tdrPath.length_mm).toFixed(1)} mm，需指定線尾）`
                                  : '無走線長度（先載入電路板才能用雙錨點法）'}
                                {tdrDkHint ? `｜疊構 Dk ${Number(tdrDkHint).toFixed(2)}` : ''}
                              </div>
                              {!tdrSuggestion && signalNets.length > 0 && (
                                <div className="field-row" style={{ marginTop: 5 }}>
                                  <div style={{ flex: 2 }}>
                                    <div className="field-label">被探測的訊號網路（Layout 標記）</div>
                                    <select aria-label="被探測的訊號網路（Layout 標記）" className="input"
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
                                    title="TDR 距離從探棒端起算。標記像從另一端量的就勾這裡。">
                                    <input type="checkbox" checked={tdrFlipStart}
                                      onChange={event => setTdrFlipStart(event.target.checked)} />
                                    起點在另一端
                                  </label>
                                </div>
                              )}
                              <button className="btn btn--primary" style={{ width: '100%', marginTop: 6 }}
                                disabled={tmBusy || !tmT0.trim()}
                                onClick={handleTmAnalyze}>
                                {tmBusy && tmPreview ? '分析中…' : '分析量測波形'}
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
                          <b>阻抗值來自求解結果，距離是用推估的等效 Dk 換算的。</b>阻抗可信，
                          位置有誤差；Layout 上的標記是定位參考，不是量測座標。
                        </p>
                        {/* TDR 的執行歷史。求解與量測兩條路都寫紀錄，
                            列在同一份清單裡——它們是同一種分析的兩種來源。 */}
                        <RunHistory kind="tdr" title="TDR 執行歷史" />
                  </div>
                </div>

                {/* 「截面阻抗（Q2D）」：從 EDB 還原二維截面，求該處的阻抗 */}
                <div hidden={!show.crosssection}>
                  <h3 className="panel-title">截面阻抗（Q2D）</h3>
                  <p className="panel-hint">
                    在右側分頁框範圍、拉切線，再回來掃描。掃描只讀 EDB，不佔用 AEDT 授權。
                  </p>
                  <div className="panel-hint" style={{ marginTop: 4 }}>
                    框寬是模型的側向截斷邊界，太窄會讓阻抗算高。建議取導體到參考面高度的 10 倍。
                  </div>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">取樣間距（µm）</div>
                      <input aria-label="取樣間距（µm）" className="input" value={xsResolutionUm}
                        onChange={event => setXsResolutionUm(event.target.value)}
                        title="沿切線每隔多遠問一次「這裡有沒有銅」。比最細的線寬小一個級距就夠。" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">導體到參考面（µm，選填）</div>
                      <input aria-label="導體到參考面（µm，選填）" className="input" value={xsHeightUm}
                        onChange={event => setXsHeightUm(event.target.value)}
                        title="填了才判定得出側向截斷夠不夠；沒填就不假裝知道。" />
                    </div>
                  </div>
                  <div className="panel-hint" style={{ marginTop: 5 }}>
                    {xsRegion
                      ? `工作範圍 ${xsRegion.x0Mm.toFixed(2)}, ${xsRegion.y0Mm.toFixed(2)} → `
                        + `${xsRegion.x1Mm.toFixed(2)}, ${xsRegion.y1Mm.toFixed(2)} mm`
                      : '尚未框工作範圍'}
                    {xsCut
                      ? `　·　切線 ${xsCut.axis.toUpperCase()} = ${xsCut.coordinateMm.toFixed(3)} mm`
                      : '　·　尚未拉切線'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button className="btn btn--primary" style={{ flex: 1.4 }}
                      disabled={!xsRegion || !xsCut || xsBusy}
                      onClick={() => runCrossSectionScan()}>
                      {xsBusy ? '掃描中…' : '掃描截面'}
                    </button>
                    <button className="btn" style={{ flex: 1 }}
                      disabled={!xsRegion || !xsCut}
                      onClick={handleXsSaveCut}
                      title="切線是你對這片板子的標註，存在 .aedb 旁邊，複製給同事時一起過去。">
                      存下這條切線
                    </button>
                  </div>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div className="field-label">求解精度</div>
                      <select aria-label="求解精度" className="input" value={xsSolveMode}
                        onChange={event => setXsSolveMode(event.target.value)}>
                        <option value="fast">快速（表面阻抗，PerError 1%）</option>
                        <option value="standard">標準（表面阻抗，PerError 0.2%）</option>
                        <option value="accurate">高精度（導體內部解場，慢三倍）</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}
                      title="自適應網格用的頻率。要看的是那個頻段的阻抗就填那個頻率。">
                      <div className="field-label">自適應頻率</div>
                      <input aria-label="自適應頻率" className="input" value={xsFrequency}
                        onChange={event => setXsFrequency(event.target.value)} />
                    </div>
                  </div>
                  <div className="panel-hint" style={{ marginTop: 4 }}>
                    只要阻抗的話三檔差別很小；要頻率相依的串聯電阻才需要高精度。
                  </div>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginTop: 6,
                    fontSize: 11.5, cursor: 'pointer',
                  }}
                    title="判斷側向範圍夠不夠的唯一方法，是加大到數值不再變化。建議留白（導體到參考面高度的 10 倍）只是起點。">
                    <input type="checkbox" checked={xsWidenCheck}
                      onChange={event => setXsWidenCheck(event.target.checked)} />
                    順便驗側向收斂（框加寬 {(WIDEN_FACTOR - 1) * 100}% 再解一次，時間加倍）
                  </label>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button className="btn btn--primary" style={{ flex: 1.4 }}
                      disabled={!xsScan?.plan?.solvable || xsJob?.running}
                      onClick={() => {
                        const spec = xsCutSpec()
                        if (spec) handleXsSolve([spec])
                      }}
                      title={xsScan?.plan?.solvable
                        ? '只解目前這一條切線'
                        : '先掃描一條可以求解的截面'}>
                      {xsJob?.running ? '求解中…（背景執行）' : '求解這條'}
                    </button>
                    <button className="btn" style={{ flex: 1 }}
                      disabled={xsSavedCuts.length === 0 || xsJob?.running}
                      onClick={() => handleXsSolve(xsSavedCuts)}
                      title="把已存的切線整批送去求解，沿線的 Z₀ 剖面就是這樣做出來的">
                      解全部已存（{xsSavedCuts.length}）
                    </button>
                    {xsJob?.running && (
                      <button className="btn" style={{ flex: 0.7 }}
                        onClick={handleXsStop}>終止</button>
                    )}
                  </div>
                  {xsJob && xsJob.status !== 'idle' && (
                    <div className={`status ${xsJob.status === 'error' ? 'status--warn' : ''}`}
                      style={{ marginTop: 6, fontSize: 11 }}>
                      {xsJob.phase}
                      {xsJob.message ? `：${xsJob.message}` : ''}
                      {xsJob.running && xsJob.started_at
                        ? `　已耗時 ${Math.max(0, Math.round(nowTick - xsJob.started_at))} 秒`
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
                      <div className="field-label">
                        已存的切線（{xsSavedCuts.length} 條）
                      </div>
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
                        <div className="panel-hint" style={{ marginTop: 3, wordBreak: 'break-all' }}>
                          存放位置：{xsCutsSource}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="panel-caveat">
                    <b>二維解假設截面沿走線方向不變。</b>過孔、轉角與參考層破口都不在這個
                    模型裡——要看那些結構得用 3D。
                  </p>
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
                {/* 舊版單一 QuickEye 結果頁不再作為入口；新眼圖直接在 IBIS 分析向導顯示。 */}
                <button
                  hidden
                  className={'viewtab' + (activeView === 'eye' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('eye')}
                  disabled={!eyeJob || eyeJob.status === 'idle'}
                >眼圖</button>
                <button
                  hidden={!(show.models)}
                  className={'viewtab' + (activeView === 'models' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('models')}
                >IBIS 模型與眼圖分析</button>
                {/* 分頁在條件未滿足時是暗的。**一定要說明為什麼**——使用者
                    回報「操作量測波形匯入時 TDR 分頁是暗的，容易使人誤會」，
                    以為功能壞了。`title` 掛在外層 span 而不是按鈕上：停用的
                    表單控制項不接收滑鼠事件，tooltip 不會出現。 */}
                <span hidden={!(show.tdr)}
                  title={!tdrJob || tdrJob.status === 'idle'
                    ? '還沒有 TDR 結果。在左側面板執行 TDR 阻抗定位，或用「量測波形匯入」載入示波器波形並分析，完成後這個分頁就會亮起來。'
                    : ''}>
                  <button
                    className={'viewtab' + (activeView === 'tdr' ? ' viewtab--active' : '')}
                    onClick={() => setActiveView('tdr')}
                    disabled={!tdrJob || tdrJob.status === 'idle'}
                  >TDR</button>
                </span>
                <span hidden={!(show.crosssection)}
                  title={!fullScene ? '還沒載入電路板。載入之後才能框選截面範圍。' : ''}>
                  <button
                    className={'viewtab' + (activeView === 'crosssection' ? ' viewtab--active' : '')}
                    onClick={() => setActiveView('crosssection')}
                    disabled={!fullScene}
                  >截面阻抗</button>
                </span>
                <button
                  hidden={!(show.report)}
                  className={'viewtab' + (activeView === 'report' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('report')}
                >報告</button>
                </div>
                {show.report && reportSnapshotAvailable && (
                  <div className="viewtabs-aside">
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
                        // 截面阻抗分頁另外帶上實際數字。快照是一張圖，
                        // 圖上的字在報告裡縮小之後未必讀得出來；數字進中繼資料
                        // 表格才會以文字保留下來。
                        ...(activeView === 'crosssection'
                          ? crossSectionReportMetadata() : {}),
                        // 模型分頁同理：秒測／統計眼／COM 的數字由各元件寫進
                        // store，這裡整批掛上。
                        ...(activeView === 'models'
                          ? modelsReportMetadata() : {}),
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
                      <div id="report-result-capture" className="panel view-stage" style={{ overflow: 'hidden', position: 'relative', height: '100%', background: '#0c0e12', borderTopLeftRadius: 0 }}>
                        {(isLayoutView || activeView === 'schematic') && <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 1, fontSize: 12.5, fontWeight: 700, color: activeView === 'cut' ? '#7ee787' : '#9fb0c3', pointerEvents: 'none' }}>
                          {sceneLabel}
                          {scene?.preview_mode === 'coarse' ? ' · 大板快速預覽（實際 EDB 未簡化）' : ''}
                          {activeView !== 'schematic' ? ' · 左鍵平移、滾輪縮放 · 右側 ◀▶ 展開圖層面板' : ''}
                          {activeView === 'cut' && completedBoundary?.comparison?.available
                            ? ` · 外框最大差異 ${completedBoundary.comparison.max_boundary_error_mm?.toFixed(3)} mm`
                            : ''}
                        </div>}
                        {activeView === 'models' ? (
                          <ModelLibrary />
                        ) : activeView === 'report' ? (
                          <ReportCenter basePath={reportBasePath} projectName={reportProjectName}
                            onWorkspaceChange={rememberReportWorkspace}
                            channelTouchstone={cascadeResult?.output_path || ''} />
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

                            {/* 量測在 measurements.metrics 底下，不是 measurements 本身。
                                外層是 ADR-0039 的可得性包裝（available／source／api／
                                unavailable_reason／attempted），直接展開會列出六張沒有
                                意義的卡，而真正的 11 項一個都不會出現。 */}
                            {eyeJob?.result?.measurements?.available === false && (
                              <div className="status status--warn" style={{ marginTop: 14 }}>
                                取不到眼圖量測：{eyeJob.result.measurements.unavailable_reason}
                              </div>
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
                        ) : activeView === 'tdr' ? (
                          // overflow 用 hidden 不用 auto：整頁必須塞進視窗，
                          // 一出現捲軸，報告快照就截不到下半部的曲線圖。
                          <div style={{
                            height: '100%', overflow: 'hidden', padding: 14,
                            display: 'flex', flexDirection: 'column', gap: 8,
                            fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
                            color: '#d8e1ec',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                              <div>
                                <h2 style={{ margin: 0, fontSize: 20 }}>TDR 阻抗定位</h2>
                                <div style={{ color: '#8fa1b5', fontSize: 12, marginTop: 4 }}>
                                  阻抗劇變依 |dZ/dx| 峰值排序；標記畫成空間解析度的寬度，那是物理極限而非誤差。
                                </div>
                                {/* 量測波形那一路的輸入是示波器 CSV，不是 Touchstone——
                                    把串接檔的證據掛上去會指向錯的東西。 */}
                                {tdrJob?.result?.source !== 'measured_waveform'
                                  && cascadeResult?.output_path && (
                                  <EvidenceBadges path={cascadeResult.output_path}
                                    expectedPorts={cascadeResult.n_ports} dark />
                                )}
                              </div>
                              {tdrJob?.result && (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {(() => {
                                    const analysis = tdrJob.result.analyses?.[tdrAnalysisIdx]
                                    const chips: [string, string][] = [
                                      ['上升時間', `${Number(tdrJob.result.rise_time_ps).toFixed(2)} ps`],
                                    ]
                                    if (analysis) {
                                      chips.push(['傳播速度', `${(analysis.velocity_m_s / 1e8).toFixed(3)}×10⁸ m/s`])
                                      chips.push(['空間解析度', `${Number(analysis.resolution_mm).toFixed(2)} mm`])
                                      if (analysis.effective_dk) chips.push(['等效 Dk', Number(analysis.effective_dk).toFixed(2)])
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
                              <div className="status" style={{ marginTop: 14 }}>
                                {tdrJob.phase}…　已耗時 {tdrJob.started_at
                                  ? Math.max(0, Math.round(nowTick - tdrJob.started_at))
                                  : 0} 秒（背景求解，可切換到其他分頁）
                              </div>
                            )}
                            {tdrJob?.status === 'error' && (
                              <div className="status status--warn" style={{ marginTop: 14 }}>
                                TDR 求解失敗：{tdrJob.error}
                              </div>
                            )}

                            {tdrJob?.status === 'done' && tdrJob.result && (() => {
                              const analyses = tdrJob.result.analyses || []
                              const analysis = analyses[tdrAnalysisIdx] || analyses[0]
                              if (!analysis) return null
                              const methodTag = analysis.method === 'group_delay' ? 'A'
                                : analysis.method === 'end_anchor' ? '錨' : 'B'
                              const peaks = (analysis.discontinuities || []).slice(0, 8)
                              const chartMarkers = tdrMarkers
                                ? tdrMarkers.map(m => ({
                                    distance_mm: m.distance_mm,
                                    label: (m.label || '').split('　')[0],
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
                                          {item.method === 'group_delay' ? 'A 法：群延遲'
                                            : item.method === 'end_anchor' ? '雙錨點（量測）'
                                              : 'B 法：疊構 Dk'}
                                        </button>
                                      ))}
                                      <span style={{ fontSize: 11, color: '#8fa1b5', marginLeft: 6 }}>
                                        兩法並行：位置差距反映速度的不確定性
                                      </span>
                                    </div>
                                  )}
                                  {/* 警語流式排列：量測路一次會有三四條，逐條整寬
                                      疊起來會把下面的場景列擠塌。 */}
                                  {((tdrJob.result.warnings || []).length > 0 || tdrMapError) && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                      {(tdrJob.result.warnings || []).map((warning: string) => (
                                        <div key={warning} className="status status--warn"
                                          style={{ fontSize: 10.5, width: 'auto', padding: '2px 8px' }}>
                                          {warning}
                                        </div>
                                      ))}
                                      {tdrMapError && (
                                        <div className="status status--warn"
                                          style={{ fontSize: 10.5, width: 'auto', padding: '2px 8px' }}>
                                          Layout 標記映射失敗：{tdrMapError}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  <div style={{ display: 'flex', gap: 8, minHeight: 180, flex: 1 }}>
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
                                          }}>
                                            標記映射中…（或此分析沒有超過門檻的劇變）
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    <div style={{
                                      flex: 1, minWidth: 260, border: '1px solid #303a48',
                                      borderRadius: 8, background: '#131820',
                                      padding: 10, overflow: 'auto',
                                    }}>
                                      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>
                                        阻抗劇變（{analysis.method === 'end_anchor'
                                          ? '雙錨點法' : `${methodTag} 法`}，依反射強度排序）
                                      </div>
                                      {peaks.length === 0 ? (
                                        <div style={{ fontSize: 12, color: '#8fa1b5' }}>
                                          沒有超過門檻的阻抗劇變——這條通道的阻抗相當連續。
                                        </div>
                                      ) : (
                                        <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
                                          <thead>
                                            <tr style={{ color: '#9fb0c3', textAlign: 'left' }}>
                                              <th style={{ padding: '3px 6px' }}>#</th>
                                              <th style={{ padding: '3px 6px' }}>距離</th>
                                              <th style={{ padding: '3px 6px' }}>阻抗</th>
                                              <th style={{ padding: '3px 6px' }}>ΔZ</th>
                                              <th style={{ padding: '3px 6px' }}>|Γ|</th>
                                              {show.crosssection && (
                                                <th style={{ padding: '3px 6px' }}>截面</th>
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
                                                  <td style={{ padding: '4px 6px' }}>{peak.distance_mm.toFixed(1)} mm</td>
                                                  <td style={{ padding: '4px 6px' }}>{peak.impedance_ohm.toFixed(1)} Ω</td>
                                                  <td style={{ padding: '4px 6px' }}>{peak.delta_z_ohm > 0 ? '+' : ''}{peak.delta_z_ohm.toFixed(1)} Ω</td>
                                                  <td style={{ padding: '4px 6px' }}>{peak.reflection_mag.toFixed(3)}</td>
                                                  {show.crosssection && (
                                                    <td style={{ padding: '4px 6px' }}>
                                                      <button className="btn--mini"
                                                        disabled={xsFromTdrBusy || !tdrPath}
                                                        onClick={() => handleCutHere(
                                                          peak.distance_mm, `XS_${methodTag}${index + 1}`)}
                                                        title="在這個距離上生一條垂直於走線的切線，切到「截面阻抗」分頁">
                                                        取此處截面
                                                      </button>
                                                    </td>
                                                  )}
                                                </tr>
                                              )
                                            })}
                                          </tbody>
                                        </table>
                                      )}
                                      {tdrMarkers?.some(m => m.excluded) && (
                                        <div style={{ fontSize: 10.5, color: '#8fa1b5', marginTop: 6 }}>
                                          ⚠＝落在分段切面的排除區內——多半是接縫假象，不是板上真實的劇變。
                                        </div>
                                      )}
                                      {show.crosssection && tdrPath && (
                                        <div style={{
                                          marginTop: 10, paddingTop: 8,
                                          borderTop: '1px solid #232b36',
                                        }}>
                                          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                                            沿線取樣截面
                                          </div>
                                          <div style={{ fontSize: 10.5, color: '#8fa1b5', marginBottom: 6 }}>
                                            沿走線每隔一段取一條切線，做出 Z₀(x) 剖面。轉角會跳過。
                                          </div>
                                          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                                            <div style={{ flex: 1 }}>
                                              <div className="field-label">間距（mm）</div>
                                              <input aria-label="間距（mm）" className="input" style={{ height: 26 }}
                                                value={xsSampleSpacingMm}
                                                onChange={e => setXsSampleSpacingMm(e.target.value)} />
                                            </div>
                                            <div style={{ flex: 1 }}
                                              title="側向半寬，也就是二維模型的物理邊界。經驗值是導體到參考面高度的 10 倍。">
                                              <div className="field-label">側向半寬（µm）</div>
                                              <input aria-label="側向半寬（µm）" className="input" style={{ height: 26 }}
                                                value={xsHalfWidthUm}
                                                onChange={e => setXsHalfWidthUm(e.target.value)} />
                                            </div>
                                            <button className="btn" style={{ height: 26, whiteSpace: 'nowrap' }}
                                              disabled={xsFromTdrBusy}
                                              onClick={handleSampleAlongTrace}>
                                              {xsFromTdrBusy ? '產生中…' : '沿線取樣'}
                                            </button>
                                          </div>
                                          <div style={{ fontSize: 10.5, color: '#8fa1b5', marginTop: 4 }}>
                                            走線長 {Number(tdrPath.length_mm).toFixed(2)} mm，
                                            間距 {xsSampleSpacingMm} mm 約
                                            {' '}{Math.max(1, Math.round(Number(tdrPath.length_mm) / (Number(xsSampleSpacingMm) || 1)))} 條。
                                            切線會存進切線集，之後按「解全部已存」整批求解。
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div style={{ border: '1px solid #303a48', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                                    <TdrChart
                                      distanceMm={analysis.distance_mm || []}
                                      impedanceOhm={tdrJob.result.impedance_ohm || []}
                                      markers={chartMarkers}
                                      pathLengthMm={tdrJob.result.path_length_mm}
                                      xMaxMm={analysis.display_cap_mm ?? null}
                                      height={230} />
                                  </div>
                                  <div className="result-paths result-paths--center">
                                    <span>{tdrJob.result.source === 'measured_waveform'
                                      ? `量測波形：${tdrJob.result.csv_path}`
                                      : `Circuit 專案：${tdrJob.result.project_path}`}</span>
                                  </div>
                                </>
                              )
                            })()}
                            {!tdrJob?.running && tdrJob?.status !== 'done' && tdrJob?.status !== 'error' && (
                              <div className="status" style={{ marginTop: 14 }}>
                                尚未執行 TDR。請先完成「電路串接」後按「執行 TDR」。
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
                            <EvidenceBadges path={cascadeResult.output_path}
                              expectedPorts={cascadeResult.n_ports} dark />

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
                                <select aria-label="差異類型篩選" value={cleanupDiffKind} onChange={e => setCleanupDiffKind(e.target.value as 'all' | 'primitive' | 'via')}>
                                  <option value="all">全部差異</option>
                                  <option value="primitive">僅銅箔／走線</option>
                                  <option value="via">僅 Via</option>
                                </select>
                                <select aria-label="Layer 篩選" value={cleanupDiffLayer} onChange={e => setCleanupDiffLayer(e.target.value)}>
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
                        ) : activeView === 'crosssection' ? (
                          <div style={{
                            height: '100%', paddingTop: 34, display: 'flex', gap: 8,
                            minHeight: 0,
                          }}>
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
                                crossSectionMode={xsMode}
                                onCrossSectionModeChange={setXsMode}
                                crossSectionRegion={xsRegion}
                                crossSectionCut={xsCut}
                                onCrossSectionRegionDrawn={handleXsRegionDrawn}
                                onCrossSectionCutDrawn={handleXsCutDrawn}
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
                                  }}>
                                    求解結果
                                    {xsJob.running ? '（還在跑，先給已經解完的）' : ''}
                                  </div>
                                  <CrossSectionResults
                                    rows={xsJob.result.cuts}
                                    selected={xsResultIdx}
                                    onSelect={setXsResultIdx} />
                                </div>
                              )}
                              {xsCompare && (
                                <div style={{
                                  marginBottom: 12, paddingBottom: 12,
                                  borderBottom: '1px solid #27313d',
                                }}>
                                  <CrossSectionComparison
                                    result={xsCompare}
                                    tdrDistanceMm={
                                      tdrJob?.result?.analyses?.[tdrAnalysisIdx]?.distance_mm || []}
                                    tdrImpedanceOhm={tdrJob?.result?.impedance_ohm || []} />
                                </div>
                              )}
                              {xsScan ? (
                                <CrossSectionView
                                  scan={xsScan}
                                  roleOverrides={xsRoleOverrides}
                                  onRoleOverride={handleXsRoleOverride}
                                  busy={xsBusy} />
                              ) : (xsJob?.result?.cuts || []).length > 0 ? (
                                <div style={{ color: '#8fa1b5', fontSize: 12 }}>
                                  要再看一次截面本身，回左側面板按「掃描截面」。
                                </div>
                              ) : (
                                <div style={{ color: '#8fa1b5', fontSize: 12, lineHeight: 1.7 }}>
                                  <div style={{ fontWeight: 700, fontSize: 13, color: '#c9d5e2' }}>
                                    還沒有截面
                                  </div>
                                  <ol style={{ paddingLeft: 18, marginTop: 8 }}>
                                    <li>按左圖左上的「框工作範圍」，拉一個涵蓋走線與兩側參考面的矩形。</li>
                                    <li>按「拉切線」，在要看阻抗的位置點一下。切線方向由框的長邊決定。</li>
                                    <li>回左側面板按「掃描截面」。</li>
                                  </ol>
                                  {xsBusy && <div style={{ marginTop: 8 }}>掃描中…</div>}
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
                          showOnlySelected={layoutOnlySelectedNets}
                          onShowOnlySelectedChange={setLayoutOnlySelectedNets}
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
                          <div className="stage-empty">
                            <svg viewBox="0 0 48 48" aria-hidden="true">
                              <rect x="6.5" y="10.5" width="35" height="27" rx="2.5" />
                              <path d="M6.5 18.5h35M15.5 18.5v19M24 18.5v19M32.5 18.5v19" />
                            </svg>
                            <div>請先於左側載入電路板檔案</div>
                            <small>支援 .aedb／.brd／.tgz</small>
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
                              <div key={i} className="log-line" style={{ color: logColor(l) }}>{l}</div>
                            ))}
                            {logs.length === 0 && <div className="empty-hint">目前無日誌…</div>}
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
