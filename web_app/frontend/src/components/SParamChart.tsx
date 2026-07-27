// S 參數曲線圖（純 SVG，無外部相依）— 功能3 電路串接結果檢視
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

export interface SParamSeries {
  label: string
  color: string
  freq: number[]   // GHz
  db: number[]     // dB
}

interface Props {
  series: SParamSeries[]
  height?: number
}

const W = 460
const PAD = { left: 46, right: 10, top: 8, bottom: 26 }

export default function SParamChart({ series, height = 220 }: Props) {
  if (series.length === 0 || series.every(s => s.freq.length === 0)) {
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

  const H = height
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const allF = series.flatMap(s => s.freq)
  const allD = series.flatMap(s => s.db)
  const fMin = Math.min(...allF)
  const fMax = Math.max(...allF)
  let dMin = Math.min(...allD)
  let dMax = Math.max(...allD)
  // y 軸取整並留邊界（dB 通常是負值）
  dMax = Math.min(Math.ceil(dMax / 5) * 5 + 0, 5)
  dMin = Math.floor(dMin / 5) * 5
  if (dMax - dMin < 5) dMin = dMax - 5

  const x = (f: number) => PAD.left + (fMax === fMin ? plotW / 2 : (f - fMin) / (fMax - fMin) * plotW)
  const y = (d: number) => PAD.top + (dMax - d) / (dMax - dMin) * plotH

  const xticks = Array.from({ length: 6 }, (_, i) => fMin + (fMax - fMin) * i / 5)
  const yticks = Array.from({ length: 6 }, (_, i) => dMin + (dMax - dMin) * i / 5)

  return (
    <div>
      {/* 圖例 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, marginBottom: 2 }}>
        {series.map(s => (
          <span key={s.label} style={{ color: s.color, fontWeight: 600 }}>— {s.label}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', background: '#0c0e12', borderRadius: 6 }}>
        {/* 格線 */}
        {xticks.map((f, i) => (
          <g key={`x${i}`}>
            <line x1={x(f)} y1={PAD.top} x2={x(f)} y2={PAD.top + plotH}
              stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
            <text x={x(f)} y={H - 8} fill="#9fb0c3" fontSize={9} textAnchor="middle">
              {f >= 10 ? f.toFixed(0) : f.toFixed(1)}
            </text>
          </g>
        ))}
        {yticks.map((d, i) => (
          <g key={`y${i}`}>
            <line x1={PAD.left} y1={y(d)} x2={PAD.left + plotW} y2={y(d)}
              stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
            <text x={PAD.left - 5} y={y(d) + 3} fill="#9fb0c3" fontSize={9} textAnchor="end">
              {d.toFixed(0)}
            </text>
          </g>
        ))}
        {/* 軸標籤 */}
        <text x={PAD.left + plotW / 2} y={H - 0.5} fill="#5c677d" fontSize={9} textAnchor="middle">GHz</text>
        <text x={10} y={PAD.top + plotH / 2} fill="#5c677d" fontSize={9} textAnchor="middle"
          transform={`rotate(-90 10 ${PAD.top + plotH / 2})`}>dB</text>
        {/* 曲線 */}
        {series.map(s => {
          const pts = s.freq.map((f, i) => `${x(f).toFixed(1)},${y(Math.max(Math.min(s.db[i], dMax), dMin)).toFixed(1)}`).join(' ')
          return s.freq.length === 1
            ? <circle key={s.label} cx={x(s.freq[0])} cy={y(s.db[0])} r={3} fill={s.color} />
            : <polyline key={s.label} points={pts} fill="none" stroke={s.color} strokeWidth={1.6} />
        })}
      </svg>
    </div>
  )
}
