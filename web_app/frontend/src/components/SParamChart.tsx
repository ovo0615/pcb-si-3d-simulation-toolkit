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
  /** 有給才會出現「匯出 Excel」；匯出的是目前圖上這幾條。 */
  onExport?: (series: SParamSeries[]) => void
  exporting?: boolean
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

// 預設 viewBox 寬度。互動模式會改用實測的容器尺寸，讓 viewBox 與容器同比例
// ——否則 width:100% 搭配固定 viewBox 時，渲染高度會被寬高比綁死，圖不是超出
// 容器就是留一段空白。（不能用 preserveAspectRatio="none" 硬拉：那會連文字與
// 線寬一起變形。）
const DEFAULT_W = 920

/** 右側抽屜的寬度。繪圖區的 padding 與把手的位置都由它算出來——
 *  三處各寫一個數字的話，改寬度時一定會漏掉其中一處。 */
const PANEL_WIDTH = 244
/** 把手與抽屜之間的間距。 */
const PANEL_GAP = 6
const PAD = { left: 72, right: 18, top: 12, bottom: 42 }

function normalizedRange(min: number, max: number, fallbackSpan: number): [number, number] {
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) return [min, max]
  const center = Number.isFinite(min) ? min : 0
  return [center - fallbackSpan / 2, center + fallbackSpan / 2]
}

export default function SParamChart({
  series, height = 220, interactive = false, onExport, exporting = false,
}: Props) {
  const clipId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [boxWidth, setBoxWidth] = useState(DEFAULT_W)
  const [boxHeight, setBoxHeight] = useState(0)
  /** 游標讀值：預設關閉，圖上按兩下開／再按兩下關。
   *  一直開著的話游標移過去就跳出一大塊數值蓋住曲線，而且沒有辦法關掉。 */
  const [readout, setReadout] = useState(false)
  const dragRef = useRef<{ x: number, y: number, view: ViewRange } | null>(null)
  const [axisMode, setAxisMode] = useState<AxisMode>('xy')
  const [yPreset, setYPreset] = useState<YPreset>('auto')
  const [view, setView] = useState<ViewRange | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  // 圖例與軸控制收進側邊抽屜。串音有 28 條曲線，圖例攤在圖上方會把整張圖擠
  // 出畫面——實測勾選 NEXT 之後曲線完全看不到。抽屜可以收起，圖就吃滿整格。
  const [panelOpen, setPanelOpen] = useState(false)

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

  // viewBox 的寬度跟著容器走，圖才會剛好填滿而不是被寬高比擠出去。
  useEffect(() => {
    const box = svgRef.current
    if (!box || !interactive) return
    const measure = (width: number, boxH: number) => {
      if (width > 0) setBoxWidth(width)
      if (boxH > 0) setBoxHeight(boxH)
    }
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) measure(rect.width, rect.height)
    })
    observer.observe(box)
    const rect = box.getBoundingClientRect()
    measure(rect.width || DEFAULT_W, rect.height)
    return () => observer.disconnect()
  // 必須包含 validSeries.length：沒有資料時元件會提早 return，那一輪根本沒有
  // <svg>，svgRef 是 null。只依賴 [interactive] 的話這個 effect 就只在那一次
  // 跑過，之後曲線進來、SVG 掛上了也不會再量——viewBox 永遠停在預設的
  // 920×160，圖就縮在上面一小塊，下面空一大片。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, validSeries.length])

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
  // viewBox 直接等於 SVG 實際被 CSS 撐成的大小：比例一致，既不會變形也不會
  // 留邊。互動模式由 flex 撐滿，非互動模式仍用呼叫端給的固定高度。
  const W = interactive ? Math.max(boxWidth, 320) : DEFAULT_W
  const H = interactive ? Math.max(boxHeight, 160) : Math.max(height, 160)
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
      if (readout) setHover({ freq: frequency, svgX, values })
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
    <div ref={boxRef} style={{
      position: 'relative', height: '100%',
      display: interactive ? 'flex' : undefined,
      flexDirection: interactive ? 'column' : undefined,
      // 抽屜展開時把繪圖區往內收，而不是讓抽屜蓋在圖上。
      //
      // 原本是覆蓋式，理由是「開合不會讓曲線跳動」。但實際用起來，被蓋住的
      // 永遠是最右邊——也就是最高頻那一段，而那正是最常要看的地方（50 GHz
      // 的通道，蓋掉 244px 大約吃掉 16 GHz 以上）。要看高頻就得先收起抽屜，
      // 等於圖例與高頻不能同時看，這比曲線位移惱人得多。
      //
      // 抽屜是絕對定位貼右緣，而絕對定位的參考是容器的 padding box，所以
      // padding 讓出來的空間剛好就是抽屜的位置，兩者不會打架。SVG 是
      // width:100%，內容盒一縮它就跟著縮，ResizeObserver 會量到新寬度並更新
      // viewBox——不需要另外算。
      paddingRight: interactive && panelOpen ? PANEL_WIDTH : 0,
      transition: 'padding-right 140ms ease',
      boxSizing: 'border-box',
    }}>
      {/* 圖例與軸控制收進右側抽屜——留給曲線的空間才是這一格的重點。
          收合時只剩一條把手，圖佔滿整格。 */}
      {interactive && (
        <>
          <button type="button" onClick={() => setPanelOpen(open => !open)}
            title={panelOpen ? '收起圖例與軸控制' : '展開圖例與軸控制'}
            style={{
              position: 'absolute', top: 6, zIndex: 3,
              right: panelOpen ? PANEL_WIDTH + PANEL_GAP : PANEL_GAP,
              background: 'rgba(20,24,30,0.92)', color: 'var(--accent)',
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '3px 9px', fontSize: 12, cursor: 'pointer',
              fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
            }}>
            {panelOpen ? '▶ 收起' : `◀ 圖例／軸（${validSeries.length}）`}
          </button>

          {panelOpen && (
            <div style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: PANEL_WIDTH,
              zIndex: 2, overflowY: 'auto', padding: '34px 10px 10px',
              background: 'rgba(14,17,22,0.94)', backdropFilter: 'blur(3px)',
              border: '1px solid var(--border)', borderRadius: 8,
              fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
            }}
              onWheel={event => event.stopPropagation()}
              onPointerDown={event => event.stopPropagation()}>

              <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>縮放／平移軸</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                {(['xy', 'x', 'y'] as AxisMode[]).map(mode => (
                  <button key={mode} type="button"
                    className={`btn ${axisMode === mode ? 'btn--primary' : ''}`}
                    onClick={() => setAxisMode(mode)}
                    style={{ flex: 1, padding: '4px 0' }}>{mode.toUpperCase()}</button>
                ))}
              </div>

              <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 8 }}>Y 軸範圍</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {([['20', '0…−20'], ['40', '0…−40'], ['80', '0…−80'],
                   ['auto', 'Auto']] as [YPreset, string][]).map(([preset, label]) => (
                  <button key={preset} type="button"
                    className={`btn ${yPreset === preset ? 'btn--primary' : ''}`}
                    onClick={() => applyYPreset(preset)}
                    style={{ flex: '1 0 46%', padding: '4px 0' }}>{label}</button>
                ))}
              </div>

              <button type="button" className="btn" onClick={fitAll}
                style={{ width: '100%', marginTop: 6, padding: '4px 0' }}>Fit All</button>

              {onExport && (
                <button type="button" className="btn--primary" disabled={exporting}
                  onClick={() => onExport(series)}
                  style={{ width: '100%', marginTop: 6, padding: '5px 0' }}>
                  {exporting ? '匯出中…' : '匯出 Excel'}
                </button>
              )}

              <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 10 }}>
                曲線（{validSeries.length}）
              </div>
              <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.55 }}>
                {validSeries.map(item => (
                  <div key={item.label} style={{ color: item.color, fontWeight: 600 }}
                    title={item.label}>— {item.label}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* 非互動（報告快照等）維持原本把圖例排在上方的樣子。 */}
      {!interactive && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, marginBottom: 5,
        }}>
          {validSeries.map(item => (
            <span key={item.label} style={{ color: item.color, fontWeight: 600 }}>— {item.label}</span>
          ))}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        onWheel={zoomAt} onPointerDown={beginPan} onPointerMove={pan}
        onPointerUp={endPan} onPointerCancel={endPan} onPointerLeave={endPan}
        onDoubleClick={() => { setReadout(open => !open); setHover(null) }}
        preserveAspectRatio="none"
        style={{
          width: '100%', background: '#0c0e12', borderRadius: 6, display: 'block',
          // 互動模式讓 flex 把 SVG 撐滿剩餘高度；viewBox 會跟著量到的大小走。
          ...(interactive ? { flex: '1 1 auto', minHeight: 0 } : {}),
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
        <div style={{ color: clippedBelow || clippedAbove ? '#f0b429' : 'var(--faint)', fontSize: 12, marginTop: 5, textAlign: 'center', flex: '0 0 auto' }}>
          {clippedBelow || clippedAbove
            ? `目前 Y 軸預設已裁掉範圍外資料${clippedBelow ? '（下方）' : ''}${clippedAbove ? '（上方）' : ''}；按 Auto 或 Fit All 查看全部。`
            : readout
              ? '讀值開啟中：游標可讀取所有曲線；在圖上按兩下可關閉。'
              : '滾輪約每格縮放 6%；按住左鍵拖曳平移；在圖上按兩下開啟游標讀值。'}
        </div>
      )}
    </div>
  )
}
