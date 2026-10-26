// Q2D 截面阻抗與 TDR 剖面的並排對照。
//
//
// 這一塊刻意**不判斷誰對誰錯**。兩種方法對不上的原因有三類，工具只把可查證的
// 東西擺出來：兩者疊在同一條距離軸上、TDR 在該處平均掉了多寬、以及該截面上小於
// 那個寬度的結構。結論留給看的人——工具一旦說「TDR 錯了」，使用者就不會再去看
// 第三種可能。

import { useMemo } from 'react'
import { pickText } from '../backendFields'
import { useLengthT as useT } from '../useLengthT'
import { useLengthUnit } from '../lengthContext'
import { impedanceRange, minMax } from './chartScale'

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
  /** 這條切線的座標被同一條走線跨過幾次（等長繞線上很常見）。 */
  crossings?: number
  /** 跨過不只一次——後端挑了離切線框中心最近的那一次，可能挑錯折。
   *  這是「這個數字對到哪裡」的問題，跟差多少無關，所以有值的列也要標。 */
  ambiguous?: boolean
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
  /** 與上方 TDR 圖同一組截斷條件；不給就畫完整條曲線（見下方 useMemo）。 */
  pathLengthMm?: number | null
  xMaxMm?: number | null
}

export default function CrossSectionComparison({
  result, tdrDistanceMm, tdrImpedanceOhm,
  pathLengthMm = null, xMaxMm = null,
}: Props) {
  const { t, lang } = useT()
  const { unit, length } = useLengthUnit()
  const tx = t.crossCompare
  const matched = result.rows.filter(
    r => r.matched && r.tdr_ohm != null && r.q2d_ohm != null)

  const chart = useMemo(() => {
    if (tdrDistanceMm.length < 2) return null
    const W = 480, H = 210, L = 42, R = 10, T = 10, B = 26
    const xMin = tdrDistanceMm[0]
    // X 的截斷條件要跟上面那張 TDR 圖一樣，否則兩張並排的圖橫軸長度不同，
    // 讀起來像兩條不同的曲線。
    let xMax = tdrDistanceMm[tdrDistanceMm.length - 1]
    if (pathLengthMm && pathLengthMm > 0) xMax = Math.min(xMax, pathLengthMm * 1.5)
    if (xMaxMm && xMaxMm > 0) xMax = Math.min(xMax, xMaxMm)
    const visible: number[] = []
    for (let i = 0; i < tdrDistanceMm.length; i++) {
      if (tdrDistanceMm[i] <= xMax
        && Number.isFinite(tdrImpedanceOhm[i])) visible.push(i)
    }
    if (visible.length < 2) return null

    // 橫軸被截斷之後，落在框外的那幾條切線不能照畫——`px` 會算出比畫布還
    // 遠的座標，SVG 不裁切，記號就直接畫到圖框外面（或疊在右邊界上），看起來
    // 像那條切線的阻抗真的長在那裡。畫得出來的才畫，其餘的在圖下說明有幾條。
    const inRange = matched.filter(row => {
      const d = row.distance_mm
      return d != null && d >= xMin && d <= xMax
    })

    // 縱軸：直接 min/max 會被開路端 kΩ 級的發散壓成一條貼底的直線，而這張圖
    // 存在的理由就是讀幾歐姆的差。用 TDR 圖同一支中位數夾持（chartScale），
    // 再把 Q2D 的點納進來——差最多的那個點正是最需要看到的，不能切在框外。
    // 只納入畫得出來的那幾條：被橫軸截掉的點不會出現在圖上，讓它撐開縱軸
    // 只會把留下來的曲線壓扁。
    const base = impedanceRange(visible.map(i => tdrImpedanceOhm[i]))
    const q2d = inRange.map(r => r.q2d_ohm as number).filter(Number.isFinite)
    const { min: qLo, max: qHi } = minMax(q2d)
    let yMin = base.yMin, yMax = base.yMax
    if (q2d.length) {
      const pad = Math.max(0.5, (qHi - qLo) * 0.15)
      yMin = Math.min(yMin, qLo - pad)
      yMax = Math.max(yMax, qHi + pad)
    }
    return {
      W, H, L, R, T, B, xMin, xMax, yMin, yMax, visible,
      rows: inRange, hidden: matched.length - inRange.length,
      px: (v: number) => L + (v - xMin) / Math.max(xMax - xMin, 1e-9) * (W - L - R),
      py: (v: number) => T + (yMax - v) / Math.max(yMax - yMin, 1e-9) * (H - T - B),
    }
  }, [tdrDistanceMm, tdrImpedanceOhm, matched, pathLengthMm, xMaxMm])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10,
                  fontSize: 12, color: TEXT }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: HEADING }}>
          {tx.heading}
        </div>
        <div style={{ ...HINT, marginTop: 2 }}>
          {tx.bandHint(length(result.summary.resolution_mm))}
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
          {/* 超出上限的點裁在頂端格線上（與 TDR 圖同一種畫法），
              不要讓一次發散把整條曲線拉出框外。 */}
          <polyline
            points={chart.visible.map(i =>
              `${chart.px(tdrDistanceMm[i])},`
              + `${chart.py(Math.min(tdrImpedanceOhm[i], chart.yMax))}`).join(' ')}
            fill="none" stroke={TDR_COLOR} strokeWidth={1.4} />
          {chart.rows.map(row => {
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
                {/* 對到哪一折不確定的點畫一圈外環：位置本身有疑問，
                    不能跟位置明確的點長得一模一樣。 */}
                {row.ambiguous && (
                  <circle cx={chart.px(d)} cy={chart.py(zQ2d)} r={6.4}
                    fill="none" stroke={WARN} strokeWidth={1.4}
                    strokeDasharray="2 2" />
                )}
                <circle cx={chart.px(d)} cy={chart.py(zQ2d)} r={3.6} fill={Q2D_COLOR}>
                  <title>{`${row.name}\nQ2D ${zQ2d.toFixed(3)} Ω\nTDR ${zTdr.toFixed(3)} Ω`
                    + (row.ambiguous
                      ? '\n' + tx.crossingsTip(row.crossings ?? 2) : '')}</title>
                </circle>
              </g>
            )
          })}
          <text x={chart.L} y={chart.H - 7} fill="#9fb0c3" fontSize={12}>
            {length(chart.xMin)} {unit}
          </text>
          <text x={chart.W - chart.R} y={chart.H - 7} fill="#9fb0c3" fontSize={12}
            textAnchor="end">{length(chart.xMax)} {unit}</text>
          <text x={chart.W - chart.R} y={chart.T + 13} fill={Q2D_COLOR}
            fontSize={13} fontWeight={700} textAnchor="end">{tx.legendQ2d}</text>
          <text x={chart.W - chart.R} y={chart.T + 30} fill={TDR_COLOR}
            fontSize={13} fontWeight={700} textAnchor="end">{tx.legendTdr}</text>
        </svg>
      )}

      {/* 被橫軸截斷條件擋在框外的切線：不畫，但一定要說有幾條，
          否則圖上少了兩個點跟「那兩條沒對到」看起來完全一樣。 */}
      {chart && chart.hidden > 0 && (
        <div style={HINT}>
          {tx.hiddenOutside(chart.hidden, length(chart.xMax))}
        </div>
      )}

      {result.rows.filter(r => r.unstable).map(row => (
        <div key={`unstable-${row.name}`} style={{
          fontSize: 11.5, padding: '6px 10px', borderRadius: 8, lineHeight: 1.6,
          color: '#ffd8a8', background: 'rgba(224, 179, 65, 0.12)',
          border: '1px solid rgba(224, 179, 65, 0.35)',
        }}>
          <b>{row.name}</b>{tx.gap}{pickText(row, 'note', lang)}
        </div>
      ))}

      {result.summary.comparable > 0 && (
        <div style={{
          fontSize: 11.5, padding: '6px 10px', borderRadius: 8, lineHeight: 1.6,
          color: '#c8e6c9', background: 'rgba(126, 231, 135, 0.10)',
          border: '1px solid rgba(126, 231, 135, 0.28)',
        }}>
          {/* 缺值就寫「—」，不要補 0：`中位差 0.0000 Ω` 讀起來是量到了完美
              吻合，而實際上是沒有這個數字。 */}
          {tx.summary(
            result.summary.comparable,
            result.summary.median_delta_ohm == null
              ? '—' : `${result.summary.median_delta_ohm.toFixed(4)} Ω`,
            result.summary.worst || '—',
            result.summary.worst_relative == null
              ? '—' : `${(result.summary.worst_relative * 100).toFixed(2)}%`)}
          {(result.summary.unstable ?? 0) > 0
            ? tx.summaryUnstable(result.summary.unstable ?? 0) : ''}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        {/* 這張表在窄視窗下是橫向捲動的，整頁快照只拍得到左半邊。另存一張
            完整的，讀報告的人才看得到右邊那幾欄。 */}
        <table
          data-report-separate-snapshot="true"
          data-report-kind="cross-section-comparison"
          data-report-title={tx.snapshotTitle}
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              <th style={headCell}>{tx.colCut}</th>
              <th style={{ ...headCell, textAlign: 'right' }}>{tx.colDistance}</th>
              <th style={{ ...headCell, textAlign: 'right' }}>Q2D</th>
              <th style={{ ...headCell, textAlign: 'right' }}>{tx.colTdr}</th>
              <th style={{ ...headCell, textAlign: 'right' }}>{tx.colDelta}</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(row => (
              <tr key={row.name}>
                <td style={cell}>
                  {row.name}
                  {/* 跨過同一個座標好幾次時，這一列的距離與 TDR 值都是「猜的
                      那一折」。數字照給，但不能不標——標了才會有人去確認框
                      在哪一折上。 */}
                  {row.ambiguous && (
                    <span style={{ color: WARN }}>
                      {tx.gap}{tx.crossings(row.crossings ?? 2)}
                    </span>
                  )}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {row.distance_mm != null ? length(row.distance_mm) : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {row.q2d_ohm != null ? `${row.q2d_ohm.toFixed(3)} Ω` : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {row.tdr_ohm != null ? `${row.tdr_ohm.toFixed(3)} Ω` : '—'}
                  {row.tdr_min_ohm != null && row.tdr_max_ohm != null && (
                    <div style={{ color: '#9fb0c3', fontSize: 10.5 }}>
                      {tx.windowRange(row.tdr_min_ohm.toFixed(1), row.tdr_max_ohm.toFixed(1))}
                    </div>
                  )}
                </td>
                <td style={{
                  ...cell, textAlign: 'right', whiteSpace: 'normal',
                  color: row.relative != null && Math.abs(row.relative) >= 0.005
                    ? WARN : undefined,
                }}>
                  {row.unstable
                    ? tx.notSuitable
                    : row.delta_ohm != null
                      ? `${row.delta_ohm > 0 ? '+' : ''}${row.delta_ohm.toFixed(3)}`
                        + tx.relative(((row.relative ?? 0) * 100).toFixed(2))
                      : (pickText(row, 'reason', lang) || '—')}
                  {/* `note` 以前只在算不出差值時才顯示，於是「跨過六次、
                      這裡取的是最近的那一折」這種說明，剛好在有數字可看
                      （最需要提醒的時候）整句消失。有就印，跟數字並存。 */}
                  {row.note && !row.unstable && (
                    <div style={{ color: '#9fb0c3', fontSize: 10.5,
                                  fontWeight: 400 }}>{pickText(row, 'note', lang)}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.rows.filter(row => (row.features || []).length > 0).map(row => (
        <div key={`features-${row.name}`}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>
            {tx.featuresHeading(row.name)}
          </div>
          <div style={{ ...HINT, marginBottom: 4 }}>
            {tx.featuresHint}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={headCell}>{tx.colLayer}</th>
                <th style={headCell}>Net</th>
                <th style={{ ...headCell, textAlign: 'right' }}>{tx.colWidth}</th>
                <th style={{ ...headCell, textAlign: 'right' }}>{tx.colToSignal}</th>
              </tr>
            </thead>
            <tbody>
              {(row.features || []).slice(0, 8).map((feature, index) => (
                <tr key={index}>
                  <td style={cell}>{feature.layer}</td>
                  <td style={cell}>
                    {feature.net || tx.noNet}
                    {feature.is_via && <span style={{ color: WARN }}>{tx.gap}Via</span>}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {length(feature.width_mm)}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {feature.distance_to_signal_mm != null
                      ? length(feature.distance_to_signal_mm) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div>
        <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>
          {tx.causesHeading}
        </div>
        <div style={{ ...HINT, marginBottom: 4 }}>
          {tx.causesHint}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <tbody>
            {result.possible_causes.map((item, index) => (
              <tr key={index}>
                <td style={{ ...cell, whiteSpace: 'normal' }}>{pickText(item, 'cause', lang)}</td>
                <td style={{ ...cell, whiteSpace: 'normal', color: '#9fb0c3' }}>
                  {pickText(item, 'how_to_check', lang)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
