// 截面阻抗：剖視圖、導體清單與 ImpedancePlan。
//
//
// 剖視圖是求解前唯一還能便宜發現建模錯誤的地方，所以它畫的是**掃描實際得到
// 的那些段**，不是理想疊構的示意。橫向照真實座標、縱向照真實高程，兩軸各自
// 縮放——一段 5 mm 寬的截面配上 1 mm 的疊構，等比例畫出來會是一條線。

import { useMemo, useState } from 'react'

export interface CrossSectionSegment {
  key: string
  layer: string
  net: string
  s0_mm: number
  s1_mm: number
  width_mm: number
  source: string
  is_via: boolean
  role: string
}

export interface CrossSectionSafety {
  severity: 'hard' | 'risk' | string
  kind: string
  message: string
  layer: string
  net: string
  detail: Record<string, any>
}

export interface CrossSectionStackupRow {
  name: string
  kind: string
  y0_mm: number
  y1_mm: number
  material: string | null
}

export interface ImpedancePlan {
  solvable: boolean
  blockers: string[]
  warnings: CrossSectionSafety[]
  signal_conductors: string[]
  reference_conductors: string[]
  pairs: { a: string; b: string; exact: boolean }[]
  conductor_count: number
}

export interface CrossSectionScan {
  cut: { axis: string; coordinate_mm: number; name: string; length_mm: number }
  region: { x0_mm: number; y0_mm: number; x1_mm: number; y1_mm: number }
  layers: string[]
  stackup: CrossSectionStackupRow[]
  segments: CrossSectionSegment[]
  conductors: { name: string; role: string; nets: string[]; members: CrossSectionSegment[] }[]
  safety: CrossSectionSafety[]
  plan: ImpedancePlan
  resolution_um: number
}

// 這一塊坐在右側的**深色**預覽面板裡，而應用程式的 :root 是淺色主題
// （--text 是深藍）。繼承過來就是深字配深底，畫面上等於一片空白。
// 沿用 ModelLibrary 早就定好的那組深底配色，不要再靠繼承。
const TEXT = '#d1dbe7'
const HEADING = '#e8eef5'
const HINT: React.CSSProperties = { color: '#9fb0c3', fontSize: 11.5, lineHeight: 1.55 }
const RULE = '#27313d'

/** 深底上的狀態框。`.status` 那組是為淺色面板調的，在這裡讀不出來。 */
function statusStyle(tone: 'ok' | 'warn'): React.CSSProperties {
  return {
    fontSize: 11.5, padding: '6px 10px', borderRadius: 8, lineHeight: 1.6,
    color: tone === 'warn' ? '#ffd8a8' : '#c8e6c9',
    background: tone === 'warn' ? 'rgba(224, 179, 65, 0.12)'
                                : 'rgba(126, 231, 135, 0.10)',
    border: `1px solid ${tone === 'warn' ? 'rgba(224, 179, 65, 0.35)'
                                         : 'rgba(126, 231, 135, 0.28)'}`,
  }
}

const SIGNAL_COLOR = '#f0a13a'
const REFERENCE_COLOR = '#5aa9e6'
const DIELECTRIC_COLOR = '#1d2430'
const METAL_LAYER_COLOR = '#2a3341'

interface Props {
  scan: CrossSectionScan
  /** 逐段覆寫身分；改了就要重掃，因為 Role 會改變導體的組成。 */
  roleOverrides: Record<string, string>
  onRoleOverride: (key: string, role: string) => void
  busy?: boolean
}

export default function CrossSectionView({
  scan, roleOverrides, onRoleOverride, busy,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  // 橫向範圍取切線的延伸方向；縱向取疊構的總高。疊構讀不到時退成等高列，
  // 位置資訊仍在，只是層厚不再是真的——這件事要在畫面上講出來。
  const geometry = useMemo(() => {
    const axisIsX = scan.cut.axis === 'x'
    const sLo = axisIsX ? scan.region.y0_mm : scan.region.x0_mm
    const sHi = axisIsX ? scan.region.y1_mm : scan.region.x1_mm
    const rows = scan.stackup.length > 0
      ? scan.stackup
      : scan.layers.slice().reverse().map((name, index) => ({
          name, kind: 'signal',
          y0_mm: -(index + 1), y1_mm: -index,
          material: null,
        }))
    const yLo = Math.min(...rows.map(r => r.y0_mm))
    const yHi = Math.max(...rows.map(r => r.y1_mm))
    return {
      sLo: Math.min(sLo, sHi), sHi: Math.max(sLo, sHi),
      rows, yLo, yHi, toScale: scan.stackup.length > 0,
    }
  }, [scan])

  const W = 640
  const H = 300
  const PAD_L = 8
  const PAD_R = 8
  const PAD_T = 8
  const PAD_B = 22
  const sSpan = Math.max(geometry.sHi - geometry.sLo, 1e-9)
  const ySpan = Math.max(geometry.yHi - geometry.yLo, 1e-9)
  const sx = (s: number) => PAD_L + (s - geometry.sLo) / sSpan * (W - PAD_L - PAD_R)
  const sy = (y: number) => PAD_T + (geometry.yHi - y) / ySpan * (H - PAD_T - PAD_B)

  // 段落畫在它自己那一層的高程上。疊構裡找不到同名層（例如掃描用的是訊號層
  // 名、疊構把它寫成別的大小寫）時就跳過，不要硬塞到某一層上——畫錯位置比
  // 不畫更糟。
  const rowByName = useMemo(() => {
    const table = new Map<string, CrossSectionStackupRow>()
    for (const row of geometry.rows) table.set(row.name.toLowerCase(), row)
    return table
  }, [geometry])

  const signalCount = scan.segments.filter(s => s.role === 'signal').length
  const referenceCount = scan.segments.filter(s => s.role === 'reference').length
  const hard = scan.safety.filter(item => item.severity === 'hard')
  const risk = scan.safety.filter(item => item.severity === 'risk')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10,
                  fontSize: 12, color: TEXT }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: HEADING }}>
          剖視圖 · {scan.cut.name || `${scan.cut.axis.toUpperCase()} = ${scan.cut.coordinate_mm.toFixed(3)} mm`}
        </div>
        <div style={{ ...HINT,  marginTop: 2 }}>
          切線長 {scan.cut.length_mm.toFixed(3)} mm，取樣間距 {scan.resolution_um.toFixed(1)} µm。
          橫向與縱向各自縮放{geometry.toScale ? '' : '；疊構讀不到，層厚為示意'}。
          橘色是訊號、藍色是參考。
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{
          width: '100%', marginTop: 6, background: '#0c0e12',
          border: `1px solid ${RULE}`, borderRadius: 6,
        }}>
          {geometry.rows.map(row => {
            const top = sy(row.y1_mm)
            const bottom = sy(row.y0_mm)
            const isMetal = /signal|conduct|metal/i.test(row.kind)
            return (
              <g key={row.name}>
                <rect x={PAD_L} y={top} width={W - PAD_L - PAD_R}
                  height={Math.max(bottom - top, 0.6)}
                  fill={isMetal ? METAL_LAYER_COLOR : DIELECTRIC_COLOR} />
                <title>{`${row.name}（${row.kind || '未標示'}）${row.material ? ' · ' + row.material : ''}`}</title>
              </g>
            )
          })}
          {scan.segments.map(segment => {
            const row = rowByName.get(segment.layer.toLowerCase())
            if (!row) return null
            const top = sy(row.y1_mm)
            const bottom = sy(row.y0_mm)
            const x0 = sx(Math.min(segment.s0_mm, segment.s1_mm))
            const x1 = sx(Math.max(segment.s0_mm, segment.s1_mm))
            const isSignal = segment.role === 'signal'
            return (
              <rect key={segment.key}
                x={x0} y={top}
                width={Math.max(x1 - x0, 0.8)}
                height={Math.max(bottom - top, 1.5)}
                fill={isSignal ? SIGNAL_COLOR : REFERENCE_COLOR}
                stroke={hovered === segment.key ? '#fff' : 'none'}
                strokeWidth={hovered === segment.key ? 1.2 : 0}
                onMouseEnter={() => setHovered(segment.key)}
                onMouseLeave={() => setHovered(null)}>
                <title>{`${segment.net} @ ${segment.layer}\n寬 ${(segment.width_mm * 1000).toFixed(1)} µm`
                  + `${segment.is_via ? '\n來源：Via pad' : ''}`}</title>
              </rect>
            )
          })}
          <text x={PAD_L} y={H - 6} fill="#5c677d" fontSize={11}>
            {geometry.sLo.toFixed(2)} mm
          </text>
          <text x={W - PAD_R} y={H - 6} fill="#5c677d" fontSize={11} textAnchor="end">
            {geometry.sHi.toFixed(2)} mm
          </text>
        </svg>
      </div>

      <div style={statusStyle(scan.plan.solvable ? 'ok' : 'warn')}>
        {scan.plan.solvable
          ? `可以送去求解：導體 ${scan.plan.conductor_count} 個`
            + `（訊號 ${scan.plan.signal_conductors.length}、參考 ${scan.plan.reference_conductors.length}）。`
          : '這個截面還不能求解。'}
        {scan.plan.blockers.map((text, index) => (
          <div key={index} style={{ marginTop: 3 }}>· {text}</div>
        ))}
      </div>

      {scan.plan.pairs.length > 0 && (
        <div style={HINT}>
          自動配對的差分對：
          {scan.plan.pairs.map(pair => (
            <span key={`${pair.a}|${pair.b}`} style={{ marginLeft: 6 }}>
              {pair.a} ／ {pair.b}
              <span style={{ color: pair.exact ? '#7ee787' : '#e0b341' }}>
                （{pair.exact ? '精確' : '近似：其餘導體視為參考電位'}）
              </span>
            </span>
          ))}
        </div>
      )}

      {(hard.length > 0 || risk.length > 0) && (
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>
            安全性檢查（{hard.length} 個不能算、{risk.length} 個要判斷）
          </div>
          {[...hard, ...risk].map((item, index) => (
            <div key={index} style={{ ...statusStyle(item.severity === 'hard' ? 'warn' : 'ok'),
                                      marginBottom: 4 }}>
              <b>{item.severity === 'hard' ? '不能算' : '要判斷'}</b>
              {item.net ? `　${item.net}` : ''}{item.layer ? ` @ ${item.layer}` : ''}
              <div style={{ marginTop: 2 }}>{item.message}</div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>
          截到的段（訊號 {signalCount}、參考 {referenceCount}）
        </div>
        <div style={{ ...HINT,  marginBottom: 4 }}>
          Reference 的段會合併成單一 GND 導體（假設交流同電位）。改身分後要重新掃描。
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${RULE}`, borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0 }}>
                <th style={headCell}>層</th>
                <th style={headCell}>Net</th>
                <th style={{ ...headCell, textAlign: 'right' }}>位置 mm</th>
                <th style={{ ...headCell, textAlign: 'right' }}>寬 µm</th>
                <th style={headCell}>身分</th>
              </tr>
            </thead>
            <tbody>
              {scan.segments.map(segment => (
                <tr key={segment.key}
                  onMouseEnter={() => setHovered(segment.key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ background: hovered === segment.key ? 'rgba(255,255,255,0.06)' : undefined }}>
                  <td style={cell}>{segment.layer}</td>
                  <td style={cell}>
                    {segment.net || '（無網路）'}
                    {segment.is_via && <span style={{ color: '#e0b341' }} title="來自 Via 的 pad">　Via</span>}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {segment.s0_mm.toFixed(3)}–{segment.s1_mm.toFixed(3)}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {(segment.width_mm * 1000).toFixed(1)}
                  </td>
                  <td style={cell}>
                    <select className="input" disabled={busy}
                      aria-label={`${segment.key} 這一段的角色`}
                      style={{ height: 22, padding: '0 4px', fontSize: 11 }}
                      value={roleOverrides[segment.key] ?? segment.role}
                      onChange={event => onRoleOverride(segment.key, event.target.value)}>
                      <option value="signal">訊號</option>
                      <option value="reference">參考</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── 求解結果 ────────────────────────────────────────────────────────────────

export interface CrossSectionResultRow {
  name: string
  axis?: string
  coordinate_mm?: number
  solved: boolean
  blockers: string[]
  seconds?: number
  conductors?: string[]
  matrix?: Record<string, number>
  single_ended?: Record<string, number>
  pairs?: {
    name: string; positive: string; negative: string; exact: boolean
    Zdiff: number | null; Zcomm: number | null
    Z_odd: number | null; Z_even: number | null; error: string | null
  }[]
  solve_mode?: string
  per_error?: number
  convergence?: {
    converged: boolean | null
    factor: number
    worst_relative: number | null
    tolerance: number
    message: string
    conductors: { conductor: string; before: number; after: number | null
                  delta: number | null; relative: number | null }[]
  }
}

const MODE_LABELS: Record<string, string> = {
  fast: '快速', standard: '標準', accurate: '高精度',
}

export function CrossSectionResults({
  rows, selected, onSelect,
}: {
  rows: CrossSectionResultRow[]
  selected: number
  onSelect: (index: number) => void
}) {
  const row = rows[Math.min(selected, rows.length - 1)]
  const solved = rows.filter(r => r.solved)
  // 沿線剖面只在同一個軸上多條切線時才有意義。一條切線畫不出剖面，兩條不同
  // 軸的擺在一起也不是剖面。
  const profile = solved
    .filter(r => typeof r.coordinate_mm === 'number' && r.axis === solved[0]?.axis)
    .sort((a, b) => (a.coordinate_mm || 0) - (b.coordinate_mm || 0))

  if (!row) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
                  fontSize: 12, color: TEXT }}>
      {rows.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {rows.map((item, index) => (
            <button key={item.name} className="btn"
              onClick={() => onSelect(index)}
              style={{
                fontSize: 11, padding: '2px 8px',
                fontWeight: index === selected ? 700 : 400,
                borderColor: index === selected ? 'var(--accent)' : undefined,
                color: item.solved ? undefined : '#e0b341',
              }}>
              {item.name}
            </button>
          ))}
        </div>
      )}

      {!row.solved ? (
        <div style={statusStyle('warn')}>
          {row.name} 沒有求解。
          {row.blockers.map((text, index) => (
            <div key={index} style={{ marginTop: 3 }}>· {text}</div>
          ))}
        </div>
      ) : (
        <>
          <div style={HINT}>
            {row.name}
            {typeof row.coordinate_mm === 'number'
              ? `　${(row.axis || '').toUpperCase()} = ${row.coordinate_mm.toFixed(3)} mm` : ''}
            {/* 分隔的全形空格要留在表達式裡：JSX 會把換行後開頭的空白吃掉，
                寫成純文字會變成「mm精度」。 */}
            {`　精度 ${MODE_LABELS[row.solve_mode || ''] || row.solve_mode}`}
            {typeof row.per_error === 'number' ? `（PerError ${row.per_error}%）` : ''}
            {typeof row.seconds === 'number' ? `　${row.seconds} 秒` : ''}
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>單端阻抗 Z₀</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>
                {Object.entries(row.single_ended || {}).map(([name, value]) => (
                  <tr key={name}>
                    <td style={cell}>{name}</td>
                    <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>
                      {value.toFixed(3)} Ω
                    </td>
                    <td style={{ ...cell, textAlign: 'right', color: '#8fa1b5' }}>
                      L {(row.matrix?.[`L(${name},${name})`] ?? 0).toFixed(2)} nH/m
                      　C {(row.matrix?.[`C(${name},${name})`] ?? 0).toFixed(2)} pF/m
                    </td>
                  </tr>
                ))}
                {Object.keys(row.single_ended || {}).length === 0 && (
                  <tr><td style={cell} colSpan={3}>
                    矩陣裡沒有可用的 L 與 C（求解可能中途停過），所以不顯示數字。
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {row.convergence && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>
                側向收斂驗證
              </div>
              <div style={statusStyle(row.convergence.converged === true ? 'ok' : 'warn')}>
                {row.convergence.message}
              </div>
              <table style={{
                width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 4,
              }}>
                <tbody>
                  {row.convergence.conductors.map(item => (
                    <tr key={item.conductor}>
                      <td style={cell}>{item.conductor}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        {item.before.toFixed(3)} Ω
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        → {item.after != null ? `${item.after.toFixed(3)} Ω` : '—'}
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        {item.relative != null
                          ? `${(item.relative * 100).toFixed(2)}%`
                          : '無法比較'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(row.pairs || []).length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>差分阻抗</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <tbody>
                  {(row.pairs || []).map(pair => (
                    <tr key={pair.name}>
                      <td style={cell}>{pair.positive} ／ {pair.negative}</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>
                        {pair.Zdiff != null ? `${pair.Zdiff.toFixed(3)} Ω` : '—'}
                      </td>
                      <td style={{ ...cell, textAlign: 'right', color: '#8fa1b5' }}>
                        {pair.Zcomm != null ? `Zcomm ${pair.Zcomm.toFixed(3)} Ω` : ''}
                      </td>
                      <td style={{ ...cell, color: pair.exact ? '#7ee787' : '#e0b341' }}>
                        {pair.error
                          ? pair.error
                          : pair.exact ? '精確' : '近似：其餘導體視為參考電位'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {profile.length > 1 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4, color: HEADING }}>
                沿線剖面（{profile.length} 條切線）
              </div>
              <div style={{ ...HINT,  marginBottom: 4 }}>
                每個值只在該座標成立，並假設結構沿線均勻。切線之間發生的事這裡看不到。
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <tbody>
                  {profile.map(item => {
                    const values = Object.values(item.single_ended || {})
                    return (
                      <tr key={item.name}>
                        <td style={cell}>{(item.axis || '').toUpperCase()} = {item.coordinate_mm?.toFixed(3)}</td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {values.length
                            ? values.map(v => `${v.toFixed(3)} Ω`).join('　')
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const cell: React.CSSProperties = {
  padding: '3px 6px',
  borderBottom: `1px solid ${RULE}`,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  color: TEXT,
}

const headCell: React.CSSProperties = {
  ...cell,
  color: '#9fb0c3',
  background: '#19212b',
  fontWeight: 700,
}
