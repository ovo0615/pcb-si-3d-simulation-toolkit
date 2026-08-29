// AMI 秒測（SPISimAMI 引擎）：結果視圖與迷你波形圖。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 後端一秒回波形（引擎免授權、不開 AEDT），這裡只負責把「等化前後」
// 畫得一眼能比。正式眼圖仍走 AMI 通道分析，這是模型行為的即時檢視。

export interface QuickProbeSeries {
  name: string
  label: string
  points: [number, number][]
  swing: number
  finite: boolean
}

export interface QuickProbeWaveform {
  stimulus: string
  label: string
  series: QuickProbeSeries[]
}

export interface QuickEyeResult {
  metrics: {
    eye_height_v: number
    eye_width_ui: number
    sample_phase_ps?: number
    amplitude_v?: number
    is_open: boolean
    pam4_inner_eye_v?: number
  }
  upper: [number, number][]
  lower: [number, number][]
  traces: [number, number][][]
  ui_ps: number
  modulation: string
  at_ber?: {
    ber: number
    rj_sigma_ps: number
    eye_width_ui: number
    eye_height_v: number
  }
  ddr4_mask_check?: {
    ber: number
    at_ber: { eye_width_ui: number; eye_height_v: number }
    mask: { width_ui: number; height_v: number }
    margin: { width_ui: number; height_v: number }
    passes: boolean
    assumptions: string[]
  }
}

export interface QuickProbeResult {
  status: string
  model: string
  ami_file: string
  library: string
  elapsed_ms: number
  stimulus_bit_time_ps: number | null
  impulse: { fmax_ghz?: number; dt_ps?: number; points?: number; pulse_peak_v?: number }
  waveforms: QuickProbeWaveform[]
  model_info: { input_parameters?: string; messages?: string[] }
  rx?: { model: string; ami_file: string; library: string
    model_info: { messages?: string[] }; waveforms: QuickProbeWaveform[] }
  quick_eye?: QuickEyeResult
  notes: string[]
}

const SERIES_COLORS: Record<string, string> = {
  Input_AMI_Call: '#9aa3ad',
  Output_AMI_Init: '#2f7fd1',
  Output_AMI_GetWave: '#d97a2b',
}

export function MiniWave({ series }: { series: QuickProbeSeries[] }) {
  const width = 460
  const height = 140
  const pad = { left: 8, right: 8, top: 8, bottom: 18 }
  const all = series.flatMap(item => item.points)
  if (!all.length) return null
  const tMin = Math.min(...all.map(p => p[0]))
  const tMax = Math.max(...all.map(p => p[0]))
  const vMin = Math.min(...all.map(p => p[1]))
  const vMax = Math.max(...all.map(p => p[1]))
  const vSpan = vMax - vMin || 1
  const tSpan = tMax - tMin || 1
  const x = (t: number) => pad.left + ((t - tMin) / tSpan) * (width - pad.left - pad.right)
  const y = (v: number) => pad.top + (1 - (v - vMin) / vSpan) * (height - pad.top - pad.bottom)
  return (
    <svg width={width} height={height} role="img"
      style={{ maxWidth: '100%', background: 'var(--panel-bg, #fff)', border: '1px solid #d5dbe2', borderRadius: 4 }}>
      {vMin < 0 && vMax > 0 && (
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)}
          stroke="#e2e6ea" strokeWidth={1} />
      )}
      {series.map(item => (
        <polyline key={item.name} fill="none"
          stroke={SERIES_COLORS[item.name] || '#666'} strokeWidth={1.4}
          points={item.points.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')} />
      ))}
      <text x={pad.left} y={height - 4} fontSize={10} fill="#68717a">
        {(tMin * 1e9).toFixed(2)} ns
      </text>
      <text x={width - pad.right} y={height - 4} fontSize={10} fill="#68717a" textAnchor="end">
        {(tMax * 1e9).toFixed(2)} ns
      </text>
    </svg>
  )
}

export function EyeView({ eye }: { eye: QuickEyeResult }) {
  const width = 480
  const height = 240
  const pad = { left: 10, right: 10, top: 10, bottom: 20 }
  // 疊圖的位元交界對齊在 0／UI／2UI，包絡線以峰值為 0——先平移一個 UI
  // 讓開口落在疊圖中央那隻眼上，再一起算座標範圍。
  const shifted = (points: [number, number][]): [number, number][] =>
    points.map(p => [p[0] + eye.ui_ps, p[1]])
  const upperShifted = shifted(eye.upper)
  const lowerShifted = shifted(eye.lower)
  const all = [...eye.traces.flat(), ...upperShifted, ...lowerShifted]
  if (!all.length) return null
  const tMin = Math.min(...all.map(p => p[0]))
  const tMax = Math.max(...all.map(p => p[0]))
  const vAbs = Math.max(...all.map(p => Math.abs(p[1])), 1e-6)
  const x = (t: number) => pad.left + ((t - tMin) / (tMax - tMin || 1)) * (width - pad.left - pad.right)
  const y = (v: number) => pad.top + (1 - (v + vAbs) / (2 * vAbs)) * (height - pad.top - pad.bottom)
  const toPath = (points: [number, number][]) =>
    points.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')
  const m = eye.metrics
  // 眼開口多邊形：上緣正走、下緣反走。只畫 opening > 0 的部分才像眼。
  const openUpper = upperShifted.filter(p => p[1] > 0)
  const openLower = lowerShifted.filter(p => p[1] < 0).reverse()
  return (
    <div>
      <p className="hint" style={{ marginBottom: 2 }}>
        <strong>秒級統計眼（最壞情況）：</strong>
        {m.is_open
          ? `眼高 ${m.eye_height_v.toFixed(3)} V、眼寬 ${(m.eye_width_ui * 100).toFixed(0)}% UI`
          : '最壞情況下全閉——通道 ISI 蓋過主游標'}
        {m.pam4_inner_eye_v !== undefined
          ? `　·　PAM4 內眼 ${m.pam4_inner_eye_v.toFixed(3)} V` : ''}
        　·　UI {eye.ui_ps.toFixed(1)} ps
      </p>
      {eye.at_ber && m.is_open && (
        <p className="hint" style={{ marginTop: 0 }}>
          BER {eye.at_ber.ber} 外插：眼寬 {(eye.at_ber.eye_width_ui * 100).toFixed(0)}% UI、
          眼高 {eye.at_ber.eye_height_v.toFixed(3)} V
          （假設 RJ σ={eye.at_ber.rj_sigma_ps} ps，可在 DDR4 遮罩區改）
        </p>
      )}
      <svg width={width} height={height} role="img"
        style={{ maxWidth: '100%', background: '#101418', border: '1px solid #2a3138', borderRadius: 4 }}>
        {eye.traces.map((trace, index) => (
          <polyline key={index} fill="none" stroke="#43d17a"
            strokeOpacity={0.10} strokeWidth={1} points={toPath(trace)} />
        ))}
        {openUpper.length > 2 && openLower.length > 2 && (
          <polygon
            points={toPath([...openUpper, ...openLower] as [number, number][])}
            fill="#f2c14e" fillOpacity={0.22} stroke="#f2c14e"
            strokeWidth={1.2} />
        )}
        <text x={pad.left} y={height - 5} fontSize={10} fill="#8a949e">
          {tMin.toFixed(0)} ps
        </text>
        <text x={width - pad.right} y={height - 5} fontSize={10}
          fill="#8a949e" textAnchor="end">{tMax.toFixed(0)} ps</text>
        <text x={width / 2} y={height - 5} fontSize={10} fill="#8a949e"
          textAnchor="middle">±{vAbs.toFixed(2)} V</text>
      </svg>
      {eye.ddr4_mask_check && (
        <p className="hint" style={{ marginTop: 2 }}>
          <strong style={{ color: eye.ddr4_mask_check.passes ? '#43d17a' : '#e5534b' }}>
            DDR4 Rx 遮罩（BER {eye.ddr4_mask_check.ber}）：
            {eye.ddr4_mask_check.passes ? '通過' : '不通過'}
          </strong>
          　寬邊際 {(eye.ddr4_mask_check.margin.width_ui * 100).toFixed(1)}% UI、
          高邊際 {(eye.ddr4_mask_check.margin.height_v * 1000).toFixed(0)} mV
          　·　{eye.ddr4_mask_check.assumptions[0]}
        </p>
      )}
    </div>
  )
}

export function QuickProbeView({ result }: { result: QuickProbeResult }) {
  return (
    <div className="ami-quickprobe">
      <p className="hint">
        {result.model}（{result.ami_file}）　·　{result.elapsed_ms} ms
        {result.stimulus_bit_time_ps
          ? `　·　位元時間 ${result.stimulus_bit_time_ps.toFixed(1)} ps` : ''}
        {result.impulse?.pulse_peak_v !== undefined
          ? `　·　通道脈衝峰值 ${result.impulse.pulse_peak_v.toFixed(3)} V` : ''}
      </p>
      {result.waveforms.map(wave => (
        <div key={wave.stimulus} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 13, marginBottom: 2 }}>
            <strong>{wave.label}</strong>
            {wave.series.map(item => (
              <span key={item.name} style={{ marginLeft: 10, color: SERIES_COLORS[item.name] || '#666' }}>
                ▬ {item.label}（擺幅 {item.swing.toFixed(3)} V）
              </span>
            ))}
          </div>
          <MiniWave series={wave.series} />
        </div>
      ))}
      {result.quick_eye && <EyeView eye={result.quick_eye} />}
      {result.rx && (
        <p className="hint">
          Rx：{result.rx.model}（{result.rx.ami_file}）已串接於 Tx 之後。
        </p>
      )}
      {(result.model_info?.messages?.length ?? 0) > 0 && (
        <details>
          <summary>模型訊息（等化實際設了什麼）</summary>
          <ul className="hint" style={{ margin: '4px 0' }}>
            {result.model_info.messages!.map((line, index) => (
              <li key={index}><code>{line}</code></li>
            ))}
            {(result.rx?.model_info?.messages || []).map((line, index) => (
              <li key={`rx-${index}`}><code>Rx：{line}</code></li>
            ))}
          </ul>
        </details>
      )}
      {result.notes.map(note => <p className="hint" key={note}>{note}</p>)}
    </div>
  )
}
