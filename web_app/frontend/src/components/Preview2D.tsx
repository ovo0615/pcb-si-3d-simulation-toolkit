// 2D Layout 預覽（HTML5 Canvas，SIwave 風格）— 沿用 PCB_Simplifer_Toolkit 驗證過的渲染引擎
// 右側面板仿 SIwave 欄位設計：Layers / Components / Nets 分頁
//   Layers 欄位由左至右：Fill/Unfill All、Show/Hide All、Planes、Traces、Pads、Vias、Circuit Elements
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
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

export interface SegmentCutLine {
  point: [number, number]     // 刀中心（mm，脊椎上的點）
  tangent: [number, number]   // 通道局部走向（單位向量；刀與其垂直）
  half_len: number            // 刀半長（mm）
  valid: boolean
}

export interface SegmentCutsInfo {
  cuts: SegmentCutLine[]      // N-1 把「旋轉直線刀」
  spine?: number[][]          // 通道脊椎折線（mm），淡色虛線顯示
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

interface Preview2DProps {
  data: PreviewData | null
  fitKey?: string
  highlightNets?: string[]  // 已選訊號 + 參考網路（用於「只顯示選取網路」功能）
  signalNets?: string[]     // 訊號網路（綠色標記）
  refNets?: string[]        // 參考網路（藍色標記）
  expansionMm?: number      // 裁切擴張距離預覽（mm）
  extentType?: string       // 'ConvexHull' | 'Bounding' — 裁切形狀
  segmentCuts?: SegmentCutsInfo | null  // 功能2：N 段分割切割線
  cleanupOverlay?: CleanupOverlay | null // Layout 清理：預計移除物件紅框
  layerPanelEnabled?: boolean // 比較模式可關閉側欄，保留更多畫布空間
  removedGeometry?: CleanupRemovedGeometry | null // 清理時實際刪除的原始幾何
  dimBase?: boolean // 差異模式：壓暗未變更 Layout
  differenceKind?: 'all' | 'primitive' | 'via'
  differenceLayer?: string
  focusBounds?: { min: [number, number]; max: [number, number] } | null
}

// ── 顏色常數 ────────────────────────────────────────────────
const BG_COLOR   = '#0c0e12'
const BOARD_FILL = 'rgba(18, 62, 28, 0.85)'
const BOARD_STROKE = '#4caf50'
const PORT_COLOR = '#ff5252'
const FALLBACK_PALETTE = [
  '#ff3b30', '#00e676', '#ffd600', '#00b0ff', '#e040fb',
  '#ff9100', '#18ffff', '#c6ff00', '#ff4081', '#7c4dff',
]

// ── 凸包演算法（Graham scan）—回傳 CCW 順序的頂點串列 ───────────
function computeConvexHull(points: number[][]): number[][] {
  if (points.length < 3) return points.slice()
  const sorted = [...points].sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
  const lower: number[][] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: number[][] = []
  for (let i = sorted.length-1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop(); upper.pop()
  return [...lower, ...upper]
}

// ── 凸多邊形向外側均勻最山 d mm（bisector offset）───────────────
function expandConvexHull(hull: number[][], d: number): number[][] {
  const n = hull.length
  if (n < 3) return hull
  return hull.map((curr, i) => {
    const prev = hull[(i - 1 + n) % n]
    const next = hull[(i + 1) % n]
    // 不同次邊的邊向量
    const dx1 = curr[0]-prev[0], dy1 = curr[1]-prev[1]
    const dx2 = next[0]-curr[0], dy2 = next[1]-curr[1]
    const len1 = Math.hypot(dx1, dy1), len2 = Math.hypot(dx2, dy2)
    if (len1 < 1e-10 || len2 < 1e-10) return [...curr]
    // CCW 凸包的向外法向量（右垂群向）
    const nx1 = dy1/len1, ny1 = -dx1/len1
    const nx2 = dy2/len2, ny2 = -dx2/len2
    // 兩法向量的平分線方向
    const bx = nx1+nx2, by = ny1+ny2
    const blen = Math.hypot(bx, by)
    if (blen < 1e-10) return [curr[0]+nx1*d, curr[1]+ny1*d]
    // 平分線方向與其中一個法向的夺積分 = cos(半角)
    const cosHalf = (bx*nx1 + by*ny1) / blen
    const scale   = cosHalf > 1e-4 ? d / cosHalf : d
    return [curr[0] + bx/blen * scale, curr[1] + by/blen * scale]
  })
}

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

const DEFAULT_MODE: LayerMode = {
  filled: true, visible: true, planes: true,
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
  cleanupOverlay = null,
  layerPanelEnabled = true,
  removedGeometry = null,
  dimBase = false,
  differenceKind = 'all',
  differenceLayer = '',
  focusBounds = null,
}: Preview2DProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Viewport
  const [transform,  setTransform]  = useState({ x: 0, y: 0, scale: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart,  setDragStart]  = useState({ x: 0, y: 0 })

  // 圖層顯示設定
  const [layerModes,   setLayerModes]   = useState<Record<string, LayerMode>>({})
  const [visibleComps, setVisibleComps] = useState<Record<string, boolean>>({})
  const [visibleNets,  setVisibleNets]  = useState<Record<string, boolean>>({})

  // 面板折疊
  const [panelOpen, setPanelOpen] = useState(true)

  // 分頁 / 搜尋
  const [activeTab,   setActiveTab]   = useState<'Layers' | 'Components' | 'Nets'>('Layers')
  const [compFilter,  setCompFilter]  = useState('')
  const [netFilter,   setNetFilter]   = useState('')

  // 「只顯示選取網路」模式
  const [showOnlySelected, setShowOnlySelected] = useState(false)

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
        if (layerName === 'Board' && prim.kind === 'rect') {
          ctx.fillStyle = BOARD_FILL
          ctx.fillRect(prim.x, prim.y, prim.w, prim.h)
          ctx.strokeStyle = BOARD_STROKE
          ctx.lineWidth   = px(1.2)
          ctx.strokeRect(prim.x, prim.y, prim.w, prim.h)
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
          ctx.globalAlpha = 0.8
          ctx.fillRect(prim.x, prim.y, prim.w, prim.h)
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
          if (prim.name) {
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

    // ── 功能2：N 段分割「旋轉直線刀」（沿通道走向；青色虛線 + 編號）──
    if (segmentCuts && segmentCuts.cuts.length > 0) {
      ctx.save()
      ctx.translate(transform.x, transform.y + rect.height)
      ctx.scale(transform.scale, -transform.scale)
      const px2 = (n: number) => n / transform.scale

      // 通道脊椎（淡青色點線，顯示切割所依循的通道走向）
      if (segmentCuts.spine && segmentCuts.spine.length >= 2) {
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)'
        ctx.lineWidth = px2(1.2)
        ctx.setLineDash([px2(2.5), px2(4)])
        ctx.beginPath()
        ctx.moveTo(segmentCuts.spine[0][0], segmentCuts.spine[0][1])
        for (let i = 1; i < segmentCuts.spine.length; i++) {
          ctx.lineTo(segmentCuts.spine[i][0], segmentCuts.spine[i][1])
        }
        ctx.stroke()
      }

      segmentCuts.cuts.forEach((c, i) => {
        const [px, py] = c.point
        const [tx, ty] = c.tangent
        const vx = -ty, vy = tx                     // 刀方向 = 通道走向的垂直
        const hl = Math.max(c.half_len, 1) * 1.12   // 略為延伸方便辨識
        const ax0 = px - vx * hl, ay0 = py - vy * hl
        const bx0 = px + vx * hl, by0 = py + vy * hl
        const ok = c.valid !== false
        ctx.strokeStyle = ok ? '#00e5ff' : '#ff5252'
        ctx.lineWidth = px2(2.2)
        ctx.setLineDash([px2(9), px2(6)])
        ctx.beginPath()
        ctx.moveTo(ax0, ay0)
        ctx.lineTo(bx0, by0)
        ctx.stroke()
        ctx.setLineDash([])
        // 刀中心點
        ctx.fillStyle = ok ? '#00e5ff' : '#ff5252'
        ctx.beginPath()
        ctx.arc(px, py, px2(3), 0, 2 * Math.PI)
        ctx.fill()
        // 編號（畫在刀的一端）
        ctx.save()
        ctx.translate(bx0, by0)
        ctx.scale(1 / transform.scale, -1 / transform.scale)
        ctx.font = 'bold 12px "Calibri","Microsoft JhengHei",sans-serif'
        ctx.fillStyle = ok ? 'rgba(0, 229, 255, 0.95)' : 'rgba(255, 82, 82, 0.95)'
        ctx.fillText(`#${i + 1}`, 4, -4)
        ctx.restore()
      })
      ctx.restore()
    }

    // ── 裁切預覽框（橘色虛線 + 外部遮罩）───────────────
    if (signalNets.length > 0 && expansionMm !== undefined) {
      // 收集訊號網路圖元的所有座標點
      const sigSet = new Set(signalNets)
      const rawPts: number[][] = []
      let sx1 = Infinity, sy1 = Infinity, sx2 = -Infinity, sy2 = -Infinity

      for (const prims of Object.values(data.layers)) {
        for (const p of prims) {
          if (!p.net || !sigSet.has(p.net)) continue
          const add = (x: number, y: number) => {
            rawPts.push([x, y])
            if (x < sx1) sx1 = x; if (y < sy1) sy1 = y
            if (x > sx2) sx2 = x; if (y > sy2) sy2 = y
          }
          if ((p.kind === 'rect' || p.kind === 'comp') && p.w > 0 && p.h > 0) {
            add(p.x, p.y); add(p.x+p.w, p.y); add(p.x, p.y+p.h); add(p.x+p.w, p.y+p.h)
          } else if (p.kind === 'circle') {
            add(p.x-p.r, p.y-p.r); add(p.x+p.r, p.y-p.r)
            add(p.x-p.r, p.y+p.r); add(p.x+p.r, p.y+p.r)
          } else if ((p.kind === 'polygon' || p.kind === 'path') && p.points) {
            for (const pt of p.points) add(pt[0], pt[1])
          }
        }
      }

      if (isFinite(sx1) && rawPts.length >= 3) {
        const exp = expansionMm
        const isConvexHull = extentType === 'ConvexHull'

        // 計算裁切外塆形狀
        let previewPoly: number[][] = []
        if (isConvexHull) {
          const hull = computeConvexHull(rawPts)
          previewPoly = expandConvexHull(hull, exp)
        } else {
          // Bounding Box — 四點矩形（CCW）
          const bx1 = sx1-exp, by1 = sy1-exp, bx2 = sx2+exp, by2 = sy2+exp
          previewPoly = [[bx1,by1],[bx2,by1],[bx2,by2],[bx1,by2]]
        }

        // 板子整體範圍
        const cb  = computeContentBounds() || data.bounds
        const bW  = Math.max(sx2-sx1+exp*2, 1)
        const bH  = Math.max(sy2-sy1+exp*2, 1)
        const pad = Math.max(bW, bH) * 0.1
        const mx1 = Math.min(cb.min[0], sx1-exp) - pad
        const my1 = Math.min(cb.min[1], sy1-exp) - pad
        const mx2 = Math.max(cb.max[0], sx2+exp) + pad
        const my2 = Math.max(cb.max[1], sy2+exp) + pad

        ctx.save()
        ctx.translate(transform.x, transform.y + rect.height)
        ctx.scale(transform.scale, -transform.scale)
        const px2 = (n: number) => n / transform.scale

        // 外部遮罩：大矩形減去裁切外塆（用 compositing）
        ctx.globalCompositeOperation = 'source-over'
        // 畫天地大大矩形（深色性邊遮罩）
        ctx.fillStyle = 'rgba(0,0,0,0.52)'
        ctx.beginPath()
        ctx.rect(mx1, my1, mx2-mx1, my2-my1)  // 外層大矩形（CCW 若透明背景）
        // 內層：裁切外塆所在区域（抖泄效果，evenodd 規則）
        ctx.moveTo(previewPoly[0][0], previewPoly[0][1])
        for (let i = 1; i < previewPoly.length; i++) ctx.lineTo(previewPoly[i][0], previewPoly[i][1])
        ctx.closePath()
        ctx.fill('evenodd')

        // 裁切外塆號記諮：橘色虛線
        ctx.strokeStyle = '#ff8c00'
        ctx.lineWidth   = px2(2.5)
        ctx.setLineDash([px2(10), px2(5)])
        ctx.beginPath()
        ctx.moveTo(previewPoly[0][0], previewPoly[0][1])
        for (let i = 1; i < previewPoly.length; i++) ctx.lineTo(previewPoly[i][0], previewPoly[i][1])
        ctx.closePath()
        ctx.stroke()
        ctx.setLineDash([])

        // 頂點小圓點
        ctx.fillStyle = '#ff8c00'
        const cs = px2(4)
        previewPoly.forEach(([cx, cy]) => {
          ctx.beginPath()
          ctx.arc(cx, cy, cs, 0, 2*Math.PI)
          ctx.fill()
        })

        ctx.restore()

        // 標籤（螢幕座標）
        ctx.save()
        ctx.font = 'bold 12px "Microsoft JhengHei","Calibri",sans-serif'
        ctx.fillStyle = '#ff8c00'
        const modeLabel = isConvexHull ? 'ConvexHull' : 'Bounding'
        ctx.fillText(`▣ 裁切預覽 [${modeLabel}]  向外 ±${exp} mm`, 12, rect.height - 12)
        ctx.restore()
      }
    }
  }, [data, transform, layerModes, visibleComps, visibleNets, signalNets, expansionMm, extentType, segmentCuts, cleanupOverlay, removedGeometry, dimBase, differenceKind, differenceLayer, getLayerColor, getStackupLayers, computeContentBounds])

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
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX-transform.x, y: e.clientY-transform.y })
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setTransform(prev => ({ ...prev, x: e.clientX-dragStart.x, y: e.clientY-dragStart.y }))
  }
  const handleMouseUp = () => setIsDragging(false)

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
        style={{ flex:1, position:'relative', overflow:'hidden', minWidth:0 }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas ref={canvasRef} style={{ cursor: isDragging ? 'grabbing' : 'grab', display: 'block' }} />

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

          {/* 面板主體（panelOpen 時顯示） */}
          {panelOpen && (
            <div
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
                  type="text" placeholder="搜尋元件…" value={compFilter}
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
                  type="text" placeholder="搜尋網路…" value={netFilter}
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
