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
      {(result.model_info?.messages?.length ?? 0) > 0 && (
        <details>
          <summary>模型訊息（等化實際設了什麼）</summary>
          <ul className="hint" style={{ margin: '4px 0' }}>
            {result.model_info.messages!.map((line, index) => (
              <li key={index}><code>{line}</code></li>
            ))}
          </ul>
        </details>
      )}
      {result.notes.map(note => <p className="hint" key={note}>{note}</p>)}
    </div>
  )
}
