// 眼圖結果頁的模型來源（#0116，ADR-0069）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 用的是規格模型（SPISim 產生／本工具合成）時，結果頁要寫出來；DDR5 Rx 合成
// 模型沒有 DFE，要標「未含 DFE，結果偏悲觀」。依據是執行紀錄頂層的
// model_origin（求解當下的快照），不是現在模型庫裡的狀態。
// 同一份內容寫進報告快照的中繼資料表（模型分頁的 store），報告裡以文字保留。
import { useEffect, useMemo } from 'react'
import { useT, messagesFor } from '../i18n'
import { runModelOrigin } from '../specModel'
import { setModelsReportMetadata } from './reportMetadataStore'

type AnyRecord = Record<string, any>

export default function ModelOriginNotice({ result }: { result: AnyRecord | null | undefined }) {
  const { t: all, lang } = useT()
  const t = all.library
  const view = useMemo(() => runModelOrigin(result, lang), [result, lang])

  useEffect(() => {
    // 報告中繼資料的鍵沿用中文（既有慣例）；值照介面語言。store 沒有刪除入口，
    // 沒有就寫空字串（報告會略過空值），免得上一次的來源留在新快照上。
    const key = messagesFor('zh-TW').library.originTitle
    const text = (role: 'Tx' | 'Rx') => {
      const line = view.lines.find(item => item.role === role)
      return line ? t.originLine(line.role, line.name, line.label) : ''
    }
    setModelsReportMetadata({
      [`${key}_Tx`]: text('Tx'),
      [`${key}_Rx`]: text('Rx'),
      [`${key}_DFE`]: view.noDfe ? t.originNoDfe(view.noDfe) : '',
      // 合成的 SerDes 沒有 AMI 等化（#0116 第二輪）：Tx、Rx 一起寫一行。
      [`${key}_EQ`]: view.noEq.length ? t.originNoEq(view.noEq.join(t.listSeparator)) : '',
      // SPISim 規格模型當 Rx：終端不是 POD，眼高偏低（實機比對報告 2.2 節）。
      [`${key}_SPISim_Rx`]: view.spisimRx ? t.originSpisimRx[view.spisimRx.kind](view.spisimRx.name) : '',
    })
  }, [view, t])

  if (!view.lines.length) return null
  return (
    <div className="eye-results__origin">
      <strong>{t.originTitle}</strong>
      {view.lines.map(line => <span key={line.role}>{t.originLine(line.role, line.name, line.label)}</span>)}
      {view.noDfe && <span className="is-warning">{t.originNoDfe(view.noDfe)}</span>}
      {view.noEq.length > 0 && <span className="is-warning">
        {t.originNoEq(view.noEq.join(t.listSeparator))}</span>}
      {view.spisimRx && <span className="is-warning">
        {t.originSpisimRx[view.spisimRx.kind](view.spisimRx.name)}</span>}
    </div>
  )
}
