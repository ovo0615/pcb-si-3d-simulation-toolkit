// 眼圖精靈第 4 步的 AMI「進階」摺疊區（搬自舊 AMI 頁籤）：
//
//   * AMI 參數編輯：只列 .ami 宣告 Usage In／InOut 的 Model_Specific 參數；
//     只送改過的，寫不進 AEDT 的由後端寫入預檢擋下。
//
// 參數由精靈持有（進確認簽章、跟正式分析一起送出）。
import { useId } from 'react'
import { useT } from '../i18n'

export interface EditableParameter {
  name: string
  type?: string
  default?: string
  choices?: string[]
  minimum?: string | number
  maximum?: string | number
  description?: string
}

export interface AmiCandidate { name: string; editable_parameters?: EditableParameter[] }

type Params = Record<string, string>

export interface EyeWizardAmiAdvancedProps {
  txModel: string
  rxModel: string
  txCandidates: AmiCandidate[]
  rxCandidates: AmiCandidate[]
  txParams: Params
  rxParams: Params
  onParamsChange: (next: { tx: Params; rx: Params }) => void
}

export default function EyeWizardAmiAdvanced(props: EyeWizardAmiAdvancedProps) {
  const { t: all } = useT()
  const t = all.eyeWizard
  const helpPrefix = useId()
  const { txParams, rxParams, onParamsChange } = props
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
              <tbody>{side.editable.map((item, index) => (
                <tr key={item.name} title={item.description || ''}>
                  <td>{item.name}
                    <div className="hint" id={`${helpPrefix}-${side.key}-${index}`}>
                      {item.type && <div>{t.paramType}{item.type}</div>}
                      {item.minimum != null && String(item.minimum).trim() !== '' && <div>{t.paramMinimum}{item.minimum}</div>}
                      {item.maximum != null && String(item.maximum).trim() !== '' && <div>{t.paramMaximum}{item.maximum}</div>}
                      {!!item.choices?.length && <div>{t.paramChoices}{item.choices.join(' / ')}</div>}
                      {item.description && <details>
                        <summary>{t.paramDescription}</summary>
                        <p>{item.description}</p>
                      </details>}
                    </div>
                  </td>
                  <td>{item.choices && item.choices.length > 0 ? (
                    <select className="input" aria-label={item.name} aria-describedby={`${helpPrefix}-${side.key}-${index}`} value={side.params[item.name] ?? ''}
                      onChange={e => setParam(side.key, item.name, e.target.value)}>
                      <option value="">{t.defaultOption}</option>
                      {item.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                    </select>
                  ) : (
                    <input className="input" aria-label={item.name} aria-describedby={`${helpPrefix}-${side.key}-${index}`} value={side.params[item.name] ?? ''}
                      placeholder={item.minimum != null && item.maximum != null ? `${item.minimum} ~ ${item.maximum}` : ''}
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
    </details>
  )
}
