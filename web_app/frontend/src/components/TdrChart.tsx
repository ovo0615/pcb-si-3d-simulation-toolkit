// TDR 阻抗－距離曲線（純 SVG，無外部相依）
//
// 刻意不做成互動圖表：TDR 分頁的重點是「劇變在板上哪裡」，曲線只是佐證。
// 劇變位置用垂直虛線標在曲線上，與 Layout 標記共用同一組編號。
//
// 尺寸策略：量測容器實際寬度、高度由外部指定，SVG 以 1:1 像素繪製。
// 先前用固定 viewBox 等比縮放，寬螢幕上圖會被撐到六百多 px 高，整個
// TDR 分頁因此出現捲軸，報告快照截不完整。
import { useEffect, useRef, useState } from 'react'

export interface TdrChartMarker {
  distance_mm: number
  label: string
  excluded: boolean
}

interface TdrChartProps {
  distanceMm: number[]
  impedanceOhm: number[]
  markers?: TdrChartMarker[]
  /** 通道實體長度（mm）；有值時畫一條界線，超過的部分是遠端反射的鏡像。 */
  pathLengthMm?: number | null
  /** 顯示上限（mm）：量測路的端點之後是夾持與再反射，超過就不畫。 */
  xMaxMm?: number | null
  height?: number
}

const FONT = '"Calibri", "Microsoft JhengHei", sans-serif'

export default function TdrChart({
  distanceMm, impedanceOhm, markers = [], pathLengthMm = null,
  xMaxMm = null, height = 240,
}: TdrChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(860)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setWidth(Math.max(420, el.clientWidth))
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const pad = { left: 52, right: 16, top: 18, bottom: 34 }
  const n = Math.min(distanceMm.length, impedanceOhm.length)
  if (n < 2) {
    return (
      <div ref={containerRef}
        style={{ color: '#8fa1b5', fontSize: 12, padding: 12, fontFamily: FONT }}>
        尚無 TDR 曲線資料。
      </div>
    )
  }

  // X 軸只畫到通道長度的 1.5 倍：更遠處是多次反射，畫出來只會壓扁有用區段。
  // 量測路另有更準的上限（端點之後是夾持區），有給就用它。
  const xMaxData = distanceMm[n - 1]
  let xMax = pathLengthMm && pathLengthMm > 0
    ? Math.min(xMaxData, pathLengthMm * 1.5) : xMaxData
  if (xMaxMm && xMaxMm > 0) xMax = Math.min(xMax, xMaxMm)
  const visible: number[] = []
  for (let i = 0; i < n; i++) if (distanceMm[i] <= xMax) visible.push(i)
  if (visible.length < 2) return <div ref={containerRef} />

  const zs = visible.map(i => impedanceOhm[i])
  const zLo = Math.min(...zs)
  // Y 尺度要強韌：開路端附近 Z 發散到 kΩ 級，min/max 縮放會把整段有用
  // 曲線壓成貼地平線。上限取「中位數的 4 倍」與實際最大值的較小者，
  // 超出的曲線裁在頂端格線上（TDR 圖的標準做法）。
  const sorted = [...zs].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const zHi = Math.min(Math.max(...zs), Math.max(4 * median, median + 50))
  const zPad = Math.max((zHi - zLo) * 0.12, 2)
  const yMin = zLo - zPad, yMax = zHi + zPad

  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const sx = (d: number) => pad.left + (d / xMax) * plotW
  const sy = (z: number) => pad.top + (1 - (z - yMin) / (yMax - yMin)) * plotH

  const path = visible
    .map((i, k) => `${k === 0 ? 'M' : 'L'}${sx(distanceMm[i]).toFixed(1)},`
      + `${sy(Math.min(impedanceOhm[i], yMax)).toFixed(1)}`)
    .join(' ')

  // 刻度：X 取 6 格、Y 取 5 格的「好看數字」
  const niceStep = (span: number, target: number) => {
    const raw = span / target
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return m * mag
    return 10 * mag
  }
  const xStep = niceStep(xMax, 6)
  const yStep = niceStep(yMax - yMin, 5)
  const xTicks: number[] = []
  for (let v = 0; v <= xMax + 1e-9; v += xStep) xTicks.push(v)
  const yTicks: number[] = []
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) yTicks.push(v)

  return (
    <div ref={containerRef} style={{ width: '100%', height, overflow: 'hidden' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}>
        <rect x={0} y={0} width={width} height={height} fill="#0c0e12" rx={8} />
        {yTicks.map(v => (
          <g key={`y${v}`}>
            <line x1={pad.left} x2={width - pad.right} y1={sy(v)} y2={sy(v)}
              stroke="#232b36" strokeWidth={1} />
            <text x={pad.left - 7} y={sy(v) + 4} textAnchor="end"
              fontSize={11} fill="#8fa1b5" fontFamily={FONT}>{v.toFixed(0)}</text>
          </g>
        ))}
        {xTicks.map(v => (
          <g key={`x${v}`}>
            <line y1={pad.top} y2={height - pad.bottom} x1={sx(v)} x2={sx(v)}
              stroke="#1a212b" strokeWidth={1} />
            <text y={height - pad.bottom + 16} x={sx(v)} textAnchor="middle"
              fontSize={11} fill="#8fa1b5" fontFamily={FONT}>{v.toFixed(0)}</text>
          </g>
        ))}
        <text x={width / 2} y={height - 6} textAnchor="middle" fontSize={11.5}
          fill="#9fb0c3" fontFamily={FONT}>距離（mm）</text>
        <text x={14} y={height / 2} textAnchor="middle" fontSize={11.5}
          fill="#9fb0c3" fontFamily={FONT}
          transform={`rotate(-90 14 ${height / 2})`}>阻抗（Ω）</text>

        {/* 通道終點界線：右邊的曲線是遠端反射鏡像，不是板上的東西 */}
        {pathLengthMm && pathLengthMm > 0 && pathLengthMm <= xMax && (
          <g>
            <line x1={sx(pathLengthMm)} x2={sx(pathLengthMm)}
              y1={pad.top} y2={height - pad.bottom}
              stroke="#4a90d9" strokeWidth={1.4} strokeDasharray="7 4" />
            <text x={sx(pathLengthMm) + 4} y={pad.top + 12} fontSize={10.5}
              fill="#6ea8dd" fontFamily={FONT}>通道終點</text>
          </g>
        )}

        {/* 標籤以三層錯位排開：劇變常擠在同一小段距離內，全放同一列會疊字 */}
        {markers.map((marker, index) => marker.distance_mm <= xMax && (
          <g key={marker.label}>
            <line x1={sx(marker.distance_mm)} x2={sx(marker.distance_mm)}
              y1={pad.top} y2={height - pad.bottom}
              stroke={marker.excluded ? 'rgba(176,186,198,0.6)' : 'rgba(255,82,137,0.85)'}
              strokeWidth={1.4} strokeDasharray={marker.excluded ? '3 4' : '5 3'} />
            <text x={sx(marker.distance_mm)} y={pad.top + 10 + (index % 3) * 13}
              textAnchor="middle" fontSize={10.5} fontWeight={700} fontFamily={FONT}
              stroke="#0c0e12" strokeWidth={3} paintOrder="stroke"
              fill={marker.excluded ? '#aab4c0' : '#ff8ab0'}>{marker.label}</text>
          </g>
        ))}

        <path d={path} fill="none" stroke="#00e5ff" strokeWidth={1.8} />
      </svg>
    </div>
  )
}
