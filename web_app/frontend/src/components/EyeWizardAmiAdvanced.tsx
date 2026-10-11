// 眼圖精靈第 4 步的 AMI「進階」摺疊區（#0104，搬自舊 AMI 頁籤）：
//
//   * AMI 參數編輯：只列 .ami 宣告 Usage In／InOut 的 Model_Specific 參數；
//     只送改過的，寫不進 AEDT 的由後端寫入預檢擋下。
//   * 秒級預覽（SPISimAMI，不開 AEDT）＋DDR4 Rx 眼罩統計簽核。
//   * 等化掃描＋套用：把排名第一的那組填進上面的參數。
//
// 參數由精靈持有（進確認簽章、跟正式分析一起送出）；預覽與掃描結果只在這裡，
// 而且帶著產生當下的設定簽章：換模型、通道、速率、調變或 Port 後標「已過期」，
// 掃描表不給套用（舊模型的參數名寫進新模型，畫面上看不到也清不掉——審稿 M6）。
import { useState } from 'react'
import { QuickProbeView } from './AmiQuickProbe'
import type { QuickProbeResult } from './AmiQuickProbe'
import { setModelsReportMetadata } from './reportMetadataStore'
import { previewReportMetadata } from '../amiPreviewMetadata'
import { applyEqRow, ddr4Mask, previewUiMismatch } from '../eyeWizard'
import type { PortMap } from '../eyeWizard'
import { errorText, pickList, pickText } from '../backendFields'
import { useT } from '../i18n'

export interface EditableParameter {
  name: string
  type?: string
  default?: string
  choices?: string[]
  minimum?: string
  maximum?: string
  description?: string
}

export interface AmiCandidate { name: string; editable_parameters?: EditableParameter[] }

type Params = Record<string, string>

export interface EyeWizardAmiAdvancedProps {
  touchstone: string
  dataRateGbps: number | null
  modulation: string
  ports: PortMap
  txPackageId: string
  rxPackageId: string
  txModel: string
  rxModel: string
  txCandidates: AmiCandidate[]
  rxCandidates: AmiCandidate[]
  txParams: Params
  rxParams: Params
  onParamsChange: (next: { tx: Params; rx: Params }) => void
  /** 選了非 DDR 規範時不顯示 DDR4 Rx 眼罩（畫面驗收 T10）。 */
  showDdrMask: boolean
}

async function postJson(url: string, body: unknown, fallback: string): Promise<any> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(data?.detail || fallback), { detail_en: data?.detail_en })
  }
  return data
}

export default function EyeWizardAmiAdvanced(props: EyeWizardAmiAdvancedProps) {
  const { t: all, lang } = useT()
  const t = all.eyeWizard
  const { txParams, rxParams, onParamsChange } = props
  const [preview, setPreview] = useState<{ sig: string; data: QuickProbeResult } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [eqSweep, setEqSweep] = useState<{ sig: string; data: any } | null>(null)
  const [eqBusy, setEqBusy] = useState(false)
  // 兩顆按鈕各自的錯誤：一個開始跑不能清掉另一個的訊息（審稿 L8）。
  const [previewError, setPreviewError] = useState('')
  const [eqError, setEqError] = useState('')
  const [notice, setNotice] = useState('')
  const [maskWidth, setMaskWidth] = useState('')
  const [maskHeight, setMaskHeight] = useState('')
  const [rjSigma, setRjSigma] = useState('1')

  const ready = Boolean(props.touchstone && props.txPackageId && props.dataRateGbps)
  const toolSignature = JSON.stringify([props.txPackageId, props.rxPackageId, props.txModel,
    props.rxModel, props.touchstone, props.dataRateGbps, props.modulation, props.ports])
  const eqStale = Boolean(eqSweep) && eqSweep!.sig !== toolSignature
  const previewStale = Boolean(preview) && preview!.sig !== toolSignature
  const common = () => ({
    model: props.txModel || '',
    touchstone_path: props.touchstone,
    data_rate_gbps: props.dataRateGbps || 0,
    rx_package_id: props.rxPackageId || props.txPackageId,
    rx_model: props.rxModel || '',
    modulation: props.modulation,
    ports: props.ports,
  })

  async function runPreview() {
    setPreviewBusy(true); setPreviewError(''); setPreview(null)
    try {
      const data = await postJson(
        `/api/models/${encodeURIComponent(props.txPackageId)}/ami-quick-test`,
        { ...common(), ddr4_mask: ddr4Mask(maskWidth, maskHeight, rjSigma) }, t.previewFailed)
      setPreview({ sig: toolSignature, data })
      const metadata = previewReportMetadata(data, props.touchstone, t.metaModelFile, t.metaNote)
      if (metadata) setModelsReportMetadata(metadata)
    } catch (exc) { setPreviewError(errorText(exc, lang)) } finally { setPreviewBusy(false) }
  }

  async function runEqSweep() {
    setEqBusy(true); setEqError(''); setEqSweep(null)
    try {
      const data = await postJson(
        `/api/models/${encodeURIComponent(props.txPackageId)}/ami-eq-sweep`, common(), t.eqSweepFailed)
      // 全部組合失敗時後端回 status=error（HTTP 仍是 200），不能當成排名顯示。
      if (data?.status === 'error') throw new Error(data?.error || t.eqSweepAllFailed)
      setEqSweep({ sig: toolSignature, data })
    } catch (exc) { setEqError(errorText(exc, lang)) } finally { setEqBusy(false) }
  }

  function apply(row: any) {
    if (eqStale) return
    onParamsChange(applyEqRow(row, txParams, rxParams))
    setNotice(t.appliedEq([
      row.tx_param ? `${row.tx_param}=${row.tx_value}` : '',
      row.rx_param ? `${row.rx_param}=${row.rx_value}` : '',
    ].filter(Boolean).join(t.listSep)))
  }

  const eq = eqSweep?.data
  // 引擎回報的 UI 和精靈換算（PAM4 用符號率）不符時講出來（審稿 H2）。
  const uiMismatch = preview && !previewStale
    ? previewUiMismatch(preview.data.quick_eye?.ui_ps, props.dataRateGbps, props.modulation) : null
  const sides = ([
    ['Tx', props.txModel, props.txCandidates, txParams, 'tx'],
    ['Rx', props.rxModel, props.rxCandidates, rxParams, 'rx'],
  ] as const).map(([label, model, candidates, params, key]) => ({
    label, key, params,
    editable: candidates.find(item => item.name === model)?.editable_parameters || [],
  }))
  const setParam = (key: 'tx' | 'rx', name: string, value: string) => onParamsChange({
    tx: key === 'tx' ? { ...txParams, [name]: value } : txParams,
    rx: key === 'rx' ? { ...rxParams, [name]: value } : rxParams,
  })

  return (
    <details className="eye-wizard__advanced">
      <summary>{t.advancedTitle}</summary>
      <p className="hint">{t.amiAdvancedHint}</p>

      {sides.every(side => !side.editable.length) && <p className="hint">{t.noEditable}</p>}
      {sides.filter(side => side.editable.length > 0).map(side => {
        const touched = Object.values(side.params).filter(v => v !== '').length
        return (
          <details key={side.key} open={touched > 0}>
            <summary>{t.paramsSummary(side.label, side.editable.length, touched)}</summary>
            <table className="model-library__table eye-wizard__params">
              <thead><tr><th>{t.paramColumn}</th><th>{t.valueColumn}</th><th>{t.defaultColumn}</th></tr></thead>
              <tbody>{side.editable.map(item => (
                <tr key={item.name} title={item.description || ''}>
                  <td>{item.name}</td>
                  <td>{item.choices && item.choices.length > 0 ? (
                    <select className="input" aria-label={item.name} value={side.params[item.name] ?? ''}
                      onChange={e => setParam(side.key, item.name, e.target.value)}>
                      <option value="">{t.defaultOption}</option>
                      {item.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                    </select>
                  ) : (
                    <input className="input" aria-label={item.name} value={side.params[item.name] ?? ''}
                      placeholder={item.minimum && item.maximum ? `${item.minimum} ~ ${item.maximum}` : ''}
                      onChange={e => setParam(side.key, item.name, e.target.value)} />
                  )}</td>
                  <td>{item.default || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="hint">{t.manualParamsHint}</p>
          </details>
        )
      })}

      <h4>{t.previewTitle}</h4>
      {!ready && <p className="hint">{t.previewNeeds}</p>}
      <div className="eye-wizard__row">
        <button className="btn" disabled={!ready || previewBusy} title={t.previewTip}
          onClick={() => void runPreview()}>{previewBusy ? t.previewing : t.preview}</button>
        <button className="btn" disabled={!ready || eqBusy} title={t.eqSweepTip}
          onClick={() => void runEqSweep()}>{eqBusy ? t.sweeping : t.eqSweep}</button>
      </div>
      {props.showDdrMask && <details>
        <summary>{t.ddrSummary}</summary>
        <p className="hint">{t.ddrSizeHint}</p>
        <p className="hint">{t.ddrUseHint}</p>
        <div className="field-row">
          {/* 不放數字 placeholder：看起來像工具內建的門檻（ADR-0015 不內建，畫面驗收 T10）。 */}
          <label>{t.maskWidth}<input className="input" value={maskWidth}
            onChange={e => setMaskWidth(e.target.value)} /></label>
          <label>{t.maskHeight}<input className="input" value={maskHeight}
            onChange={e => setMaskHeight(e.target.value)} /></label>
          <label>{t.rjSigma}<input className="input" value={rjSigma}
            onChange={e => setRjSigma(e.target.value)} /></label>
        </div>
      </details>}
      {previewError && <p className="error">{previewError}</p>}
      {eqError && <p className="error">{eqError}</p>}
      {notice && <p className="hint">{notice}</p>}

      {eq && <div>
        {eqStale && <p className="warning">{t.eqStale}</p>}
        <p className="hint">{t.eqSummary(eq.combo_count,
          `${eq.tx_param || '—'}${eq.rx_param ? `×${eq.rx_param}` : ''}`,
          (Number(eq.elapsed_ms || 0) / 1000).toFixed(1))}</p>
        {pickList(eq, 'warnings', lang).map((text: string) => (
          <p key={text} className="warning">{text}</p>
        ))}
        <table className="model-library__table eye-metrics">
          <thead><tr>
            {eq.tx_param && <th>{eq.tx_param}</th>}
            {eq.rx_param && <th>{eq.rx_param}</th>}
            <th>{eq.ranking_metric === 'pam4_inner_eye_v' ? t.pam4InnerEye : t.eyeHeightV}</th>
            <th>{t.eyeWidthUi}</th><th>{t.apply}</th>
          </tr></thead>
          <tbody>{(eq.rows || []).slice(0, 10).map((row: any, index: number) => (
            <tr key={index} className={index === 0 && !row.why ? 'is-best' : undefined}>
              {eq.tx_param && <td>{row.tx_value}</td>}
              {eq.rx_param && <td>{row.rx_value}</td>}
              <td>{row.why ? t.whyCell(pickText(row, 'why', lang))
                : Number(row[eq.ranking_metric || 'eye_height_v'] ?? row.eye_height_v).toFixed(3)}</td>
              <td>{row.why ? '—' : `${(Number(row.eye_width_ui) * 100).toFixed(0)}%`}</td>
              <td><button className="btn--mini" disabled={eqStale || Boolean(row.why)}
                onClick={() => apply(row)}>{t.apply}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>}
      {previewStale && <p className="warning">{t.previewStale}</p>}
      {uiMismatch !== null && <p className="warning">
        {t.previewUiMismatch(String(preview?.data.quick_eye?.ui_ps), String(uiMismatch))}</p>}
      {preview && <QuickProbeView result={preview.data} />}
    </details>
  )
}
