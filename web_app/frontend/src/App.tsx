// PCB SI 3D 模擬分析工具 — 前端主程式
// 功能1：載入電路板 → 選擇訊號／參考網路 → 裁切設定 → Port 設定 → 執行裁切
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import Preview2D, { CleanupOverlay, CleanupRemovedGeometry, PreviewData, SegmentCutsInfo } from './components/Preview2D'
import SParamChart, { SParamSeries } from './components/SParamChart'
import CascadeSchematic, { CascadeGraph } from './components/CascadeSchematic'

const normalizeUserPath = (path: string): string => {
  let value = path.trim()
  const quotePairs = new Set(['""', "''", '“”', '‘’'])
  while (value.length >= 2 && quotePairs.has(value[0] + value[value.length - 1])) {
    value = value.slice(1, -1).trim()
  }
  return value
}

interface SegmentCut {
  arc_mm: number                    // 沿通道脊椎的弧長位置
  point_mm: [number, number]        // 刀中心
  tangent: [number, number]         // 通道局部走向（刀與其垂直）
  half_len_mm: number               // 刀半長
  valid: boolean
  crossing_count: number
  min_obstacle_mm: number | null
  worst_angle_deg: number | null
}

interface SegmentAnalysis {
  mode: string
  n_segments: number
  total_arc_mm: number
  spine_mm: number[][]
  cuts: SegmentCut[]
}

interface SegmentRunResult {
  metadata_path: string
  segments: { index: number; path: string; cut_ports: any[]; all_ports: string[] }[]
  cut_pairs: { cut_index: number; position_mm: number; pairs: string[][] }[]
  previews: (PreviewData | null)[]
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

type ViewMode = 'full' | 'cut' | 'cleanup' | 'segments' | 'schematic'
type CleanupCompareMode = 'side-by-side' | 'before' | 'after' | 'overlay'

interface ExtFileInfo {
  path: string
  name: string
  n_ports: number
  port_names: string[]
}

interface ExtConn { a_file: number; a_port: string; b_file: number; b_port: string }
interface ExtShort { file: number; ports: string[] }

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
  const [allNets, setAllNets] = useState<string[]>([])
  const [components, setComponents] = useState<ComponentInfo[]>([])

  // ── 網路選擇 ──
  const [signalNets, setSignalNets] = useState<string[]>([])
  const [refNets, setRefNets] = useState<string[]>([])
  const [filterText, setFilterText] = useState('')

  // ── 裁切與 Port 設定 ──
  const [expansionMm, setExpansionMm] = useState('2')
  const [extentType, setExtentType] = useState('ConvexHull')
  const [actualCutoutExtentType, setActualCutoutExtentType] = useState('')
  const [portType, setPortType] = useState('coax')
  const [checkedComps, setCheckedComps] = useState<Record<string, boolean>>({})
  const [cutoutJobId, setCutoutJobId] = useState('')
  const [cutoutStopping, setCutoutStopping] = useState(false)

  // ── 模擬設定 (HFSS 3D Layout) ──
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

  // ── N 段分割 (功能2) ──
  const [nSegments, setNSegments] = useState('3')
  const [segOutputDir, setSegOutputDir] = useState('')
  const [segAnalysis, setSegAnalysis] = useState<SegmentAnalysis | null>(null)
  const [segRun, setSegRun] = useState<SegmentRunResult | null>(null)
  const [activeSegIdx, setActiveSegIdx] = useState(0)
  // 直接匯入分段模式：跳過功能1 裁切，載入的檔案直接進行 N 段分割
  const [directSegmentMode, setDirectSegmentMode] = useState(false)

  // ── 排程模擬（功能2）──
  const [schedMetaPath, setSchedMetaPath] = useState('')
  const [schedStatus, setSchedStatus] = useState<any | null>(null)

  // ── 電路串接（功能3）──
  const [cascadeResult, setCascadeResult] = useState<any | null>(null)
  const [cascadeBusy, setCascadeBusy] = useState(false)
  const [cascPortA, setCascPortA] = useState('')
  const [cascPortB, setCascPortB] = useState('')
  const [cascSeries, setCascSeries] = useState<SParamSeries[]>([])
  const [cascadeMode, setCascadeMode] = useState<'tool' | 'external'>('tool')
  const [schematicGraph, setSchematicGraph] = useState<CascadeGraph | null>(null)
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

  // 是否可進行分段：功能1 裁切完成、或直接匯入分段模式已載入
  const canSegment = !!cutScene || (directSegmentMode && allNets.length > 0)

  // ── UI 狀態 ──
  const [logs, setLogs] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('處理中…')
  const [showLogs, setShowLogs] = useState(true)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const logBoxRef = useRef<HTMLDivElement | null>(null)
  const signalFileRef = useRef<HTMLInputElement | null>(null)

  // 新日誌進來時自動捲到最底；使用者往上捲閱讀時不打擾
  useEffect(() => {
    const box = logBoxRef.current
    if (!box) return
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60
    if (nearBottom) box.scrollTop = box.scrollHeight
  }, [logs])

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

  const handleBrowseInput = async () => {
    try {
      const data = await api('/api/browse_input')
      if (data.path) {
        setInputPath(data.path)
        setOutputPath(data.path.replace(/\.[^/.]+$/, '') + '_Cutout.aedb')
      }
    } catch (e) { console.error(e) }
  }

  const handleBrowseOutput = async () => {
    try {
      const data = await api('/api/browse_output')
      if (data.path) setOutputPath(data.path)
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
    setCleanupAnalysis(null)
    setCleanupBeforeScene(null)
    setCleanupAfterScene(null)
    setSegAnalysis(null)
    setSegRun(null)
    setActiveView('full')
    if (path) {
      setInputPath(path)
      setCleanupOutputPath(path.replace(/\.aedb$/i, '') + '_cleaned.aedb')
      if (!outputPath) setOutputPath(path.replace(/\.[^/.]+$/, '') + '_Cutout.aedb')
    }
  }

  const handleLoadFile = async () => {
    if (!inputPath) { alert('請輸入檔案路徑'); return }
    setLoadingMsg(directSegmentMode
      ? '載入檔案中（直接分段模式，跳過裁切）…'
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
      if (directSegmentMode) {
        // 直接分段模式：預設清理與分段輸出路徑，載入後可直接到步驟 7／8
        setCleanupOutputPath(normalized.replace(/\.aedb$/i, '') + '_cleaned.aedb')
        setSegOutputDir(normalized.replace(/\.aedb$/i, '') + '_segments')
      } else {
        setOutputPath(normalized.replace(/\.[^/.]+$/, '') + '_Cutout.aedb')
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
        output_path: outputPath,
        solution_freq: parseFloat(solutionFreq) || 25,
        sweep_type: sweepType,
        sweeps: sweeps,
        error_tolerance_pct: parseFloat(errorTolerance) || 0.1,
        max_passes: parseInt(maxPasses, 10) || 20,
        max_delta_s: parseFloat(maxDeltaS) || 0.02,
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
      if (actualExtent !== extentType) {
        setExtentType(actualExtent)
        alert(`所選 ${extentType} 無法完成，已安全回退為 ${actualExtent}。\n${data.fallback_reason || ''}`)
      }
      setActiveView('cut')
      setCleanupAnalysis(null)
      setCleanupBeforeScene(null)
      setCleanupAfterScene(null)
      setCleanupOutputPath(data.output_path.replace(/\.aedb$/i, '') + '_cleaned.aedb')
      // 功能2 狀態重置與預設輸出資料夾
      setSegAnalysis(null)
      setSegRun(null)
      setSegOutputDir(outputPath.replace(/\.aedb$/i, '') + '_segments')
    } catch (e) {
      alert('裁切失敗: ' + String(e))
    } finally {
      setCutoutJobId('')
      setCutoutStopping(false)
      setIsLoading(false)
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
    if (!canSegment) { alert('請先完成裁切，或以直接分段模式載入通道檔案'); return }
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
      })
      setCutScene(data.preview)
      setCleanupBeforeScene(beforeScene)
      setCleanupAfterScene(data.preview)
      setCleanupAnalysis(data)
      setCleanupCompareMode('overlay')
      setCleanupDiffKind('all')
      setCleanupDiffLayer('')
      setCleanupFocusRegion(null)
      setSegAnalysis(null)
      setSegRun(null)
      setSegOutputDir(data.output_path.replace(/\.aedb$/i, '') + '_segments')
      setActiveView('cleanup')
    } catch (e) {
      alert('Layout 清理失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  // ── 功能2：N 段分割 ───────────────────────────────────
  const handleSegmentAnalyze = async () => {
    const n = parseInt(nSegments, 10)
    if (!canSegment) { alert('請先執行功能1（裁切並建立 Port），或勾選「直接匯入分段」後載入檔案'); return }
    if (signalNets.length === 0) { alert('請先於步驟 2 選擇訊號網路'); return }
    if (!n || n < 2) { alert('分段數 N 必須大於等於 2'); return }
    setLoadingMsg('分析切割位置中…')
    setIsLoading(true)
    try {
      const data = await api('/api/segment/analyze', {
        n_segments: n,
        signal_nets: signalNets,
        clearance_mm: 0.5,
      })
      setSegAnalysis(data)
      setSegRun(null)
      setActiveView('segments')
    } catch (e) {
      alert('分段分析失敗: ' + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  // ── 排程模擬：啟動 / 停止 / 輪詢 ──────────────────────
  const handleScheduleStart = async () => {
    const metadataPath = normalizeUserPath(schedMetaPath)
    if (!metadataPath) { alert('請先執行 N 段分割，或輸入 segments.json 路徑'); return }
    setSchedMetaPath(metadataPath)
    try {
      const s = await api('/api/schedule/start', { metadata_path: metadataPath })
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

  // ── 功能3：電路串接 ───────────────────────────────────
  const CASC_COLORS = ['#00e5ff', '#7ee787', '#ff8c00', '#e040fb', '#ffd600', '#ff5252']

  const handleCascadeRun = async () => {
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

  // 排程執行中每 3 秒輪詢一次狀態
  useEffect(() => {
    if (!schedStatus?.running) return
    const t = window.setInterval(async () => {
      try {
        const s = await api('/api/schedule/status')
        setSchedStatus(s)
      } catch { /* 後端未啟動時忽略 */ }
    }, 3000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedStatus?.running])

  // 排程執行中每秒觸發重繪，讓「求解中」的段耗時平滑跳動（不打 API）
  useEffect(() => {
    if (!schedStatus?.running) return
    const t = window.setInterval(() => setNowTick(Date.now() / 1000), 1000)
    return () => window.clearInterval(t)
  }, [schedStatus?.running])

  const handleSegmentRun = async () => {
    if (!segAnalysis) { alert('請先分析切割位置'); return }
    if (!segOutputDir) { alert('請設定分段輸出資料夾'); return }
    if (segAnalysis.cuts.some(c => !c.valid)) {
      if (!confirm('部分切割位置不合法（可能切到過孔附近或斜切走線），仍要繼續執行嗎？')) return
    }
    setLoadingMsg(`執行 ${segAnalysis.cuts.length + 1} 段分割中，每段需要重新裁切，可能需要數分鐘…`)
    setIsLoading(true)
    try {
      const data = await api('/api/segment/run', {
        signal_nets: signalNets,
        reference_nets: refNets,
        cuts: segAnalysis.cuts.map(c => ({
          point_mm: c.point_mm,
          tangent: c.tangent,
          half_len_mm: c.half_len_mm,
          arc_mm: c.arc_mm,
        })),
        output_dir: segOutputDir,
      })
      setSegRun(data)
      setActiveSegIdx(-1)   // 執行完先顯示整體視圖（完整板 + 切割線），方便確認每段位置
      setActiveView('segments')
      setSchedMetaPath(data.metadata_path || '')
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
      { label: '執行裁切並建立 Port（功能1）', action: handleCutout, disabled: signalNets.length === 0 },
      { label: '分析 N 段切割位置（功能2）', action: handleSegmentAnalyze, disabled: !cutScene },
      { label: '執行 N 段分割（功能2）', action: handleSegmentRun, disabled: !segAnalysis },
      { label: 'S 參數串接（功能3，開發中）', action: () => {}, disabled: true },
    ],
    '檢視': [
      { label: showLogs ? '隱藏系統日誌' : '顯示系統日誌', action: () => setShowLogs(!showLogs) },
      { label: '完整 Layout', action: () => setActiveView('full') },
      { label: '裁切後 Layout', action: () => setActiveView('cut'), disabled: !cutScene },
      { label: '清理前後對比', action: () => setActiveView('cleanup'), disabled: !cleanupAfterScene },
    ],
    '說明': [
      { label: '關於本工具', action: () => alert('PCB SI 3D 模擬分析工具\n\n功能1：電路板裁切與 Port 自動建立\n功能2：N 段分割排程模擬（開發中）\n功能3：S 參數電路串接（開發中）\n\n此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供') },
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
  const sceneLabel = activeView === 'cut' ? '裁切後 Layout'
    : activeView === 'cleanup' ? 'Layout 清理前後對比'
    : activeView === 'schematic' ? '串接電路示意圖 · 黃點 = 短路節點（stripline T+B）· 虛線框 = 尚未解算'
    : activeView === 'segments'
      ? (segRun
          ? (isOverviewMode
              ? `整體 Layout（切割線，共 ${segRun.segments.length} 段）`
              : `第 ${activeSegIdx + 1} 段 Layout（共 ${segRun.segments.length} 段）`)
          : 'N 段分割預覽')
      : '完整電路板 Layout'
  // 切割線疊圖：執行前（!segRun，此時無論 activeSegIdx 是什麼都要顯示）
  // 或執行後切回「整體視圖」時都要顯示
  const segCutsOverlay: SegmentCutsInfo | null =
    activeView === 'segments' && segAnalysis && (!segRun || isOverviewMode)
      ? {
          cuts: segAnalysis.cuts.map(c => ({
            point: c.point_mm,
            tangent: c.tangent,
            half_len: c.half_len_mm,
            valid: c.valid,
          })),
          spine: segAnalysis.spine_mm,
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
  const formatBytes = (value: number) => {
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className="app-shell" onClick={() => setOpenMenu(null)}>
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
              {cutoutStopping ? '停止中…' : '停止裁切工作'}
            </button>
          )}
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

      {/* 選單列 */}
      <nav className="menubar" onClick={(e) => e.stopPropagation()}>
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
        <Allotment>
          {/* 左側：設定面板 */}
          <Allotment.Pane preferredSize={400} minSize={320}>
            <div style={{ paddingRight: 7, height: '100%' }}>
              <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%', gap: '12px', overflowY: 'auto' }}>

                {/* 步驟 1：輸入檔案 */}
                <div>
                  <h3 className="panel-title">1. 輸入檔案（.aedb / .brd / .tgz）</h3>
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
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12.5, cursor: 'pointer' }}
                    title="檔案已是通道範圍（例如先前裁切的結果）時，勾選此項可跳過步驟 3~6 的裁切，載入後可先清理 Layout 或直接進行 N 段分割。">
                    <input type="checkbox" checked={directSegmentMode}
                      onChange={e => setDirectSegmentMode(e.target.checked)} />
                    直接匯入分段（跳過裁切，直接進行 N 段分割）
                  </label>
                  <button className="btn--primary" onClick={handleLoadFile} style={{ marginTop: 6 }}>
                    {directSegmentMode ? '載入檔案（直接分段）' : '載入電路板'}
                  </button>
                </div>

                {/* 步驟 2：網路選擇 */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 220 }}>
                  <h3 className="panel-title">2. 選擇網路（Nets）</h3>
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

                {/* 步驟 3：裁切設定（直接分段模式不需要） */}
                <div style={directSegmentMode ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <h3 className="panel-title">3. 裁切設定</h3>
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
                        <option value="ConvexHull">凸包（ConvexHull）</option>
                        <option value="Bounding">矩形（Bounding Box）</option>
                      </select>
                    </div>
                  </div>
                  <div className="status" style={{ marginTop: 6, fontSize: 11.5 }}>
                    {actualCutoutExtentType
                      ? `上次實際裁切形狀：${actualCutoutExtentType === 'ConvexHull' ? '凸包（ConvexHull）' : '矩形（Bounding Box）'}`
                      : '實際裁切會遵照所選形狀；只有 PyEDB 明確失敗時才回退為矩形並通知。'}
                  </div>
                </div>

                {/* 步驟 4：Port 設定（直接分段模式不需要） */}
                <div style={directSegmentMode ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <h3 className="panel-title">4. Port 設定</h3>
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

                {/* 步驟 5：模擬設定（直接分段模式不需要） */}
                <div style={directSegmentMode ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <h3 className="panel-title">5. 模擬設定 (HFSS 3D Layout)</h3>
                  
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

                  {/* Adaptive Options */}
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

                {/* 步驟 6：輸出與執行（直接分段模式不需要） */}
                <div style={directSegmentMode ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <h3 className="panel-title">6. 輸出與執行</h3>
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
                    執行裁切並建立 Port
                  </button>
                </div>

                {/* 步驟 7：Layout 清理 */}
                <div style={{ opacity: canSegment ? 1 : 0.5 }}>
                  <h3 className="panel-title">7. Layout 清理</h3>
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
                      1）分析與紅框預覽
                    </button>
                  </div>
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
                    2）另存並執行{cleanupMode === 'em_field' ? '第二級清理' : '保守清理'}
                  </button>
                </div>

                {/* 步驟 8：N 段分割（功能2） */}
                <div style={{ opacity: canSegment ? 1 : 0.5 }}>
                  <h3 className="panel-title">8. N 段分割（功能2）</h3>
                  <p className="panel-hint">
                    將裁切後的板子分成 N 段，切面自動截斷走線並建立 Gap Port。
                    {directSegmentMode && <span style={{ color: 'var(--accent)' }}>（直接分段模式：已跳過裁切）</span>}
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'flex-end' }}>
                    <div style={{ width: 90 }}>
                      <div className="field-label">分段數 N</div>
                      <input type="number" className="input" min="2" max="10" step="1"
                        value={nSegments} onChange={e => setNSegments(e.target.value)} disabled={!canSegment} />
                    </div>
                    <button className="btn" style={{ flex: 1 }} onClick={handleSegmentAnalyze} disabled={!canSegment}>
                      1) 分析切割位置
                    </button>
                  </div>
                  {segAnalysis && (
                    <div className="status status--ok" style={{ marginTop: 6, fontSize: 11.5 }}>
                      通道弧長 {segAnalysis.total_arc_mm?.toFixed(1)}mm，切割線沿通道走向自動轉向：
                      {segAnalysis.cuts.map((c, i) => (
                        <span key={i} style={{ marginRight: 8, color: c.valid ? undefined : 'var(--danger)' }}>
                          #{i + 1} 弧長@{c.arc_mm.toFixed(1)}mm（{c.crossing_count} 交點
                          {c.worst_angle_deg !== null ? `，最差角度 ${c.worst_angle_deg.toFixed(1)}°` : ''}
                          {c.valid ? '' : '，不合法'}）
                        </span>
                      ))}
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
                    disabled={!segAnalysis}
                    style={{ marginTop: 6 }}
                  >
                    2) 執行 N 段分割
                  </button>
                  {segRun && (
                    <div className="status status--ok" style={{ marginTop: 6, fontSize: 11.5 }}>
                      已產生 {segRun.segments.length} 段，切面 Port 配對
                      {segRun.cut_pairs.reduce((a, c) => a + c.pairs.length, 0)} 組，
                      對應表 segments.json 已輸出。
                    </div>
                  )}
                </div>

                {/* 步驟 9：排程模擬（功能2） */}
                <div style={{ opacity: (schedMetaPath || segRun) ? 1 : 0.5 }}>
                  <h3 className="panel-title">9. 排程模擬</h3>
                  <p className="panel-hint">
                    依序求解各段（AEDT 非圖形化、佇列模式），每段完成即匯出 Touchstone
                    並寫回 segments.json 供功能3 串接。
                  </p>
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <input type="text" className="input" value={schedMetaPath}
                      onChange={e => setSchedMetaPath(e.target.value)}
                      onBlur={() => setSchedMetaPath(normalizeUserPath(schedMetaPath))}
                      placeholder="segments.json 路徑（執行分段後自動帶入）…" />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button
                      className="btn--primary"
                      style={{ flex: 2 }}
                      onClick={handleScheduleStart}
                      disabled={!schedMetaPath || schedStatus?.running}
                    >
                      {schedStatus?.running ? '排程執行中…' : '開始排程模擬'}
                    </button>
                    <button
                      className="btn"
                      style={{ flex: 1 }}
                      onClick={handleScheduleStop}
                      disabled={!schedStatus?.running}
                    >停止</button>
                  </div>
                  {schedStatus && schedStatus.jobs?.length > 0 && (
                    <div className="netlist" style={{ marginTop: 6, maxHeight: 130, overflowY: 'auto' }}>
                      {schedStatus.jobs.map((j: any) => {
                        const labels: Record<string, [string, string]> = {
                          pending: ['等待中', 'var(--faint)'],
                          running: ['求解中…', 'var(--accent)'],
                          done: ['完成', 'var(--ok)'],
                          failed: ['失敗', 'var(--danger)'],
                          skipped: ['已跳過', 'var(--warn)'],
                        }
                        const [txt, color] = labels[j.status] || [j.status, 'var(--muted)']
                        const elapsed = jobElapsedSec(j, nowTick)
                        return (
                          <div key={j.index} className="netlist__row" title={j.error || j.touchstone || ''}>
                            <span style={{ fontWeight: 700, minWidth: 42 }}>段 {j.index}</span>
                            <span style={{ color, fontWeight: 600, minWidth: 56 }}>{txt}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 68 }}>
                              {elapsed !== null ? formatElapsed(elapsed) : ''}
                            </span>
                            <span className="netlist__name" style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {j.status === 'done' && j.touchstone ? j.touchstone.split(/[\\/]/).pop()
                                : j.status === 'failed' ? (j.error || '') : ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 步驟 10：電路串接（功能3） */}
                <div>
                  <h3 className="panel-title">10. 電路串接（功能3）</h3>
                  <p className="panel-hint">
                    切面 Port 依配對表對接（Stripline 雙參考 Port 先短路成節點），
                    還原完整通道 S 參數。可先「預覽接線」看電路示意圖再執行。
                  </p>
                  {/* 模式切換 */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {([['tool', '本工具分段結果'], ['external', '外部 S 參數檔']] as const).map(([m, label]) => (
                      <button key={m} className="btn" onClick={() => setCascadeMode(m)}
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
                        disabled={!schedMetaPath || cascadeBusy}
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
                              onClick={handleExtRun} disabled={cascadeBusy || extConns.length === 0}>
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
                        <SParamChart series={cascSeries} />
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
                  className={'viewtab' + (activeView === 'cut' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('cut')}
                  disabled={!cutScene}
                >裁切後 Layout</button>
                <button
                  className={'viewtab' + (activeView === 'cleanup' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('cleanup')}
                  disabled={!cleanupAfterScene}
                >清理對比</button>
                <button
                  className={'viewtab' + (activeView === 'segments' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('segments')}
                  disabled={!segAnalysis && !segRun}
                >N 段分割</button>
                <button
                  className={'viewtab' + (activeView === 'schematic' ? ' viewtab--active' : '')}
                  onClick={() => setActiveView('schematic')}
                  disabled={!schematicGraph}
                >串接電路</button>
              </div>

              <div style={{ flex: 1, minHeight: 0 }}>
                <Allotment vertical>
                  {/* 2D 預覽 */}
                  <Allotment.Pane minSize={200}>
                    <div style={{ paddingBottom: showLogs ? 7 : 0, height: '100%' }}>
                      <div className="panel" style={{ overflow: 'hidden', position: 'relative', height: '100%', background: '#0c0e12', borderTopLeftRadius: 0 }}>
                        {activeView !== 'cleanup' && <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 1, fontSize: 12.5, fontWeight: 700, color: activeView === 'cut' ? '#7ee787' : '#9fb0c3', pointerEvents: 'none' }}>
                          {sceneLabel}
                          {scene?.preview_mode === 'coarse' ? ' · 大板快速預覽（實際 EDB 未簡化）' : ''}
                          {activeView !== 'schematic' ? ' · 左鍵平移、滾輪縮放 · 右側 ◀▶ 展開圖層面板' : ''}
                        </div>}
                        {activeView === 'cleanup' && cleanupBeforeScene && cleanupAfterScene ? (
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
                          segmentCuts={segCutsOverlay}
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

                        {!scene && activeView !== 'schematic' && (
                          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#5c677d', fontSize: 14, pointerEvents: 'none' }}>
                            請先於左側載入電路板檔案
                          </div>
                        )}
                      </div>
                    </div>
                  </Allotment.Pane>

                  {/* 日誌面板 */}
                  {showLogs && (
                    <Allotment.Pane preferredSize={190} minSize={90}>
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
                              <div key={i} style={{ color: /錯誤|失敗|error|fail/i.test(l) ? 'var(--danger)' : /警告|warn/i.test(l) ? 'var(--warn)' : undefined }}>{l}</div>
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
