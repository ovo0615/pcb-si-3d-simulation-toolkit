// S 參數曲線圖（純 SVG，無外部相依）— 功能3 電路串接結果檢視
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'

export interface SParamSeries {
  label: string
  color: string
  freq: number[]   // GHz
  db: number[]     // dB
}

interface Props {
  series: SParamSeries[]
  height?: number
  interactive?: boolean
}

interface ViewRange {
  fMin: number
  fMax: number
  dMin: number
  dMax: number
}

type AxisMode = 'xy' | 'x' | 'y'
type YPreset = 'auto' | '20' | '40' | '80'

interface HoverValue {
  label: string
  color: string
  db: number
}

interface HoverState {
  freq: number
  svgX: number
  values: HoverValue[]
}

const W = 920
const PAD = { left: 72, right: 18, top: 12, bottom: 42 }

function normalizedRange(min: number, max: number, fallbackSpan: number): [number, number] {
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) return [min, max]
  const center = Number.isFinite(min) ? min : 0
  return [center - fallbackSpan / 2, center + fallbackSpan / 2]
}

export default function SParamChart({ series, height = 220, interactive = false }: Props) {
  const clipId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ x: number, y: number, view: ViewRange } | null>(null)
  const [axisMode, setAxisMode] = useState<AxisMode>('xy')
  const [yPreset, setYPreset] = useState<YPreset>('auto')
  const [view, setView] = useState<ViewRange | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  const validSeries = useMemo(
    () => series.map(item => ({
      ...item,
      points: item.freq
        .map((freq, index) => ({ freq, db: item.db[index] }))
        .filter(point => Number.isFinite(point.freq) && Number.isFinite(point.db)),
    })).filter(item => item.points.length > 0),
    [series],
  )

  const autoView = useMemo<ViewRange>(() => {
    const allF = validSeries.flatMap(item => item.points.map(point => point.freq))
    const allD = validSeries.flatMap(item => item.points.map(point => point.db))
    const [rawFMin, rawFMax] = normalizedRange(Math.min(...allF), Math.max(...allF), 1)
    let dMax = Math.min(Math.ceil(Math.max(...allD) / 5) * 5, 5)
    let dMin = Math.floor(Math.min(...allD) / 5) * 5
    if (!Number.isFinite(dMin) || !Number.isFinite(dMax)) {
      dMin = -100
      dMax = 0
    }
    if (dMax - dMin < 5) dMin = dMax - 5
    return { fMin: rawFMin, fMax: rawFMax, dMin, dMax }
  }, [validSeries])

  const dataSignature = useMemo(
    () => validSeries.map(item =>
      `${item.label}:${item.points.length}:${item.points[0]?.freq}:${item.points[item.points.length - 1]?.freq}`).join('|'),
    [validSeries],
  )

  useEffect(() => {
    setView(null)
    setYPreset('auto')
    setHover(null)
  }, [dataSignature])

  if (validSeries.length === 0) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--faint)', fontSize: 12, border: '1px dashed var(--border)',
        borderRadius: 6,
      }}>
        選擇 Port 後按「加入曲線」
      </div>
    )
  }

  const activeView = view ?? autoView
  const H = Math.max(height, 160)
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (freq: number) => PAD.left + (freq - activeView.fMin) / (activeView.fMax - activeView.fMin) * plotW
  const y = (db: number) => PAD.top + (activeView.dMax - db) / (activeView.dMax - activeView.dMin) * plotH
  const xticks = Array.from({ length: 7 }, (_, index) =>
    activeView.fMin + (activeView.fMax - activeView.fMin) * index / 6)
  const yticks = Array.from({ length: 7 }, (_, index) =>
    activeView.dMin + (activeView.dMax - activeView.dMin) * index / 6)
  const clippedBelow = yPreset !== 'auto' && validSeries.some(item =>
    item.points.some(point => point.db < activeView.dMin))
  const clippedAbove = yPreset !== 'auto' && validSeries.some(item =>
    item.points.some(point => point.db > activeView.dMax))

  const zoomAt = (event: WheelEvent<SVGSVGElement>) => {
    if (!interactive) return
    event.preventDefault()
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const svgX = (event.clientX - rect.left) / rect.width * W
    const svgY = (event.clientY - rect.top) / rect.height * H
    const fx = activeView.fMin + (svgX - PAD.left) / plotW * (activeView.fMax - activeView.fMin)
    const dy = activeView.dMax - (svgY - PAD.top) / plotH * (activeView.dMax - activeView.dMin)
    const modeFactor = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? rect.height : 1)
    const normalizedDelta = Math.max(-100, Math.min(100, event.deltaY * modeFactor))
    // 一般滑鼠一格約 6%，觸控板則依 delta 連續縮放；單次事件上限同為 6%。
    const scale = Math.exp(normalizedDelta * 0.0006)
    setYPreset('auto')
    setView(current => {
      const source = current ?? autoView
      const next = { ...source }
      if (axisMode !== 'y') {
        next.fMin = fx - (fx - source.fMin) * scale
        next.fMax = fx + (source.fMax - fx) * scale
      }
      if (axisMode !== 'x') {
        next.dMin = dy - (dy - source.dMin) * scale
        next.dMax = dy + (source.dMax - dy) * scale
      }
      return next
    })
  }

  const beginPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!interactive || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, view: { ...activeView } }
  }

  const pan = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    const rect = svgRef.current?.getBoundingClientRect()
    if (!interactive || !rect) return
    const svgX = (event.clientX - rect.left) / rect.width * W
    if (svgX >= PAD.left && svgX <= PAD.left + plotW) {
      const frequency = activeView.fMin
        + (svgX - PAD.left) / plotW * (activeView.fMax - activeView.fMin)
      const values = validSeries.map(item => {
        let nearest = item.points[0]
        for (const point of item.points) {
          if (Math.abs(point.freq - frequency) < Math.abs(nearest.freq - frequency)) nearest = point
        }
        return { label: item.label, color: item.color, db: nearest.db }
      })
      setHover({ freq: frequency, svgX, values })
    } else {
      setHover(null)
    }
    if (!drag) return
    const dx = (event.clientX - drag.x) / rect.width * W / plotW
    const dy = (event.clientY - drag.y) / rect.height * H / plotH
    const fShift = -dx * (drag.view.fMax - drag.view.fMin)
    const dShift = dy * (drag.view.dMax - drag.view.dMin)
    setView({
      fMin: drag.view.fMin + (axisMode === 'y' ? 0 : fShift),
      fMax: drag.view.fMax + (axisMode === 'y' ? 0 : fShift),
      dMin: drag.view.dMin + (axisMode === 'x' ? 0 : dShift),
      dMax: drag.view.dMax + (axisMode === 'x' ? 0 : dShift),
    })
    setYPreset('auto')
  }

  const endPan = () => {
    dragRef.current = null
  }

  const applyYPreset = (preset: YPreset) => {
    setYPreset(preset)
    if (preset === 'auto') {
      setView(current => current
        ? { ...current, dMin: autoView.dMin, dMax: autoView.dMax }
        : null)
      return
    }
    const magnitude = Number(preset)
    setView(current => ({
      ...(current ?? autoView),
      dMin: -magnitude,
      dMax: 0,
    }))
  }

  const fitAll = () => {
    setView(null)
    setYPreset('auto')
    setHover(null)
  }

  const tooltipWidth = 280
  const tooltipHeight = 28 + Math.min(hover?.values.length ?? 0, 8) * 19
  const tooltipX = hover
    ? Math.min(Math.max(PAD.left + 6, hover.svgX + 12), PAD.left + plotW - tooltipWidth - 6)
    : PAD.left

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8, marginBottom: 5,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: interactive ? 13 : 11 }}>
          {validSeries.map(item => (
            <span key={item.label} style={{ color: item.color, fontWeight: 600 }}>— {item.label}</span>
          ))}
        </div>
        {interactive && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, fontSize: 12 }}>
            <span style={{ color: 'var(--faint)' }}>縮放／平移軸：</span>
            {(['xy', 'x', 'y'] as AxisMode[]).map(mode => (
              <button key={mode} type="button" className={`btn ${axisMode === mode ? 'btn--primary' : ''}`}
                onClick={() => setAxisMode(mode)} style={{ minWidth: 42, padding: '4px 8px' }}>
                {mode.toUpperCase()}
              </button>
            ))}
            <span style={{ color: 'var(--faint)', marginLeft: 5 }}>Y 軸：</span>
            {([
              ['20', '0…−20'],
              ['40', '0…−40'],
              ['80', '0…−80'],
              ['auto', 'Auto'],
            ] as [YPreset, string][]).map(([preset, label]) => (
              <button key={preset} type="button"
                className={`btn ${yPreset === preset ? 'btn--primary' : ''}`}
                onClick={() => applyYPreset(preset)}
                style={{ padding: '4px 7px' }}>
                {label}
              </button>
            ))}
            <button type="button" className="btn" onClick={fitAll}
              style={{ padding: '4px 9px' }}>Fit All</button>
          </div>
        )}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        onWheel={zoomAt} onPointerDown={beginPan} onPointerMove={pan}
        onPointerUp={endPan} onPointerCancel={endPan} onPointerLeave={endPan}
        style={{
          width: '100%', background: '#0c0e12', borderRadius: 6,
          cursor: interactive ? (dragRef.current ? 'grabbing' : 'grab') : 'default',
          touchAction: 'none', userSelect: 'none',
        }}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        {xticks.map((freq, index) => (
          <g key={`x${index}`}>
            <line x1={x(freq)} y1={PAD.top} x2={x(freq)} y2={PAD.top + plotH}
              stroke="rgba(255,255,255,0.09)" strokeWidth={1} />
            <text x={x(freq)} y={H - 15} fill="#b8c7d9" fontSize={interactive ? 13 : 11} textAnchor="middle">
              {Math.abs(freq) >= 10 ? freq.toFixed(1) : freq.toFixed(2)}
            </text>
          </g>
        ))}
        {yticks.map((db, index) => (
          <g key={`y${index}`}>
            <line x1={PAD.left} y1={y(db)} x2={PAD.left + plotW} y2={y(db)}
              stroke="rgba(255,255,255,0.09)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(db) + 4} fill="#b8c7d9" fontSize={interactive ? 13 : 11} textAnchor="end">
              {db.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={PAD.left + plotW / 2} y={H - 2} fill="#8190a5"
          fontSize={interactive ? 13 : 10} textAnchor="middle">GHz</text>
        <text x={16} y={PAD.top + plotH / 2} fill="#8190a5"
          fontSize={interactive ? 13 : 10} textAnchor="middle"
          transform={`rotate(-90 16 ${PAD.top + plotH / 2})`}>dB</text>
        <g clipPath={`url(#${clipId})`}>
          {validSeries.map(item => {
            const points = item.points.map(point => `${x(point.freq).toFixed(2)},${y(point.db).toFixed(2)}`).join(' ')
            return item.points.length === 1
              ? <circle key={item.label} cx={x(item.points[0].freq)} cy={y(item.points[0].db)} r={3} fill={item.color} />
              : <polyline key={item.label} points={points} fill="none" stroke={item.color}
                strokeWidth={interactive ? 2.2 : 1.8} vectorEffect="non-scaling-stroke" />
          })}
          {interactive && hover && (
            <line x1={hover.svgX} y1={PAD.top} x2={hover.svgX} y2={PAD.top + plotH}
              stroke="rgba(255,255,255,0.62)" strokeWidth={1}
              strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          )}
        </g>
        {interactive && hover && (
          <g pointerEvents="none">
            <rect x={tooltipX} y={PAD.top + 8} width={tooltipWidth}
              height={tooltipHeight} rx={6}
              fill="rgba(18,22,29,0.96)" stroke="rgba(255,255,255,0.24)" />
            <text x={tooltipX + 10} y={PAD.top + 27}
              fill="#ffffff" fontSize={13} fontWeight={700}>
              {hover.freq.toFixed(5)} GHz
            </text>
            {hover.values.slice(0, 8).map((item, index) => (
              <g key={item.label}>
                <circle cx={tooltipX + 12} cy={PAD.top + 46 + index * 19}
                  r={3.5} fill={item.color} />
                <text x={tooltipX + 22} y={PAD.top + 50 + index * 19}
                  fill={item.color} fontSize={12}>
                  {item.label.length > 31 ? item.label.slice(0, 30) + '…' : item.label}
                </text>
                <text x={tooltipX + tooltipWidth - 10}
                  y={PAD.top + 50 + index * 19}
                  fill="#ffffff" fontSize={12} textAnchor="end">
                  {item.db.toFixed(3)} dB
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      {interactive && (
        <div style={{ color: clippedBelow || clippedAbove ? '#f0b429' : 'var(--faint)', fontSize: 12, marginTop: 5, textAlign: 'center' }}>
          {clippedBelow || clippedAbove
            ? `目前 Y 軸預設已裁掉範圍外資料${clippedBelow ? '（下方）' : ''}${clippedAbove ? '（上方）' : ''}；按 Auto 或 Fit All 查看全部。`
            : '滾輪約每格縮放 6%；按住左鍵拖曳平移；游標可讀取所有曲線。'}
        </div>
      )}
    </div>
  )
}
