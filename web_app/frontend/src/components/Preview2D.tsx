// 2D Layout 預覽（HTML5 Canvas，SIwave 風格）— 沿用 PCB_Simplifer_Toolkit 驗證過的渲染引擎
// 右側面板仿 SIwave 欄位設計：Layers / Components / Nets 分頁
//   Layers 欄位由左至右：Fill/Unfill All、Show/Hide All、Planes、Traces、Pads、Vias、Circuit Elements
import React, { useEffect, useRef, useState, useCallback } from 'react'

export interface PreviewData {
  layers: Record<string, any[]>
  layer_colors?: Record<string, number[]>
  layer_order?: string[]
  bounds: { min: [number, number]; max: [number, number] }
  preview_mode?: 'exact' | 'coarse'
  source_primitive_count?: number
  rendered_primitive_count?: number
}

export interface SegmentCutsInfo {
  direction: 'x' | 'y'
  positions_mm: number[]
  /** 依複雜度分段：逐刀各自帶軸向，一橫一豎可並存。有值時取代 positions_mm。 */
  cuts?: {
    direction: 'x' | 'y'
    position_mm: number
    quality_grade?: string
    region?: number
    /** 這把刀是使用者拖過的；自動位置留在 auto_position_mm 供對照。 */
    manual?: boolean
    auto_position_mm?: number | null
  }[]
  /** 依複雜度分段：每段是矩形而非帶狀，並帶上該段要用哪個求解器。 */
  segment_boxes?: {
    index: number
    bounds_mm: [number, number, number, number]
    solver: 'hfss' | 'siwave'
  }[]
  /** 偵測到的 3D 複雜區（換層 Via、元件端 launch 的聚集處）。 */
  complexity_regions?: {
    index: number
    bounds_mm: [number, number, number, number]
    feature_count: number
  }[]
  valids?: boolean[]
  region_solvers?: ('hfss' | 'siwave')[]
  region_scores?: number[]
  ideal_positions_mm?: number[]
  rejected_candidates?: {
    position_mm: number
    hard_blocked: boolean
    reasons: string[]
  }[]
  safety_overlay?: {
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
  } | null
}

/** TDR 阻抗劇變在 Layout 上的位置標記：一段解析度寬度的走線片段。 */
export interface TdrMarkerSpan {
  /** 沿走線的座標點（mm），已由後端依弧長裁出。 */
  points: [number, number][]
  distance_mm: number
  /** 位於切面接縫排除區內——接縫假象，不是板上真實的劇變。 */
  excluded: boolean
  /** 顯示用標籤（例如「A① 37.2mm」）。 */
  label?: string
}

export interface CleanupBox {
  x: number
  y: number
  w: number
  h: number
  kind: 'primitive' | 'via'
  net: string
  layer?: string
}

export interface CleanupOverlay {
  boxes: CleanupBox[]
  total: number
  truncated: boolean
}

export interface CleanupRemovedGeometry {
  layers: Record<string, any[]>
  total: number
  rendered: number
  truncated: boolean
}

/** 截面阻抗的互動模式。'region' 框工作範圍、'cut' 拉切線。 */
export type CrossSectionMode = 'none' | 'region' | 'cut'

/** 工作範圍：同時是注意力的範圍、切線可放置的區域，以及截面的側向截斷邊界。 */
export interface CrossSectionRegion {
  x0Mm: number
  y0Mm: number
  x1Mm: number
  y1Mm: number
}

/** 切線：軸向＋單一座標。斜向一律不允許——斜切會讓導體寬度看起來變寬。 */
export interface CrossSectionCut {
  axis: 'x' | 'y'
  coordinateMm: number
}

interface Preview2DProps {
  data: PreviewData | null
  fitKey?: string
  highlightNets?: string[]  // 已選訊號 + 參考網路（用於「只顯示選取網路」功能）
  signalNets?: string[]     // 訊號網路（綠色標記）
  refNets?: string[]        // 參考網路（藍色標記）
  expansionMm?: number      // 裁切擴張距離預覽（mm）
  extentType?: string       // 'ConvexHull' | 'Bounding' — 裁切形狀
  segmentCuts?: SegmentCutsInfo | null  // 功能2：N 段分割切割線
  showSegmentSafetyOverlay?: boolean // 功能2：是否顯示禁切區與被拒絕候選
  onSegmentSafetyOverlayChange?: (visible: boolean) => void
  showSolverRegionOverlay?: boolean // 混合求解：是否顯示每段 HFSS／SIwave 色塊
  onSolverRegionOverlayChange?: (visible: boolean) => void
  onSegmentRegionClick?: (zeroBasedIndex: number) => void
  /** 依複雜度分段：使用者把某把刀拖到新位置後回報（放開滑鼠才觸發一次）。
   *  給了這個 callback 才開放拖曳。 */
  onCutDrag?: (cutIndex: number, positionMm: number) => void
  cleanupOverlay?: CleanupOverlay | null // Layout 清理：預計移除物件紅框
  /** 「只顯示選取網路」由外部接管。給了就以它為準（受控），
   *  沒給就用元件自己的狀態。TDR 分頁靠這個跟著完整 Layout 一起篩。 */
  showOnlySelected?: boolean
  onShowOnlySelectedChange?: (value: boolean) => void
  layerPanelEnabled?: boolean // 比較模式可關閉側欄，保留更多畫布空間
  /** 側欄一開始是收合的。畫布本身就被右側結果面板分掉一半時（截面阻抗），
   *  展開的圖層面板會把剩下的畫布再吃掉一大塊。仍可用 ▶ 展開。 */
  layerPanelInitiallyOpen?: boolean
  removedGeometry?: CleanupRemovedGeometry | null // 清理時實際刪除的原始幾何
  dimBase?: boolean // 差異模式：壓暗未變更 Layout
  differenceKind?: 'all' | 'primitive' | 'via'
  differenceLayer?: string
  focusBounds?: { min: [number, number]; max: [number, number] } | null
  tdrMarkers?: TdrMarkerSpan[] | null // TDR 阻抗劇變位置標記（mm）
  /** 截面阻抗：目前的互動模式。'none' 時滑鼠行為與其他分頁完全相同。
   *  用模式按鈕而不是修飾鍵——修飾鍵沒有任何視覺提示，不看手冊就不會知道。 */
  crossSectionMode?: CrossSectionMode
  onCrossSectionModeChange?: (mode: CrossSectionMode) => void
  crossSectionRegion?: CrossSectionRegion | null
  crossSectionCut?: CrossSectionCut | null
  onCrossSectionRegionDrawn?: (region: CrossSectionRegion) => void
  onCrossSectionCutDrawn?: (cut: CrossSectionCut) => void
  estimatedCutoutBoundary?: number[][] | null // PyEDB 唯讀預檢外框（mm）
  actualCutoutBoundary?: number[][] | null // 正式裁切回傳外框（mm）
  showBoundaryDifferenceFill?: boolean // 正式裁切比對：是否顯示橘／藍／綠半透明差異填色
  onBoundaryDifferenceFillChange?: (visible: boolean) => void
  boundaryComparison?: {
    available: boolean
    within_tolerance: boolean
    tolerance_mm: number
    max_boundary_error_mm: number | null
    area_difference_percent: number | null
  } | null
}

// ── 顏色常數 ────────────────────────────────────────────────
const BG_COLOR   = '#0c0e12'
const BOARD_STROKE = '#4caf50'
const PORT_COLOR = '#ff5252'
const FALLBACK_PALETTE = [
  '#ff3b30', '#00e676', '#ffd600', '#00b0ff', '#e040fb',
  '#ff9100', '#18ffff', '#c6ff00', '#ff4081', '#7c4dff',
]

// ── 每層七欄顯示設定 ─────────────────────────────────────────
interface LayerMode {
  filled:     boolean  // Fill/Unfill All  — polygon 填充 or 空心
  visible:    boolean  // Show/Hide All    — 整層顯示
  planes:     boolean  // Planes           — polygon 圖元
  traces:     boolean  // Traces           — path 圖元
  pads:       boolean  // Pads             — 訊號層 circle 圖元
  vias:       boolean  // Vias             — Vias 層 circle 圖元
  components: boolean  // Circuit Elements — comp 圖元
}

// filled 預設關閉：銅箔平面實心填滿會蓋住底下的走線、Pad 與 Via，剛載入板子
// 時最需要看的就是那些。改成只畫外框，要看實心再自己開。其餘欄位維持開啟。
const DEFAULT_MODE: LayerMode = {
  filled: false, visible: true, planes: true,
  traces: true, pads: true, vias: true, components: true,
}

// ── 欄位定義 ─────────────────────────────────────────────────
interface ColDef {
  key: keyof LayerMode
  icon: string
  title: string
  headerBg?: string
}

const LAYER_COLS: ColDef[] = [
  { key: 'filled',     icon: '■',  title: 'Fill / Unfill All',   headerBg: 'rgba(255,215,0,0.15)' },
  { key: 'visible',    icon: '●',  title: 'Show / Hide All',     headerBg: 'rgba(255,255,255,0.06)' },
  { key: 'planes',     icon: '▣',  title: 'Planes（銅箔平面）',   headerBg: undefined },
  { key: 'traces',     icon: '≡',  title: 'Traces（走線）',       headerBg: undefined },
  { key: 'pads',       icon: '◉',  title: 'Pads（焊盤）',         headerBg: undefined },
  { key: 'vias',       icon: '◎',  title: 'Vias（過孔）',         headerBg: undefined },
  { key: 'components', icon: '⊞',  title: 'Circuit Elements（元件外框）', headerBg: undefined },
]

const COL_W = 26   // 每個欄位寬度（px）

// ── 主元件 ───────────────────────────────────────────────────
export default function Preview2D({
  data, fitKey,
  highlightNets = [], signalNets = [], refNets = [],
  expansionMm, extentType = 'Bounding',
  segmentCuts = null,
  showSegmentSafetyOverlay = true,
  onSegmentSafetyOverlayChange,
  showSolverRegionOverlay = true,
  onSolverRegionOverlayChange,
  onSegmentRegionClick,
  onCutDrag,
  cleanupOverlay = null,
  layerPanelEnabled = true,
  layerPanelInitiallyOpen = true,
  removedGeometry = null,
  dimBase = false,
  differenceKind = 'all',
  differenceLayer = '',
  focusBounds = null,
  tdrMarkers = null,
  estimatedCutoutBoundary = null,
  actualCutoutBoundary = null,
  showBoundaryDifferenceFill = true,
  onBoundaryDifferenceFillChange,
  boundaryComparison = null,
  crossSectionMode = 'none',
  onCrossSectionModeChange,
  crossSectionRegion = null,
  crossSectionCut = null,
  onCrossSectionRegionDrawn,
  onCrossSectionCutDrawn,
  showOnlySelected: showOnlySelectedProp,
  onShowOnlySelectedChange,
}: Preview2DProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // 拖曳中的暫時矩形（mm）。放開滑鼠才回報，拖曳過程只是預覽。
  const [drawingRegion, setDrawingRegion] =
    useState<CrossSectionRegion | null>(null)
  const regionAnchor = useRef<{ x: number; y: number } | null>(null)

  // Viewport
  const [transform,  setTransform]  = useState({ x: 0, y: 0, scale: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart,  setDragStart]  = useState({ x: 0, y: 0 })
  const mouseDownPoint = useRef({ x: 0, y: 0 })

  // 刀線拖曳：拖動時只有這條線跟著走，分段矩形要等後端重算才會對，
  // 因此拖動期間把矩形壓暗，表示「這是舊的」。
  const [draggingCut, setDraggingCut] =
    useState<{ index: number; positionMm: number } | null>(null)
  const [hoverCutAxis, setHoverCutAxis] = useState<number | null>(null)

  // 圖層顯示設定
  const [layerModes,   setLayerModes]   = useState<Record<string, LayerMode>>({})
  const [visibleComps, setVisibleComps] = useState<Record<string, boolean>>({})
  const [visibleNets,  setVisibleNets]  = useState<Record<string, boolean>>({})

  // 面板折疊
  const [panelOpen, setPanelOpen] = useState(layerPanelInitiallyOpen)

  // 分頁 / 搜尋
  const [activeTab,   setActiveTab]   = useState<'Layers' | 'Components' | 'Nets'>('Layers')
  const [compFilter,  setCompFilter]  = useState('')
  const [netFilter,   setNetFilter]   = useState('')

  // 「只顯示選取網路」模式。
  //
  // 這個狀態可以由外部接管：每個 Preview2D 是各自獨立的實例，各有一份
  // `visibleNets`，所以在完整 Layout 按下「只顯示選取網路」之後，切到 TDR
  // 分頁看到的仍然是整片板子——標記被其他銅箔蓋住。把開關提到 App 共用，
  // 兩邊就會一起變。沒給 `showOnlySelected` 時維持原本的各自為政。
  const [showOnlySelectedInner, setShowOnlySelectedInner] = useState(false)
  const showOnlySelected = showOnlySelectedProp ?? showOnlySelectedInner
  const setShowOnlySelected = (value: boolean) => {
    setShowOnlySelectedInner(value)
    onShowOnlySelectedChange?.(value)
  }

  // 資料載入時初始化
  useEffect(() => {
    if (!data?.layers) return
    const modes: Record<string, LayerMode> = {}
    const comps: Record<string, boolean>   = {}
    const nets:  Record<string, boolean>   = {}
    Object.keys(data.layers).forEach(layer => {
      modes[layer] = { ...DEFAULT_MODE }
      data.layers[layer].forEach(prim => {
        if (prim.kind === 'comp' && prim.name) comps[prim.name] = true
        if (prim.net)                           nets[prim.net]  = true
      })
    })
    setLayerModes(modes)
    setVisibleComps(comps)
    setVisibleNets(nets)
  }, [data])

  // ── 幾何 ──────────────────────────────────────────────────
  const computeContentBounds = useCallback((): { min:[number,number]; max:[number,number] } | null => {
    if (!data) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const exp = (x: number, y: number) => {
      if (x < minX) minX = x; if (y < minY) minY = y
      if (x > maxX) maxX = x; if (y > maxY) maxY = y
    }
    for (const prims of Object.values(data.layers)) {
      for (const p of prims) {
        if (p.kind === 'rect' || p.kind === 'comp') { exp(p.x, p.y); exp(p.x+p.w, p.y+p.h) }
        else if (p.kind === 'circle' || p.kind === 'port') { const r=p.r||0.5; exp(p.x-r,p.y-r); exp(p.x+r,p.y+r) }
        else if ((p.kind === 'polygon' || p.kind === 'path') && p.points) { for (const pt of p.points) exp(pt[0],pt[1]) }
      }
    }
    if (!isFinite(minX) || maxX-minX <= 0 || maxY-minY <= 0) return null

    // 板外的東西不該決定取景。這片板（EXSU-Q911）在板框下方 34 mm 處還有
    // 兩個物件，Fit All 為了框住它們把整片板縮成畫面的一半，SIwave 則是滿版
    // 顯示板子。內容框與板框取交集：裁切後內容比板小時照樣以內容為準（那正是
    // 這個函式存在的理由），板外的零星物件則不再把畫面撐開。
    const board = data.layers['Board']
    if (board && board.length) {
      let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity
      for (const p of board) {
        if (p.kind === 'rect') { bx1=Math.min(bx1,p.x); by1=Math.min(by1,p.y); bx2=Math.max(bx2,p.x+p.w); by2=Math.max(by2,p.y+p.h) }
        else if (p.points) for (const pt of p.points) { bx1=Math.min(bx1,pt[0]); by1=Math.min(by1,pt[1]); bx2=Math.max(bx2,pt[0]); by2=Math.max(by2,pt[1]) }
      }
      const cx1 = Math.max(minX, bx1), cy1 = Math.max(minY, by1)
      const cx2 = Math.min(maxX, bx2), cy2 = Math.min(maxY, by2)
      if (isFinite(cx1) && cx2 - cx1 > 0 && cy2 - cy1 > 0) {
        return { min:[cx1,cy1], max:[cx2,cy2] }
      }
    }
    return { min:[minX,minY], max:[maxX,maxY] }
  }, [data])

  const fitView = useCallback(() => {
    if (!data || !containerRef.current) return
    const { min, max } = computeContentBounds() || data.bounds
    const cW = max[0]-min[0], cH = max[1]-min[1]
    if (cW <= 0 || cH <= 0) return
    const w = containerRef.current.clientWidth
    const h = containerRef.current.clientHeight
    const s = Math.min(w*0.85/cW, h*0.85/cH)
    const cx = (min[0]+max[0])/2, cy = (min[1]+max[1])/2
    setTransform({ x: w/2 - cx*s, y: -h/2 + cy*s, scale: s })
  }, [data, computeContentBounds])

  useEffect(() => { fitView() }, [data, fitKey, fitView])

  useEffect(() => {
    if (!focusBounds || !containerRef.current) return
    const cW = focusBounds.max[0] - focusBounds.min[0]
    const cH = focusBounds.max[1] - focusBounds.min[1]
    if (cW <= 0 || cH <= 0) return
    const w = containerRef.current.clientWidth
    const h = containerRef.current.clientHeight
    const paddedW = Math.max(cW, 1)
    const paddedH = Math.max(cH, 1)
    const scale = Math.min(w * 0.65 / paddedW, h * 0.65 / paddedH)
    const cx = (focusBounds.min[0] + focusBounds.max[0]) / 2
    const cy = (focusBounds.min[1] + focusBounds.max[1]) / 2
    setTransform({ x: w / 2 - cx * scale, y: -h / 2 + cy * scale, scale })
  }, [focusBounds])

  // ── 顏色 ──────────────────────────────────────────────────
  const getLayerColor = useCallback((layer: string): string => {
    if (layer === 'Board')      return BOARD_STROKE
    if (layer === 'Vias')       return '#cfd8dc'
    if (layer === 'Components') return '#90caf9'
    if (layer === 'Ports')      return PORT_COLOR
    const ec = data?.layer_colors?.[layer]
    if (ec && ec.length >= 3) return `rgb(${ec[0]},${ec[1]},${ec[2]})`
    let h = 0; for (let i=0;i<layer.length;i++) h=(h*31+layer.charCodeAt(i))>>>0
    return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length]
  }, [data])

  const getStackupLayers = useCallback((): string[] => {
    if (!data) return []
    const inData = Object.keys(data.layers).filter(
      l => l !== 'Board' && l !== 'Vias' && l !== 'Components' && l !== 'Ports'
    )
    const ordered = data.layer_order || []
    return [...ordered, ...inData.filter(l => !ordered.includes(l))]
  }, [data])

  // ── 繪圖 ──────────────────────────────────────────────────
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const cont   = containerRef.current
    if (!canvas || !cont) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr  = window.devicePixelRatio || 1
    const rect = cont.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    canvas.width  = rect.width  * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    canvas.style.width  = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, rect.width, rect.height)
    if (!data) return

    ctx.save()
    ctx.translate(transform.x, transform.y + rect.height)
    ctx.scale(transform.scale, -transform.scale)
    const px = (n: number) => n / transform.scale

    // ── 標籤佔位：畫過的地方不再畫第二個 ──────────────────
    // Port 名稱是逐個畫上去的，密集處會疊成無法閱讀的一團。這裡在螢幕座標
    // 上記下每個已畫標籤佔的矩形，之後要畫的若與任何一個重疊就跳過。效果是
    // 縮得很小時只看到零星幾個名字（或一個都沒有），放大到有空間時才逐一
    // 浮現——而不是永遠糊成一片。
    const labelBoxes: number[][] = []
    const claimLabelBox = (worldX: number, worldY: number, text: string) => {
      const screenX = worldX * transform.scale + transform.x
      const screenY = rect.height + transform.y - worldY * transform.scale
      // 11px 字約 6.2px 寬；不必精準，只要能反映佔用範圍。
      const w = text.length * 6.2
      const h = 12
      const box = [screenX, screenY - h / 2, screenX + w, screenY + h / 2]
      // 畫布外的直接跳過，省得白算。
      if (box[2] < 0 || box[0] > rect.width
        || box[3] < 0 || box[1] > rect.height) return false
      for (const other of labelBoxes) {
        if (box[0] < other[2] && other[0] < box[2]
          && box[1] < other[3] && other[1] < box[3]) return false
      }
      labelBoxes.push(box)
      return true
    }

    const tracePoly = (pts: number[][], holes?: number[][][]) => {
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1])
      ctx.closePath()
      holes?.forEach(hole => {
        if (hole.length < 3) return
        ctx.moveTo(hole[0][0], hole[0][1])
        for (let i=1;i<hole.length;i++) ctx.lineTo(hole[i][0], hole[i][1])
        ctx.closePath()
      })
    }

    const stackup    = getStackupLayers()
    const layerOrder = ['Board', ...[...stackup].reverse(), 'Components', 'Vias', 'Ports']

    for (const layerName of layerOrder) {
      if (!data.layers[layerName]) continue
      const mode  = layerModes[layerName] || DEFAULT_MODE
      if (!mode.visible) continue            // Show/Hide All

      const prims = data.layers[layerName]
      const color = getLayerColor(layerName)
      const isViasLayer = layerName === 'Vias'

      ctx.fillStyle   = color
      ctx.strokeStyle = color
      ctx.lineJoin    = 'round'
      ctx.lineCap     = 'round'

      prims.forEach(prim => {
        // Components tab 過濾
        if (prim.kind === 'comp' && prim.name && visibleComps[prim.name] === false) return
        // Nets tab 過濾
        if (prim.net && visibleNets[prim.net] === false) return

        // ── 各欄位過濾 ──
        if (prim.kind === 'polygon' && !mode.planes)     return
        if (prim.kind === 'path'    && !mode.traces)     return
        if (prim.kind === 'circle') {
          if (isViasLayer && !mode.vias)                 return
          if (!isViasLayer && !mode.pads)                return
        }
        if (prim.kind === 'comp'    && !mode.components) return

        // ── 板框 ──
        // 後端拿得到真實外框時送的是 polygon（可能帶挖空），拿不到才退回
        // bounding box 的 rect。兩種都只描一圈線、板內不填色——SIwave 就是
        // 這樣畫的，而且真實外框的缺角本身就說明了板子的形狀，再鋪一層底色
        // 只會把上面的銅箔一起染綠。
        if (layerName === 'Board') {
          ctx.strokeStyle = BOARD_STROKE
          ctx.lineWidth   = px(1.6)
          if (prim.kind === 'rect') {
            ctx.strokeRect(prim.x, prim.y, prim.w, prim.h)
          } else if (prim.kind === 'polygon' && prim.points && prim.points.length >= 3) {
            tracePoly(prim.points, prim.holes)
            ctx.stroke()
          } else if (prim.kind === 'path' && prim.points && prim.points.length >= 2) {
            ctx.beginPath()
            ctx.moveTo(prim.points[0][0], prim.points[0][1])
            for (let i=1;i<prim.points.length;i++) ctx.lineTo(prim.points[i][0], prim.points[i][1])
            ctx.stroke()
          }
          ctx.fillStyle   = color
          ctx.strokeStyle = color
          return
        }

        // ── polygon（受 Fill/Unfill 影響） ──
        if (prim.kind === 'polygon') {
          const pts = prim.points
          if (!pts || pts.length < 3) return
          if (mode.filled) {
            ctx.globalAlpha = 0.85
            tracePoly(pts, prim.holes)
            ctx.fill('evenodd')
          } else {
            ctx.globalAlpha = 0.9
            ctx.lineWidth   = px(0.8)
            tracePoly(pts, prim.holes)
            ctx.stroke()
          }
          ctx.globalAlpha = 1.0

        } else if (prim.kind === 'path') {
          const pts = prim.points
          if (!pts || pts.length < 2) return
          ctx.globalAlpha = 0.95
          ctx.lineWidth   = Math.max(prim.width || 0.1, px(0.75))
          ctx.beginPath()
          ctx.moveTo(pts[0][0], pts[0][1])
          for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1])
          ctx.stroke()
          ctx.globalAlpha = 1.0

        } else if (prim.kind === 'rect') {
          // rect 是「讀不到頂點」時的退路，語意上仍是一塊銅箔，所以跟 polygon
          // 一樣受 Fill/Unfill 管。舊版無視這一欄一律實心：只要有一塊銅箔退回
          // bbox，整片板就被那個矩形塗滿，而使用者關掉 Fill 也救不回來。
          if (mode.filled) {
            ctx.globalAlpha = 0.8
            ctx.fillRect(prim.x, prim.y, prim.w, prim.h)
          } else {
            ctx.globalAlpha = 0.9
            ctx.lineWidth   = px(0.8)
            ctx.strokeRect(prim.x, prim.y, prim.w, prim.h)
          }
          ctx.globalAlpha = 1.0

        } else if (prim.kind === 'comp') {
          ctx.globalAlpha = 0.9
          ctx.lineWidth   = px(1)
          ctx.strokeRect(prim.x, prim.y, prim.w, prim.h)
          ctx.globalAlpha = 0.15
          ctx.fillRect(prim.x, prim.y, prim.w, prim.h)
          ctx.globalAlpha = 1.0

        } else if (prim.kind === 'circle') {
          ctx.beginPath()
          ctx.arc(prim.x, prim.y, Math.max(prim.r, px(1)), 0, 2*Math.PI)
          ctx.fill()
          if (prim.r > px(3)) {
            ctx.fillStyle = BG_COLOR
            ctx.beginPath()
            ctx.arc(prim.x, prim.y, prim.r*0.45, 0, 2*Math.PI)
            ctx.fill()
            ctx.fillStyle = color
          }
        } else if (prim.kind === 'port') {
          const r = px(6)
          ctx.lineWidth = px(1.6)
          ctx.beginPath(); ctx.arc(prim.x, prim.y, r, 0, 2*Math.PI); ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(prim.x-r*1.7, prim.y); ctx.lineTo(prim.x+r*1.7, prim.y)
          ctx.moveTo(prim.x, prim.y-r*1.7); ctx.lineTo(prim.x, prim.y+r*1.7)
          ctx.stroke()
          // 只在標籤真的看得清楚時才畫。BGA 底下擠著幾十個元件端 Port，
          // 每個都畫名字會疊成一團紅色糊塊——那比不畫還糟，既讀不到任何一個
          // 名字，還會蓋住底下的 Layout。縮放進去看得到間距時自然就會出現。
          if (prim.name && claimLabelBox(prim.x + r * 2.0, prim.y, prim.name)) {
            ctx.save()
            ctx.translate(prim.x+r*2.0, prim.y)
            ctx.scale(1/transform.scale, -1/transform.scale)
            ctx.font = '11px "Calibri","Microsoft JhengHei",sans-serif'
            ctx.fillStyle = PORT_COLOR
            ctx.fillText(prim.name, 0, 4)
            ctx.restore()
          }
        }
      })
    }
    ctx.restore()

    // 差異模式先壓暗所有未變更內容，再把被刪除的原始幾何高亮畫回來。
    if (dimBase) {
      ctx.fillStyle = 'rgba(4, 7, 11, 0.72)'
      ctx.fillRect(0, 0, rect.width, rect.height)
    }

    if (removedGeometry && Object.keys(removedGeometry.layers).length > 0) {
      ctx.save()
      ctx.translate(transform.x, transform.y + rect.height)
      ctx.scale(transform.scale, -transform.scale)
      const px2 = (n: number) => n / transform.scale
      for (const [layer, geometries] of Object.entries(removedGeometry.layers)) {
        if (differenceLayer && layer !== differenceLayer) continue
        const isViaLayer = layer === 'Vias'
        for (const prim of geometries) {
          if (differenceKind === 'via' && !isViaLayer) continue
          if (differenceKind === 'primitive' && isViaLayer) continue
          ctx.fillStyle = isViaLayer ? 'rgba(255, 166, 0, 0.98)' : 'rgba(255, 45, 70, 0.90)'
          ctx.strokeStyle = isViaLayer ? '#ffd166' : '#ff6b81'
          ctx.shadowColor = isViaLayer ? '#ff9f1c' : '#ff1744'
          ctx.shadowBlur = px2(6)
          if (prim.kind === 'polygon' && prim.points?.length >= 3) {
            tracePoly(prim.points, prim.holes)
            ctx.fill('evenodd')
            ctx.lineWidth = px2(1.2); ctx.stroke()
          } else if (prim.kind === 'path' && prim.points?.length >= 2) {
            ctx.lineWidth = Math.max(prim.width || 0.1, px2(2.2))
            ctx.beginPath(); ctx.moveTo(prim.points[0][0], prim.points[0][1])
            for (let i = 1; i < prim.points.length; i++) ctx.lineTo(prim.points[i][0], prim.points[i][1])
            ctx.stroke()
          } else if (prim.kind === 'circle') {
            ctx.beginPath(); ctx.arc(prim.x, prim.y, Math.max(prim.r || 0.15, px2(2.5)), 0, Math.PI * 2)
            ctx.fill(); ctx.lineWidth = px2(1); ctx.stroke()
          } else if (prim.kind === 'rect') {
            ctx.fillRect(prim.x, prim.y, prim.w, prim.h)
            ctx.lineWidth = px2(1); ctx.strokeRect(prim.x, prim.y, prim.w, prim.h)
          }
          ctx.shadowBlur = 0
        }
      }
      ctx.restore()
    }

    // ── Layout 清理候選：紅色半透明框（僅預覽，不代表已刪除）────
    if (cleanupOverlay && cleanupOverlay.boxes.length > 0) {
      ctx.save()
      ctx.translate(transform.x, transform.y + rect.height)
      ctx.scale(transform.scale, -transform.scale)
      const px2 = (n: number) => n / transform.scale
      ctx.strokeStyle = 'rgba(255, 82, 82, 0.92)'
      ctx.fillStyle = 'rgba(255, 82, 82, 0.16)'
      ctx.lineWidth = px2(1.2)
      cleanupOverlay.boxes.forEach(box => {
        const minSize = px2(box.kind === 'via' ? 5 : 2)
        const w = Math.max(box.w, minSize)
        const h = Math.max(box.h, minSize)
        const x = box.x - (w - box.w) / 2
        const y = box.y - (h - box.h) / 2
        ctx.fillRect(x, y, w, h)
        ctx.strokeRect(x, y, w, h)
        if (box.kind === 'via') {
          ctx.beginPath()
          ctx.moveTo(x, y); ctx.lineTo(x + w, y + h)
          ctx.moveTo(x + w, y); ctx.lineTo(x, y + h)
          ctx.stroke()
        }
      })
      ctx.restore()
    }

    // ── 功能2：禁切外框、理想位置、拒絕候選與選定切面 ───────
    if (segmentCuts && segmentCuts.positions_mm.length > 0) {
      const contentBounds = computeContentBounds() || data.bounds
      const axis = segmentCuts.direction === 'x' ? 0 : 1
      ctx.save()
      ctx.translate(transform.x, transform.y + rect.height)
      ctx.scale(transform.scale, -transform.scale)
      const px2 = (n: number) => n / transform.scale

      const regionEdges = [
        contentBounds.min[axis],
        ...segmentCuts.positions_mm,
        contentBounds.max[axis],
      ]
      // 拖曳中的那把刀跟著游標走，其餘維持原位。
      const liveCuts = (segmentCuts.cuts || []).map((cut, index) => (
        draggingCut && draggingCut.index === index
          ? { ...cut, position_mm: draggingCut.positionMm }
          : cut
      ))
      // 依複雜度分段的每一段是矩形（混合軸向時垂直方向也被收緊），
      // 不能再用「起訖座標 × 整個垂直範圍」的帶狀畫法。
      if (showSolverRegionOverlay && segmentCuts.segment_boxes?.length) {
        // 拖曳中矩形還是舊的邊界，壓暗表示待重算，不要讓人以為已經跟上。
        ctx.globalAlpha = draggingCut ? 0.35 : 1
        segmentCuts.segment_boxes.forEach(segment => {
          const [x0, y0, x1, y1] = segment.bounds_mm
          ctx.fillStyle = segment.solver === 'siwave'
            ? 'rgba(46, 204, 113, 0.14)'
            : 'rgba(126, 87, 194, 0.16)'
          ctx.strokeStyle = segment.solver === 'siwave'
            ? 'rgba(76, 230, 137, 0.72)'
            : 'rgba(166, 126, 255, 0.78)'
          ctx.lineWidth = px2(1.2)
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
        })
        ctx.globalAlpha = 1
      } else if (showSolverRegionOverlay && segmentCuts.region_solvers?.length) {
        regionEdges.slice(0, -1).forEach((start, index) => {
          const end = regionEdges[index + 1]
          const solver = segmentCuts.region_solvers?.[index] || 'hfss'
          ctx.fillStyle = solver === 'siwave'
            ? 'rgba(46, 204, 113, 0.14)'
            : 'rgba(126, 87, 194, 0.16)'
          ctx.strokeStyle = solver === 'siwave'
            ? 'rgba(76, 230, 137, 0.72)'
            : 'rgba(166, 126, 255, 0.78)'
          ctx.lineWidth = px2(1.2)
          if (axis === 0) {
            ctx.fillRect(
              start, contentBounds.min[1], end - start,
              contentBounds.max[1] - contentBounds.min[1],
            )
            ctx.strokeRect(
              start, contentBounds.min[1], end - start,
              contentBounds.max[1] - contentBounds.min[1],
            )
          } else {
            ctx.fillRect(
              contentBounds.min[0], start,
              contentBounds.max[0] - contentBounds.min[0], end - start,
            )
            ctx.strokeRect(
              contentBounds.min[0], start,
              contentBounds.max[0] - contentBounds.min[0], end - start,
            )
          }
        })
      }

      if (showSegmentSafetyOverlay && segmentCuts.safety_overlay) {
        segmentCuts.safety_overlay.items.forEach(item => {
          if (item.kind === 'angled_trace' && item.points_mm && item.points_mm.length >= 2) {
            ctx.save()
            ctx.beginPath()
            item.points_mm.forEach((point, index) => {
              if (index === 0) ctx.moveTo(point[0], point[1])
              else ctx.lineTo(point[0], point[1])
            })
            ctx.strokeStyle = 'rgba(255, 145, 0, 0.27)'
            ctx.lineWidth = Math.max(item.width_mm || 0, px2(8))
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.stroke()
            ctx.strokeStyle = 'rgba(255, 183, 77, 0.92)'
            ctx.lineWidth = Math.max(item.width_mm || 0, px2(1.5))
            ctx.stroke()
            ctx.restore()
            return
          }
          const [xmin, ymin, xmax, ymax] = item.bounds_mm
          const width = Math.max(xmax - xmin, px2(2))
          const height = Math.max(ymax - ymin, px2(2))
          const x = xmin - (width - (xmax - xmin)) / 2
          const y = ymin - (height - (ymax - ymin)) / 2
          const hard = item.severity === 'hard'
          ctx.fillStyle = hard ? 'rgba(255, 55, 75, 0.17)' : 'rgba(255, 166, 0, 0.14)'
          ctx.strokeStyle = hard ? 'rgba(255, 82, 82, 0.72)' : 'rgba(255, 183, 77, 0.72)'
          ctx.lineWidth = px2(0.9)
          ctx.fillRect(x, y, width, height)
          ctx.strokeRect(x, y, width, height)
        })

        ctx.lineWidth = px2(1)
        ctx.setLineDash([px2(3), px2(5)])
        ctx.strokeStyle = 'rgba(255, 82, 82, 0.22)'
        ;(segmentCuts.rejected_candidates || []).forEach(candidate => {
          ctx.beginPath()
          if (axis === 0) {
            ctx.moveTo(candidate.position_mm, contentBounds.min[1])
            ctx.lineTo(candidate.position_mm, contentBounds.max[1])
          } else {
            ctx.moveTo(contentBounds.min[0], candidate.position_mm)
            ctx.lineTo(contentBounds.max[0], candidate.position_mm)
          }
          ctx.stroke()
        })
        ctx.setLineDash([])
      }

      // 灰色虛線＝未考慮障礙時的理想等分位置。
      ctx.strokeStyle = 'rgba(180, 190, 204, 0.58)'
      ctx.lineWidth = px2(1.1)
      ctx.setLineDash([px2(5), px2(5)])
      ;(segmentCuts.ideal_positions_mm || []).forEach(position => {
        ctx.beginPath()
        if (axis === 0) {
          ctx.moveTo(position, contentBounds.min[1])
          ctx.lineTo(position, contentBounds.max[1])
        } else {
          ctx.moveTo(contentBounds.min[0], position)
          ctx.lineTo(contentBounds.max[0], position)
        }
        ctx.stroke()
      })
      ctx.setLineDash([])

      // 3D 複雜區：橘色虛線框，標出「為什麼刀下在這裡」
      ;(segmentCuts.complexity_regions || []).forEach(region => {
        const [x0, y0, x1, y1] = region.bounds_mm
        ctx.strokeStyle = 'rgba(232, 163, 58, 0.9)'
        ctx.lineWidth = px2(1.6)
        ctx.setLineDash([px2(6), px2(4)])
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
        ctx.setLineDash([])
      })

      const drawCut = (position: number, cutAxis: number, ok: boolean) => {
        ctx.strokeStyle = ok ? '#00e5ff' : '#ff5252'
        ctx.lineWidth = px2(2.2)
        ctx.setLineDash(ok ? [] : [px2(9), px2(6)])
        ctx.beginPath()
        if (cutAxis === 0) {
          ctx.moveTo(position, contentBounds.min[1])
          ctx.lineTo(position, contentBounds.max[1])
        } else {
          ctx.moveTo(contentBounds.min[0], position)
          ctx.lineTo(contentBounds.max[0], position)
        }
        ctx.stroke()
      }

      if (liveCuts.length) {
        // 依複雜度分段：一橫一豎可並存，每把刀用自己的軸向。
        liveCuts.forEach((cut, index) => {
          const cutAxis = cut.direction === 'x' ? 0 : 1
          // 自動位置留一條灰虛線當參考，才知道自己拖多遠了。
          const auto = cut.auto_position_mm
          if (auto !== null && auto !== undefined) {
            ctx.strokeStyle = 'rgba(180, 190, 204, 0.5)'
            ctx.lineWidth = px2(1.1)
            ctx.setLineDash([px2(5), px2(5)])
            ctx.beginPath()
            if (cutAxis === 0) {
              ctx.moveTo(auto, contentBounds.min[1])
              ctx.lineTo(auto, contentBounds.max[1])
            } else {
              ctx.moveTo(contentBounds.min[0], auto)
              ctx.lineTo(contentBounds.max[0], auto)
            }
            ctx.stroke()
            ctx.setLineDash([])
          }
          drawCut(cut.position_mm, cutAxis, true)
          // 拖曳中的那把刀加粗，讓人確定抓到的是哪一條。
          if (draggingCut?.index === index) {
            ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)'
            ctx.lineWidth = px2(9)
            ctx.beginPath()
            if (cutAxis === 0) {
              ctx.moveTo(cut.position_mm, contentBounds.min[1])
              ctx.lineTo(cut.position_mm, contentBounds.max[1])
            } else {
              ctx.moveTo(contentBounds.min[0], cut.position_mm)
              ctx.lineTo(contentBounds.max[0], cut.position_mm)
            }
            ctx.stroke()
          }
        })
      } else {
        segmentCuts.positions_mm.forEach((position, index) => {
          const ok = !segmentCuts.valids || segmentCuts.valids[index] !== false
          drawCut(position, axis, ok)
        })
      }
      ctx.setLineDash([])

      if (segmentCuts.segment_boxes?.length) {
        ctx.globalAlpha = draggingCut ? 0.35 : 1
        segmentCuts.segment_boxes.forEach(segment => {
          const [x0, y0, x1, y1] = segment.bounds_mm
          ctx.save()
          ctx.translate((x0 + x1) / 2, (y0 + y1) / 2)
          ctx.scale(1 / transform.scale, -1 / transform.scale)
          ctx.font = 'bold 12px "Calibri","Microsoft JhengHei",sans-serif'
          ctx.fillStyle = segment.solver === 'siwave'
            ? 'rgba(91, 245, 154, 0.98)'
            : 'rgba(190, 160, 255, 0.98)'
          ctx.fillText(
            `S${segment.index} ${segment.solver.toUpperCase()}`, -22, -6)
          ctx.restore()
        })
        ctx.globalAlpha = 1
        ctx.restore()
        return
      }

      const edges = regionEdges
      for (let index = 0; index + 1 < edges.length; index++) {
        const center = (edges[index] + edges[index + 1]) / 2
        const labelX = axis === 0 ? center : contentBounds.max[0]
        const labelY = axis === 0 ? contentBounds.max[1] : center
        ctx.save()
        ctx.translate(labelX, labelY)
        ctx.scale(1 / transform.scale, -1 / transform.scale)
        ctx.font = 'bold 12px "Calibri","Microsoft JhengHei",sans-serif'
        const regionSolver = segmentCuts.region_solvers?.[index]
        const regionScore = segmentCuts.region_scores?.[index]
        ctx.fillStyle = regionSolver === 'siwave'
          ? 'rgba(91, 245, 154, 0.98)'
          : regionSolver === 'hfss'
            ? 'rgba(190, 160, 255, 0.98)'
            : 'rgba(0, 229, 255, 0.95)'
        const suffix = regionSolver
          ? ` ${regionSolver.toUpperCase()}${Number.isFinite(regionScore) ? ` · ${regionScore}` : ''}`
          : ''
        ctx.fillText(`S${index + 1}${suffix}`, -8, -8)
        ctx.restore()
      }
      ctx.restore()
    }

    // ── TDR 阻抗劇變位置標記 ─────────────────────────
    // 每個標記是一段「解析度寬度」的走線片段而不是一個點——TDR 的空間解析度
    // 是物理極限（v·Tr/2），畫成點會暗示不存在的精度。
    // ── 截面阻抗：工作範圍與切線 ─────────────────────────────
    const shownRegion = drawingRegion || crossSectionRegion
    if (shownRegion) {
      ctx.save()
      ctx.translate(transform.x, transform.y + rect.height)
      ctx.scale(transform.scale, -transform.scale)
      const w = shownRegion.x1Mm - shownRegion.x0Mm
      const h = shownRegion.y1Mm - shownRegion.y0Mm
      ctx.fillStyle = 'rgba(0, 200, 255, 0.10)'
      ctx.fillRect(shownRegion.x0Mm, shownRegion.y0Mm, w, h)
      ctx.strokeStyle = drawingRegion ? '#00e5ff' : '#00b8d4'
      ctx.lineWidth = 1.5 / transform.scale
      ctx.setLineDash(drawingRegion ? [6 / transform.scale, 4 / transform.scale] : [])
      ctx.strokeRect(shownRegion.x0Mm, shownRegion.y0Mm, w, h)
      ctx.setLineDash([])
      // 切線兩端必定貼齊工作範圍，所以直接畫滿整個範圍（ADR-0002 的沿用）
      if (crossSectionCut && !drawingRegion) {
        ctx.strokeStyle = '#ffd600'
        ctx.lineWidth = 2 / transform.scale
        ctx.beginPath()
        if (crossSectionCut.axis === 'x') {
          ctx.moveTo(crossSectionCut.coordinateMm, shownRegion.y0Mm)
          ctx.lineTo(crossSectionCut.coordinateMm, shownRegion.y1Mm)
        } else {
          ctx.moveTo(shownRegion.x0Mm, crossSectionCut.coordinateMm)
          ctx.lineTo(shownRegion.x1Mm, crossSectionCut.coordinateMm)
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    if (tdrMarkers && tdrMarkers.length > 0) {
      ctx.save()
      ctx.translate(transform.x, transform.y + rect.height)
      ctx.scale(transform.scale, -transform.scale)
      const px2 = (n: number) => n / transform.scale
      tdrMarkers.forEach(marker => {
        if (!marker.points || marker.points.length < 2) return
        const tracePath = () => {
          ctx.beginPath()
          marker.points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point[0], point[1])
            else ctx.lineTo(point[0], point[1])
          })
        }
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        // 外圈光暈 + 內圈實線；排除區（切面接縫假象）用灰色與虛線區隔。
        tracePath()
        ctx.strokeStyle = marker.excluded
          ? 'rgba(158, 168, 180, 0.25)' : 'rgba(255, 64, 129, 0.30)'
        ctx.lineWidth = px2(11)
        ctx.setLineDash([])
        ctx.stroke()
        tracePath()
        ctx.strokeStyle = marker.excluded
          ? 'rgba(176, 186, 198, 0.9)' : 'rgba(255, 82, 137, 0.98)'
        ctx.lineWidth = px2(2.6)
        ctx.setLineDash(marker.excluded ? [px2(4), px2(4)] : [])
        ctx.stroke()
        ctx.setLineDash([])
        if (marker.label) {
          const mid = marker.points[Math.floor(marker.points.length / 2)]
          ctx.save()
          ctx.translate(mid[0], mid[1])
          ctx.scale(1 / transform.scale, -1 / transform.scale)
          ctx.font = 'bold 12px "Calibri","Microsoft JhengHei",sans-serif'
          ctx.fillStyle = marker.excluded ? 'rgba(186, 196, 208, 0.95)' : '#ff8ab0'
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
          ctx.lineWidth = 3
          ctx.strokeText(marker.label, 8, -8)
          ctx.fillText(marker.label, 8, -8)
          ctx.restore()
        }
      })
      ctx.restore()
    }

    // ── 裁切外框：PyEDB 精確預估／正式裁切比對 ──────
    // 先前這裡還有一種「快速估算」：直接拿 2D 預覽的圖元在前端算凸包或
    // 外接矩形。那份資料本身是為了畫面顯示而降階過的，算出來的外框與正式
    // 裁切可能相差甚遠，容易讓人誤以為那就是實際裁切範圍，已整段移除。
    // 現在只在按下「分析精確裁切外框」（後端唯讀呼叫與正式裁切相同的
    // 演算法）之後才會畫預估外框。
    const hasBackendEstimate = (estimatedCutoutBoundary?.length || 0) >= 3
    const hasActualBoundary = (actualCutoutBoundary?.length || 0) >= 3
    if (hasBackendEstimate) {
      let sx1 = Infinity, sy1 = Infinity, sx2 = -Infinity, sy2 = -Infinity
      {
        const exp = expansionMm || 0
        const previewPoly: number[][] = estimatedCutoutBoundary || []
        const actualPoly = hasActualBoundary ? actualCutoutBoundary! : null
        const outlinePoints = actualPoly || previewPoly
        const outlineXs = outlinePoints.map(point => point[0])
        const outlineYs = outlinePoints.map(point => point[1])
        sx1 = Math.min(...outlineXs); sx2 = Math.max(...outlineXs)
        sy1 = Math.min(...outlineYs); sy2 = Math.max(...outlineYs)

        const cb  = computeContentBounds() || data.bounds
        const bW  = Math.max(sx2-sx1, 1)
        const bH  = Math.max(sy2-sy1, 1)
        const pad = Math.max(bW, bH) * 0.1
        const mx1 = Math.min(cb.min[0], sx1) - pad
        const my1 = Math.min(cb.min[1], sy1) - pad
        const mx2 = Math.max(cb.max[0], sx2) + pad
        const my2 = Math.max(cb.max[1], sy2) + pad

        ctx.save()
        ctx.translate(transform.x, transform.y + rect.height)
        ctx.scale(transform.scale, -transform.scale)
        const px2 = (n: number) => n / transform.scale
        const polygonPath = (points: number[][]) => {
          ctx.beginPath()
          ctx.moveTo(points[0][0], points[0][1])
          for (let index = 1; index < points.length; index++) {
            ctx.lineTo(points[index][0], points[index][1])
          }
          ctx.closePath()
        }

        if (!actualPoly) {
          // 尚未正式裁切：壓暗外部區域，橘框代表「預估」而非已完成結果。
          ctx.fillStyle = 'rgba(0,0,0,0.52)'
          ctx.beginPath()
          ctx.rect(mx1, my1, mx2-mx1, my2-my1)
          ctx.moveTo(previewPoly[0][0], previewPoly[0][1])
          for (let index = 1; index < previewPoly.length; index++) {
            ctx.lineTo(previewPoly[index][0], previewPoly[index][1])
          }
          ctx.closePath()
          ctx.fill('evenodd')
        } else {
          if (showBoundaryDifferenceFill) {
            // 先畫兩側差異，再把交集覆成綠色：橘＝僅預估、藍＝僅實際、綠＝共同。
            polygonPath(previewPoly)
            ctx.fillStyle = 'rgba(255,140,0,0.38)'
            ctx.fill()
            polygonPath(actualPoly)
            ctx.fillStyle = 'rgba(0,229,255,0.34)'
            ctx.fill()
            ctx.save()
            polygonPath(previewPoly)
            ctx.clip()
            polygonPath(actualPoly)
            ctx.fillStyle = 'rgba(62,207,142,0.52)'
            ctx.fill()
            ctx.restore()
          }

          polygonPath(actualPoly)
          ctx.strokeStyle = '#00e5ff'
          ctx.lineWidth = px2(2.5)
          ctx.setLineDash([])
          ctx.stroke()
        }

        polygonPath(previewPoly)
        ctx.strokeStyle = '#ff8c00'
        ctx.lineWidth = px2(2.5)
        ctx.setLineDash([px2(10), px2(5)])
        ctx.stroke()
        ctx.setLineDash([])

        ctx.restore()

        ctx.save()
        ctx.font = 'bold 12px "Microsoft JhengHei","Calibri",sans-serif'
        // 直接顯示實際的形狀名。舊寫法是「非凸包就標 Bounding」的布林，
        // Conforming 加入後會把貼合外框標成 Bounding——畫布上的說明與
        // 系統日誌矛盾，截進文件的圖會自打嘴巴。
        const modeLabel = extentType || 'Bounding'
        if (actualPoly) {
          const errorText = boundaryComparison?.available
            ? `最大差異 ${boundaryComparison.max_boundary_error_mm?.toFixed(3)} mm／容差 ${boundaryComparison.tolerance_mm.toFixed(3)} mm`
            : '差異量測不可用'
          ctx.fillStyle = boundaryComparison?.within_tolerance ? '#7ee787' : '#ffb347'
          const legend = showBoundaryDifferenceFill
            ? '綠＝共同　橘＝僅預估　藍＝僅實際'
            : '差異填色已關閉　橘虛線＝預估　藍實線＝實際'
          ctx.fillText(`${legend}　${errorText}`, 12, rect.height - 12)
        } else {
          ctx.fillStyle = '#ff8c00'
          ctx.fillText(`▣ PyEDB 精確預估 [${modeLabel}]  向外 ±${exp} mm`, 12, rect.height - 12)
        }
        ctx.restore()
      }
    }
  }, [data, transform, layerModes, visibleComps, visibleNets, signalNets, expansionMm, extentType, estimatedCutoutBoundary, actualCutoutBoundary, showBoundaryDifferenceFill, boundaryComparison, segmentCuts, draggingCut, showSegmentSafetyOverlay, showSolverRegionOverlay, cleanupOverlay, removedGeometry, dimBase, differenceKind, differenceLayer, tdrMarkers, crossSectionRegion, crossSectionCut, drawingRegion, getLayerColor, getStackupLayers, computeContentBounds])

  useEffect(() => { drawCanvas() }, [drawCanvas])

  useEffect(() => {
    const cont = containerRef.current
    if (!cont) return
    const obs = new ResizeObserver(() => drawCanvas())
    obs.observe(cont)
    return () => obs.disconnect()
  }, [drawCanvas])

  // ── 滑鼠事件 ─────────────────────────────────────────────
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const f = Math.exp(-e.deltaY * 0.001)
    const r = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX-r.left, my = e.clientY-r.top
    setTransform(prev => ({ x: mx-(mx-prev.x)*f, y: my-(my-prev.y)*f, scale: prev.scale*f }))
  }
  /** 鍵盤操作。**掛在畫布上而不是掛 window**——方向鍵在整個應用程式裡
   *  是文字欄位的游標鍵，全域攔截會讓使用者在輸入路徑時游標動不了。
   *  要用鍵盤就先點一下畫布（容器有 tabIndex，點擊即取得焦點）。
   *
   *  跑十幾條通道的人一天要平移縮放幾百次，滑鼠滾輪縮放的落點又依游標
   *  位置而定，很難精準回到同一個視角；`0` 一鍵回到全覽解決的就是這件事。
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 120 : 30          // Shift ＝ 一次跨大步
    const zoom = (factor: number) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      // 以畫布中心為基準縮放，不是游標——鍵盤操作沒有游標位置可用。
      const mx = (rect?.width ?? 0) / 2, my = (rect?.height ?? 0) / 2
      setTransform(prev => ({
        x: mx - (mx - prev.x) * factor,
        y: my - (my - prev.y) * factor,
        scale: prev.scale * factor,
      }))
    }
    const pan = (dx: number, dy: number) =>
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))

    switch (e.key) {
      case 'ArrowLeft':  pan(step, 0); break
      case 'ArrowRight': pan(-step, 0); break
      case 'ArrowUp':    pan(0, step); break
      case 'ArrowDown':  pan(0, -step); break
      case '+': case '=': zoom(1.2); break
      case '-': case '_': zoom(1 / 1.2); break
      case '0': case 'f': case 'F': fitView(); break
      default: return                            // 其餘按鍵不攔，讓它照常冒泡
    }
    e.preventDefault()
  }

  // ── 刀線拖曳 ──────────────────────────────────────────────
  /** 螢幕座標 → 圖面座標（mm）。 */
  const toWorld = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: (e.clientX - rect.left - transform.x) / transform.scale,
      y: (rect.height + transform.y - (e.clientY - rect.top)) / transform.scale,
    }
  }

  /** 游標附近（6 螢幕像素內）的刀，沒有就回 null。 */
  const cutUnderCursor = (e: React.MouseEvent) => {
    if (!onCutDrag || !segmentCuts?.cuts?.length) return null
    const world = toWorld(e)
    if (!world) return null
    const tolerance = 6 / transform.scale
    const hits = segmentCuts.cuts
      .map((cut, index) => {
        const axis = cut.direction === 'x' ? 0 : 1
        return {
          index, axis,
          distance: Math.abs((axis === 0 ? world.x : world.y) - cut.position_mm),
        }
      })
      .filter(hit => hit.distance <= tolerance)
      .sort((a, b) => a.distance - b.distance)
    return hits[0] || null
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownPoint.current = { x: e.clientX, y: e.clientY }
    if (crossSectionMode === 'region') {
      const world = toWorld(e)
      if (world) {
        regionAnchor.current = world
        setDrawingRegion({ x0Mm: world.x, y0Mm: world.y,
                           x1Mm: world.x, y1Mm: world.y })
      }
      return
    }
    if (crossSectionMode === 'cut') {
      // 切線只有 X／Y 兩種，所以按下去就決定位置；軸向由工作範圍的長邊決定
      // ——長邊方向是通道走向，垂直於它切才是對的。
      const world = toWorld(e)
      if (world && crossSectionRegion && onCrossSectionCutDrawn) {
        const wide = (crossSectionRegion.x1Mm - crossSectionRegion.x0Mm) >=
                     (crossSectionRegion.y1Mm - crossSectionRegion.y0Mm)
        onCrossSectionCutDrawn({
          axis: wide ? 'x' : 'y',
          coordinateMm: wide ? world.x : world.y,
        })
      }
      return
    }
    const target = cutUnderCursor(e)
    if (target) {
      // 抓到刀就只拖刀，不要同時平移畫面。
      const world = toWorld(e)!
      setDraggingCut({
        index: target.index,
        positionMm: target.axis === 0 ? world.x : world.y,
      })
      return
    }
    setIsDragging(true)
    setDragStart({ x: e.clientX-transform.x, y: e.clientY-transform.y })
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (regionAnchor.current) {
      const world = toWorld(e)
      if (world) {
        const a = regionAnchor.current
        setDrawingRegion({
          x0Mm: Math.min(a.x, world.x), y0Mm: Math.min(a.y, world.y),
          x1Mm: Math.max(a.x, world.x), y1Mm: Math.max(a.y, world.y),
        })
      }
      return
    }
    if (draggingCut) {
      const world = toWorld(e)
      const cut = segmentCuts?.cuts?.[draggingCut.index]
      if (!world || !cut) return
      const axis = cut.direction === 'x' ? 0 : 1
      setDraggingCut({
        index: draggingCut.index,
        positionMm: axis === 0 ? world.x : world.y,
      })
      return
    }
    if (!isDragging) {
      const target = cutUnderCursor(e)
      setHoverCutAxis(target ? target.axis : null)
      return
    }
    setTransform(prev => ({ ...prev, x: e.clientX-dragStart.x, y: e.clientY-dragStart.y }))
  }
  const handleMouseUp = (e: React.MouseEvent) => {
    const movement = Math.hypot(
      e.clientX - mouseDownPoint.current.x,
      e.clientY - mouseDownPoint.current.y,
    )
    if (regionAnchor.current) {
      const pending = drawingRegion
      regionAnchor.current = null
      setDrawingRegion(null)
      // 只是點一下、沒有拖出面積的話不當成框選——零面積的工作範圍會讓
      // 後端直接拒絕，而使用者只會覺得「按了沒反應」。
      if (pending && movement > 4 &&
          pending.x1Mm > pending.x0Mm && pending.y1Mm > pending.y0Mm) {
        onCrossSectionRegionDrawn?.(pending)
      }
      return
    }
    if (draggingCut) {
      const pending = draggingCut
      setDraggingCut(null)
      // 只是點到線上、沒真的拖動，就別觸發一次多餘的重新分析。
      if (movement > 3) onCutDrag?.(pending.index, pending.positionMm)
      return
    }
    setIsDragging(false)
    if (movement > 4 || !onSegmentRegionClick || !segmentCuts || !data) return
    const canvasRect = canvasRef.current?.getBoundingClientRect()
    if (!canvasRect) return
    const screenX = e.clientX - canvasRect.left
    const screenY = e.clientY - canvasRect.top
    const worldX = (screenX - transform.x) / transform.scale
    const worldY = (canvasRect.height + transform.y - screenY) / transform.scale
    const bounds = computeContentBounds() || data.bounds
    const axis = segmentCuts.direction === 'x' ? 0 : 1
    const coordinate = axis === 0 ? worldX : worldY
    const edges = [
      bounds.min[axis],
      ...segmentCuts.positions_mm,
      bounds.max[axis],
    ]
    const index = edges.findIndex((edge, position) => (
      position + 1 < edges.length
      && coordinate >= Math.min(edge, edges[position + 1])
      && coordinate <= Math.max(edge, edges[position + 1])
    ))
    if (index >= 0) onSegmentRegionClick(index)
  }

  // ── Layers 操作 ───────────────────────────────────────────
  // 切換單一層的某欄
  const toggleLayerCol = (layer: string, col: keyof LayerMode) => {
    setLayerModes(prev => ({
      ...prev,
      [layer]: { ...(prev[layer] || DEFAULT_MODE), [col]: !prev[layer]?.[col] },
    }))
  }

  // 點擊欄標頭：若任一層為 ON 則全部關掉；否則全部開啟
  const toggleAllCol = (col: keyof LayerMode) => {
    if (!data) return
    const anyOn = Object.values(layerModes).some(m => m?.[col])
    setLayerModes(prev => {
      const next = { ...prev }
      Object.keys(data.layers).forEach(l => {
        next[l] = { ...(next[l] || DEFAULT_MODE), [col]: !anyOn }
      })
      return next
    })
  }

  // ── Components / Nets 操作 ────────────────────────────────
  const setAllItems = (type: 'comps' | 'nets', v: boolean) => {
    if (type === 'comps') {
      const n: Record<string,boolean>={}; Object.keys(visibleComps).forEach(k=>{n[k]=v}); setVisibleComps(n)
    } else {
      const n: Record<string,boolean>={}; Object.keys(visibleNets).forEach(k=>{n[k]=v}); setVisibleNets(n)
    }
  }
  const toggleComp = (c: string) => setVisibleComps(p=>({...p,[c]:!p[c]}))
  const toggleNet  = (n: string) => setVisibleNets(p=>({...p,[n]:!p[n]}))

  // ── 清單資料 ──────────────────────────────────────────────
  const stackupLayers  = getStackupLayers()
  const allDisplayLayers = stackupLayers

  const filteredComps = Object.keys(visibleComps).sort().filter(c => c.toLowerCase().includes(compFilter.toLowerCase()))
  const filteredNets  = Object.keys(visibleNets).sort().filter(n => n.toLowerCase().includes(netFilter.toLowerCase()))

  // ── Show-only-selected 操作 ───────────────────────────────
  const highlightSet = new Set(highlightNets)

  const showOnlyHighlighted = () => {
    if (highlightSet.size === 0) return
    const next: Record<string, boolean> = {}
    Object.keys(visibleNets).forEach(n => { next[n] = highlightSet.has(n) })
    setVisibleNets(next)
    setShowOnlySelected(true)
  }

  const restoreAllNets = () => {
    const next: Record<string, boolean> = {}
    Object.keys(visibleNets).forEach(n => { next[n] = true })
    setVisibleNets(next)
    setShowOnlySelected(false)
  }

  // 當 highlightNets 變動時，若已在「只顯示」模式，自動更新
  useEffect(() => {
    if (!showOnlySelected) return
    setVisibleNets(prev => {
      const next: Record<string, boolean> = {}
      Object.keys(prev).forEach(n => { next[n] = highlightSet.has(n) })
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightNets?.join(','), showOnlySelected])


  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, background: 'none', border: 'none', cursor: 'pointer',
    padding: '8px 0', fontWeight: 600, fontSize: 12.5,
    color: active ? '#e0e6ed' : '#6e7681',
    borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
    transition: 'color 0.15s',
  })

  const smallBtn: React.CSSProperties = {
    fontSize: 11, padding: '2px 8px', background: '#21262d',
    color: '#c9d1d9', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 4, cursor: 'pointer',
  }

  const searchInput: React.CSSProperties = {
    flex: 1, background: '#161b22', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 4, color: '#e0e6ed', padding: '3px 8px',
    fontSize: 12, outline: 'none',
  }


  // ── 樣式 ─────────────────────────────────────────────────
  const PANEL_WIDTH = 160 + LAYER_COLS.length * COL_W + 24

  // ─────────────────────────────────────────────────────────
  const hasPanel = !!(layerPanelEnabled && data && data.layers && Object.keys(data.layers).length > 0)


  return (
    // 外層：flex 橫排，讓畫布和面板並排，互不遮擋
    <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'row', overflow:'hidden', background: BG_COLOR }}>

      {/* 畫布區（佔滿剩餘寬度） */}
      <div
        ref={containerRef}
        style={{ flex:1, position:'relative', overflow:'hidden', minWidth:0,
                 outline:'none' }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        title="點一下畫布後可用鍵盤：方向鍵平移（Shift 跨大步）、+／− 縮放、0 回到全覽。"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas ref={canvasRef} style={{
          cursor: (draggingCut ? draggingCut.index : hoverCutAxis) !== null
            ? ((draggingCut
                ? (segmentCuts?.cuts?.[draggingCut.index]?.direction === 'x' ? 0 : 1)
                : hoverCutAxis) === 0 ? 'col-resize' : 'row-resize')
            : crossSectionMode !== 'none' ? 'crosshair'
            : isDragging ? 'grabbing' : 'grab',
          display: 'block',
        }} />

        {/* 截面阻抗的兩種互動模式。用看得見的按鈕而不是修飾鍵：Shift／Ctrl
            拖曳沒有任何視覺提示，不看手冊就不會知道，而且按下去之後畫面
            行為變了卻沒有東西告訴使用者現在是什麼狀態。 */}
        {onCrossSectionModeChange && (
          <div
            style={{ position: 'absolute', left: 16, top: 70, zIndex: 20,
                     display: 'flex', gap: 6 }}
            onMouseDown={event => event.stopPropagation()}
          >
            {([
              ['region', '框工作範圍', '拖曳框出範圍。它也是截面的側向截斷邊界，太窄會讓阻抗偏高。'],
              ['cut', '拉切線', '在範圍內點一下。軸向由範圍的長邊決定，不允許斜切。'],
            ] as [CrossSectionMode, string, string][]).map(([mode, label, hint]) => (
              <button
                key={mode}
                className={'boundary-fill-toggle'
                  + (crossSectionMode === mode ? ' boundary-fill-toggle--active' : '')}
                type="button"
                aria-pressed={crossSectionMode === mode}
                title={hint}
                disabled={mode === 'cut' && !crossSectionRegion}
                onClick={event => {
                  event.stopPropagation()
                  onCrossSectionModeChange(crossSectionMode === mode ? 'none' : mode)
                }}
              >{label}</button>
            ))}
          </div>
        )}

        {/* 裁切外框差異填色開關：與 Canvas 同層，避免被預覽畫布遮住。 */}
        {onBoundaryDifferenceFillChange && (
          <div
            style={{ position: 'absolute', left: 16, top: 38, zIndex: 20 }}
            onMouseDown={event => event.stopPropagation()}
          >
            <button
              className={'boundary-fill-toggle' + (showBoundaryDifferenceFill ? ' boundary-fill-toggle--active' : '')}
              type="button"
              aria-pressed={showBoundaryDifferenceFill}
              title={showBoundaryDifferenceFill
                ? '關閉半透明差異填色，讓 Layout 細節更清楚'
                : '顯示預估與實際裁切外框的差異填色'}
              onClick={event => {
                event.stopPropagation()
                onBoundaryDifferenceFillChange(!showBoundaryDifferenceFill)
              }}
            >
              差異填色：{showBoundaryDifferenceFill ? '開啟' : '關閉'}
            </button>
          </div>
        )}

        {segmentCuts?.safety_overlay && onSegmentSafetyOverlayChange && (
          <div
            style={{ position: 'absolute', left: 16, top: 38, zIndex: 20 }}
            onMouseDown={event => event.stopPropagation()}
          >
            <button
              className={'boundary-fill-toggle' + (showSegmentSafetyOverlay ? ' boundary-fill-toggle--active' : '')}
              type="button"
              aria-pressed={showSegmentSafetyOverlay}
              title={showSegmentSafetyOverlay
                ? '關閉禁切區與拒絕候選疊圖，讓 Layout 細節更清楚'
                : '顯示硬性禁切區、風險區與拒絕候選'}
              onClick={event => {
                event.stopPropagation()
                onSegmentSafetyOverlayChange(!showSegmentSafetyOverlay)
              }}
            >
              安全疊圖：{showSegmentSafetyOverlay ? '開啟' : '關閉'}
            </button>
          </div>
        )}

        {segmentCuts?.region_solvers?.length && onSolverRegionOverlayChange && (
          <div
            style={{
              position: 'absolute', left: 16,
              top: segmentCuts?.safety_overlay ? 76 : 38,
              zIndex: 20,
            }}
            onMouseDown={event => event.stopPropagation()}
          >
            <button
              className={'boundary-fill-toggle' + (showSolverRegionOverlay ? ' boundary-fill-toggle--active' : '')}
              type="button"
              aria-pressed={showSolverRegionOverlay}
              title={showSolverRegionOverlay
                ? '關閉 HFSS／SIwave 求解區域色塊'
                : '顯示每個 Segment 的求解器區域'}
              onClick={event => {
                event.stopPropagation()
                onSolverRegionOverlayChange(!showSolverRegionOverlay)
              }}
            >
              求解區域：{showSolverRegionOverlay ? '開啟' : '關閉'}
            </button>
          </div>
        )}

        {/* Fit All */}
        {data && (
          <div style={{ position:'absolute', right:10, bottom:10, zIndex:10 }} onMouseDown={e=>e.stopPropagation()}>
            <button
              type="button"
              onClick={e=>{ e.stopPropagation(); fitView() }}
              title="縮放至全板 (Fit All)"
              style={{
                padding:'5px 12px', fontSize:12, fontWeight:600,
                background:'rgba(22,26,33,0.92)', color:'#e0e6ed',
                border:'1px solid rgba(255,255,255,0.2)', borderRadius:6,
                cursor:'pointer', backdropFilter:'blur(6px)',
              }}
            >⛶ Fit All</button>
          </div>
        )}
      </div>

      {/* 右側面板（固定寬度，不遮畫布） */}
      {hasPanel && (
        <div style={{ display:'flex', flexDirection:'row', flexShrink:0 }}>

          {/* 折疊把手：一條細長按鈕 */}
          <div
            onClick={() => setPanelOpen(o => !o)}
            title={panelOpen ? '收合面板' : '展開面板'}
            style={{
              width: 14,
              background: 'rgba(22,28,40,0.95)',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              userSelect: 'none', flexShrink: 0,
              transition: 'background 0.15s',
              fontSize: 10, color: '#6e7681',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(88,166,255,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(22,28,40,0.95)')}
          >
            <span style={{ writingMode:'vertical-rl', transform:'rotate(180deg)', letterSpacing: 2 }}>
              {panelOpen ? '◀' : '▶'}
            </span>
          </div>

          {/* 面板主體（panelOpen 時顯示）。
              **只淡入內容，不動寬度。** 寬度做成動畫的話畫布會跟著逐格改變
              尺寸，而畫布的 ResizeObserver 每次都會把三萬多個圖元重畫一次
              ——那是每秒六十次全板重繪，動畫還沒播完就先卡住了。
              空間瞬間讓出來、內容淡進去，看起來一樣順，代價是零。 */}
          {panelOpen && (
            <div
              className="layer-panel"
              style={{
                width: PANEL_WIDTH,
                display:'flex', flexDirection:'column',
                background: 'rgba(14,18,26,0.98)',
                borderLeft: '1px solid rgba(255,255,255,0.10)',
                color: '#e0e6ed', fontSize: 12.5,
                overflow: 'hidden',
              }}
              onWheel={e=>e.stopPropagation()}
              onMouseDown={e=>e.stopPropagation()}
            >

          {/* Tabs */}
          <div style={{ display:'flex', borderBottom:'1px solid rgba(255,255,255,0.10)', padding:'0 8px', flexShrink:0 }}>
            {(['Layers','Components','Nets'] as const).map(tab => (
              <button key={tab} onClick={()=>setActiveTab(tab)} style={tabBtn(activeTab===tab)}>{tab}</button>
            ))}
          </div>

          {/* ── Layers 分頁 ── */}
          {activeTab === 'Layers' && (
            <div style={{ overflowY:'auto', flex:1 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
                <colgroup>
                  <col style={{ width:'auto' }} />
                  {LAYER_COLS.map(c => <col key={c.key} style={{ width: COL_W }} />)}
                </colgroup>
                <thead>
                  <tr style={{ borderBottom:'1px solid rgba(255,255,255,0.10)', background:'rgba(255,255,255,0.03)' }}>
                    {/* 名稱欄 */}
                    <th style={{ textAlign:'left', padding:'6px 12px', color:'#8b949e', fontWeight:600, fontSize:11 }}>
                      Name
                    </th>
                    {/* 各欄標頭（可點擊，切換全部） */}
                    {LAYER_COLS.map(col => (
                      <th
                        key={col.key}
                        title={`${col.title}（點擊切換全部）`}
                        onClick={() => toggleAllCol(col.key)}
                        style={{
                          textAlign:'center', padding:'6px 2px',
                          background: col.headerBg,
                          fontSize: col.key === 'filled' ? 14 : 15,
                          cursor:'pointer', userSelect:'none',
                          color: col.key === 'filled' ? '#ffd700'
                               : col.key === 'visible' ? '#8b949e'
                               : '#58a6ff',
                          transition:'opacity 0.1s',
                        }}
                      >{col.icon}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allDisplayLayers.map((layer) => {
                    const mode  = layerModes[layer] || DEFAULT_MODE
                    const color = getLayerColor(layer)
                    return (
                      <React.Fragment key={layer}>
                        <tr
                          onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.05)')}
                          onMouseLeave={e=>(e.currentTarget.style.background='transparent')}
                          style={{ transition:'background 0.1s', opacity: mode.visible ? 1 : 0.45 }}
                        >
                          {/* 層名 */}
                          <td style={{ padding:'3px 12px' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{
                                width:12, height:10, display:'inline-block', flexShrink:0,
                                background: color, border:'1px solid rgba(255,255,255,0.35)',
                              }} />
                              <span style={{
                                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                                color: color, fontWeight:600, fontSize:12,
                              }} title={layer}>{layer}</span>
                            </div>
                          </td>
                          {/* 各欄 checkbox */}
                          {LAYER_COLS.map(col => (
                            <td key={col.key} style={{ textAlign:'center', padding:'3px 2px' }}>
                              <input
                                type="checkbox"
                                aria-label={`${layer} 的 ${col.title}`}
                                checked={!!mode[col.key]}
                                onChange={() => toggleLayerCol(layer, col.key)}
                                style={{
                                  cursor:'pointer', width:14, height:14,
                                  accentColor: col.key === 'filled'  ? '#ffd700'
                                             : col.key === 'visible' ? '#8b949e'
                                             : color,
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Components 分頁 ── */}
          {activeTab === 'Components' && (
            <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
              <div style={{ padding:'8px 10px', display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                <input
                  type="text" aria-label="搜尋元件" placeholder="搜尋元件…" value={compFilter}
                  onChange={e=>setCompFilter(e.target.value)} style={searchInput}
                />
                <button onClick={()=>setAllItems('comps',true)}  style={smallBtn}>全選</button>
                <button onClick={()=>setAllItems('comps',false)} style={smallBtn}>全不選</button>
              </div>
              <div style={{ overflowY:'auto', flex:1 }}>
                {filteredComps.map(comp => (
                  <label
                    key={comp}
                    style={{ display:'flex', alignItems:'center', gap:8, padding:'3px 12px', cursor:'pointer' }}
                    onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.05)')}
                    onMouseLeave={e=>(e.currentTarget.style.background='transparent')}
                  >
                    <input
                      type="checkbox" checked={!!visibleComps[comp]} onChange={()=>toggleComp(comp)}
                      style={{ cursor:'pointer', accentColor:'#58a6ff', width:14, height:14 }}
                    />
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }} title={comp}>{comp}</span>
                  </label>
                ))}
                {filteredComps.length === 0 && (
                  <div style={{ color:'#6e7681', textAlign:'center', padding:16, fontSize:12 }}>
                    {Object.keys(visibleComps).length === 0 ? '無元件資料' : '無符合結果'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Nets 分頁 ── */}
          {activeTab === 'Nets' && (
            <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>

              {/* 「只顯示選取網路」功能區 */}
              {highlightSet.size > 0 && (
                <div style={{
                  margin:'8px 10px 0', padding:'8px 10px',
                  background: showOnlySelected ? 'rgba(88,166,255,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${showOnlySelected ? 'rgba(88,166,255,0.5)' : 'rgba(255,255,255,0.10)'}`,
                  borderRadius: 6,
                }}>
                  <div style={{ fontSize:11, color:'#8b949e', marginBottom:6 }}>
                    已選取網路：
                    <span style={{ color:'#7ee787', marginLeft:4 }}>訊號 {signalNets.length} 個</span>
                    <span style={{ color:'#58a6ff', marginLeft:6 }}>參考 {refNets.length} 個</span>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button
                      onClick={showOnlyHighlighted}
                      style={{
                        flex:1, fontSize:11.5, padding:'4px 6px',
                        background: showOnlySelected ? '#1f6feb' : '#238636',
                        color:'#fff', border:'none', borderRadius:4, cursor:'pointer',
                        fontWeight: 600,
                      }}
                      title="隱藏其他所有網路，只顯示已選取的訊號與參考網路"
                    >👁 只顯示選取網路</button>
                    {showOnlySelected && (
                      <button
                        onClick={restoreAllNets}
                        style={{
                          fontSize:11, padding:'4px 8px',
                          background:'#21262d', color:'#c9d1d9',
                          border:'1px solid rgba(255,255,255,0.15)', borderRadius:4, cursor:'pointer',
                        }}
                      >恢復全部</button>
                    )}
                  </div>
                </div>
              )}

              {/* 搜尋 + 全選 */}
              <div style={{ padding:'8px 10px', display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                <input
                  type="text" aria-label="搜尋網路" placeholder="搜尋網路…" value={netFilter}
                  onChange={e=>setNetFilter(e.target.value)} style={searchInput}
                />
                <button onClick={()=>setAllItems('nets',true)}  style={smallBtn}>全選</button>
                <button onClick={()=>setAllItems('nets',false)} style={smallBtn}>全不選</button>
              </div>

              {/* 網路清單 */}
              <div style={{ overflowY:'auto', flex:1 }}>
                {filteredNets.map(net => {
                  const isSig = signalNets.includes(net)
                  const isRef = refNets.includes(net)
                  return (
                    <label
                      key={net}
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'3px 10px', cursor:'pointer' }}
                      onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.05)')}
                      onMouseLeave={e=>(e.currentTarget.style.background='transparent')}
                    >
                      <input
                        type="checkbox" checked={!!visibleNets[net]} onChange={()=>toggleNet(net)}
                        style={{ cursor:'pointer', accentColor:'#58a6ff', width:14, height:14 }}
                      />
                      {/* 訊號/參考網路標記 */}
                      {isSig && (
                        <span title="訊號網路" style={{
                          width:6, height:6, borderRadius:'50%', flexShrink:0,
                          background:'#7ee787', display:'inline-block',
                        }} />
                      )}
                      {isRef && (
                        <span title="參考網路" style={{
                          width:6, height:6, borderRadius:'50%', flexShrink:0,
                          background:'#58a6ff', display:'inline-block',
                        }} />
                      )}
                      {!isSig && !isRef && <span style={{ width:6, flexShrink:0 }} />}
                      <span
                        style={{
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1,
                          color: isSig ? '#7ee787' : isRef ? '#58a6ff' : '#c9d1d9',
                          fontWeight: (isSig || isRef) ? 600 : 400,
                        }}
                        title={net}
                      >{net}</span>
                    </label>
                  )
                })}
                {filteredNets.length === 0 && (
                  <div style={{ color:'#6e7681', textAlign:'center', padding:16, fontSize:12 }}>
                    {Object.keys(visibleNets).length === 0 ? '無網路資料' : '無符合結果'}
                  </div>
                )}
              </div>
            </div>
          )}

            </div>
          )}
          {/* 面板主體 end */}

        </div>
      )}
      {/* 右側面板 end */}

    </div>
  )
}
