// Q2D 截面阻抗與 TDR 剖面的並排對照。
//
//
// 這一塊刻意**不判斷誰對誰錯**。兩種方法對不上的原因有三類，工具只把可查證的
// 東西擺出來：兩者疊在同一條距離軸上、TDR 在該處平均掉了多寬、以及該截面上小於
// 那個寬度的結構。結論留給看的人——工具一旦說「TDR 錯了」，使用者就不會再去看
// 第三種可能。

import { useMemo } from 'react'

const TEXT = '#d1dbe7'
const HEADING = '#e8eef5'
const RULE = '#27313d'
const HINT: React.CSSProperties = { color: '#9fb0c3', fontSize: 11.5, lineHeight: 1.55 }
const Q2D_COLOR = '#f0a13a'
const TDR_COLOR = '#3fc7d4'
const WARN = '#e0b341'

const cell: React.CSSProperties = {
  padding: '3px 6px',
  borderBottom: `1px solid ${RULE}`,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  color: TEXT,
}
const headCell: React.CSSProperties = {
  ...cell, color: '#9fb0c3', background: '#19212b', fontWeight: 700,
}

export interface ComparisonFeature {
  layer: string
  net: string
  role: string
  width_mm: number
  distance_to_signal_mm: number | null
  is_via: boolean
}

export interface ComparisonRow {
  name: string
  matched: boolean
  reason?: string
  note?: string
  distance_mm?: number
  coordinate_mm?: number
  conductor?: string
  q2d_ohm?: number
  tdr_ohm?: number | null
  delta_ohm?: number
  relative?: number | null
  resolution_mm?: number
  tdr_min_ohm?: number
  tdr_max_ohm?: number
  window_spread?: number
  unstable?: boolean
  features?: ComparisonFeature[]
}

export interface ComparisonResult {
  rows: ComparisonRow[]
  summary: {
    count: number
    comparable: number
    unstable?: number
    resolution_mm: number
    median_delta_ohm?: number
    worst?: string
    worst_relative?: number
  }
  possible_causes: { cause: string; how_to_check: string }[]
}

interface Props {
  result: ComparisonResult
  tdrDistanceMm: number[]
  tdrImpedanceOhm: number[]
}

export default function CrossSectionComparison({
  result, tdrDistanceMm, tdrImpedanceOhm,
}: Props) {
  const matched = result.rows.filter(
    r => r.matched && r.tdr_ohm != null && r.q2d_ohm != null)

  const chart = useMemo(() => {
    if (tdrDistanceMm.length < 2) return null
    const W = 480, H = 210, L = 42, R = 10, T = 10, B = 26
    const xMin = tdrDistanceMm[0]
    const xMax = tdrDistanceMm[tdrDistanceMm.length - 1]
    // 縱軸要同時容得下兩種方法的值，否則差最多的那個點會被切在框外——
    // 而那個點正是最需要看到的。
    const all = [...tdrImpedanceOhm, ...matched.map(r => r.q2d_ohm as number)]
    const spread = Math.max(...all) - Math.min(...all)
    const pad = Math.max(0.5, spread * 0.15)
    const yMin = Math.min(...all) - pad
    const yMax = Math.max(...all) + pad
    return {
      W, H, L, R, T, B, xMin, xMax, yMin, yMax,
      px: (v: number) => L + (v - xMin) / Math.max(xMax - xMin, 1e-9) * (W - L - R),
      py: (v: number) => T + (yMax - v) / Math.max(yMax - yMin, 1e-9) * (H - T - B),
    }
  }, [tdrDistanceMm, tdrImpedanceOhm, matched])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10,
                  fontSize: 12, color: TEXT }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: HEADING }}>
          與 TDR 剖面對照
        </div>
        <div style={{ ...HINT, marginTop: 2 }}>
          橫帶寬度＝TDR 的空間解析度（{result.summary.resolution_mm.toFixed(2)} mm），
          也就是 TDR 在該處平均掉的範圍。
        </div>
      </div>

      {chart && (
        <svg viewBox={`0 0 ${chart.W} ${chart.H}`} style={{
          width: '100%', background: '#0c0e12',
          border: `1px solid ${RULE}`, borderRadius: 6,
        }}>
          {[0, 0.25, 0.5, 0.75, 1].map(fraction => {
            const value = chart.yMin + (chart.yMax - chart.yMin) * fraction
            return (
              <g key={fraction}>
                <line x1={chart.L} x2={chart.W - chart.R}
                  y1={chart.py(value)} y2={chart.py(value)}
                  stroke={RULE} strokeWidth={1} />
                <text x={chart.L - 6} y={chart.py(value) + 4} fill="#8fa1b5"
                  fontSize={11.5} textAnchor="end">{value.toFixed(1)}</text>
              </g>
            )
          })}
          <polyline
            points={tdrDistanceMm.map((d, i) =>
              `${chart.px(d)},${chart.py(tdrImpedanceOhm[i])}`).join(' ')}
            fill="none" stroke={TDR_COLOR} strokeWidth={1.4} />
          {matched.map(row => {
            const d = row.distance_mm as number
            const half = (row.resolution_mm || 0) / 2
            const zTdr = row.tdr_ohm as number
            const zQ2d = row.q2d_ohm as number
            return (
              <g key={row.name}>
                <line x1={chart.px(d - half)} x2={chart.px(d + half)}
                  y1={chart.py(zTdr)} y2={chart.py(zTdr)}
                  stroke={TDR_COLOR} strokeWidth={5} strokeOpacity={0.35}
                  strokeLinecap="round" />
                <line x1={chart.px(d)} x2={chart.px(d)}
                  y1={chart.py(zTdr)} y2={chart.py(zQ2d)}
                  stroke={Q2D_COLOR} strokeWidth={1} strokeDasharray="2 2" />
                <circle cx={chart.px(d)} cy={chart.py(zQ2d)} r={3.6} fill={Q2D_COLOR}>
                  <title>{`${row.name}\nQ2D ${zQ2d.toFixed(3)} Ω\nTDR ${zTdr.toFixed(3)} Ω`}</title>
                </circle>
              </g>
            )
          })}
          <text x={chart.L} y={chart.H - 7} fill="#9fb0c3" fontSize={12}>
            {chart.xMin.toFixed(0)} mm
          </text>
          <text x={chart.W - chart.R} y={chart.H - 7} fill="#9fb0c3" fontSize={12}
            textAnchor="end">{chart.xMax.toFixed(0)} mm</text>
          <text x={chart.W - chart.R} y={chart.T + 13} fill={Q2D_COLOR}
            fontSize={13} fontWeight={700} textAnchor="end">● Q2D 截面</text>
          <text x={chart.W - chart.R} y={chart.T + 30} fill={TDR_COLOR}
            fontSize={13} fontWeight={700} textAnchor="end">— TDR（粗帶＝解析度）</text>
        </svg>
      )}

      {result.rows.filter(r => r.unstable).map(row => (
        <div key={`unstable-${row.name}`} style={{
          fontSize: 11.5, padding: '6px 10px', borderRadius: 8, lineHeight: 1.6,
          color: '#ffd8a8', background: 'rgba(224, 179, 65, 0.12)',
          border: '1px solid rgba(224, 179, 65, 0.35)',
        }}>
          <b>{row.name}</b>　{row.note}
        </div>
      ))}

      {result.summary.comparable > 0 && (
        <div style={{
          fontSize: 11.5, padding: '6px 10px', borderRadius: 8, lineHeight: 1.6,
          color: '#c8e6c9', background: 'rgba(126, 231, 135, 0.10)',
          border: '1px solid rgba(126, 231, 135, 0.28)',
        }}>
          {result.summary.comparable} 條切線對得到 TDR 曲線，
          中位差 {(result.summary.median_delta_ohm ?? 0).toFixed(4)} Ω。
          差最多的是 {result.summary.worst}
          （{((result.summary.worst_relative ?? 0) * 100).toFixed(2)}%）。
          {(result.summary.unstable ?? 0) > 0
            ? `另有 ${result.summary.unstable} 條落在劇變邊緣，沒有列入統計。` : ''}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              <th style={headCell}>切線</th>
              <th style={{ ...headCell, textAlign: 'right' }}>距起點 mm</th>
              <th style={{ ...headCell, textAlign: 'right' }}>Q2D</th>
              <th style={{ ...headCell, textAlign: 'right' }}>TDR（窗內平均）</th>
              <th style={{ ...headCell, textAlign: 'right' }}>差</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(row => (
              <tr key={row.name}>
                <td style={cell}>{row.name}</td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {row.distance_mm != null ? row.distance_mm.toFixed(2) : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {row.q2d_ohm != null ? `${row.q2d_ohm.toFixed(3)} Ω` : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {row.tdr_ohm != null ? `${row.tdr_ohm.toFixed(3)} Ω` : '—'}
                  {row.tdr_min_ohm != null && row.tdr_max_ohm != null && (
                    <div style={{ color: '#9fb0c3', fontSize: 10.5 }}>
                      窗內 {row.tdr_min_ohm.toFixed(1)}～{row.tdr_max_ohm.toFixed(1)}
                    </div>
                  )}
                </td>
                <td style={{
                  ...cell, textAlign: 'right', whiteSpace: 'normal',
                  color: row.relative != null && Math.abs(row.relative) >= 0.005
                    ? WARN : undefined,
                }}>
                  {row.unstable
                    ? '不適合比較'
                    : row.delta_ohm != null
                      ? `${row.delta_ohm > 0 ? '+' : ''}${row.delta_ohm.toFixed(3)}`
                        + `（${((row.relative ?? 0) * 100).toFixed(2)}%）`
                      : (row.reason || row.note || '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.rows.filter(row => (row.features || []).length > 0).map(row => (
        <div key={`features-${row.name}`}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>
            {row.name}：這個截面上小於 TDR 解析度的結構
          </div>
          <div style={{ ...HINT, marginBottom: 4 }}>
            這是證據不是結論，夠不夠解釋那個差異由你判斷。
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={headCell}>層</th>
                <th style={headCell}>Net</th>
                <th style={{ ...headCell, textAlign: 'right' }}>寬 mm</th>
                <th style={{ ...headCell, textAlign: 'right' }}>離訊號 mm</th>
              </tr>
            </thead>
            <tbody>
              {(row.features || []).slice(0, 8).map((feature, index) => (
                <tr key={index}>
                  <td style={cell}>{feature.layer}</td>
                  <td style={cell}>
                    {feature.net || '（無網路）'}
                    {feature.is_via && <span style={{ color: WARN }}>　Via</span>}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {feature.width_mm.toFixed(3)}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {feature.distance_to_signal_mm != null
                      ? feature.distance_to_signal_mm.toFixed(3) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div>
        <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>
          對不上的三種可能
        </div>
        <div style={{ ...HINT, marginBottom: 4 }}>
          不排序——排序等於暗示哪個比較可能，而那需要工程判斷，不是工具能給的。
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <tbody>
            {result.possible_causes.map((item, index) => (
              <tr key={index}>
                <td style={{ ...cell, whiteSpace: 'normal' }}>{item.cause}</td>
                <td style={{ ...cell, whiteSpace: 'normal', color: '#9fb0c3' }}>
                  {item.how_to_check}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
