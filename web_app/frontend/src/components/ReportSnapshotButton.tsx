import { confirmMessage } from '../messageDialog'
// 結果畫面共用的「更新報告快照」按鈕。
import { useEffect, useState } from 'react'

import { errorText } from '../backendFields'
import { useT } from '../i18n'
import {
  createReportSnapshot,
  openReportWorkspace,
  type CreateSnapshotPayload,
} from '../reportApi'
import { captureNode, freezeReportNode } from '../reportCapture'
import { useLengthUnit } from '../lengthContext'
import type { ReportQuality, SnapshotStatus } from '../reportTypes'
import { sanitizeReportMetadata, sanitizeReportText } from '../reportPrivacy'
import { collectReportTables } from '../reportTables'
import { resolveReportMetadata, type ReportMetadataSource } from './reportMetadataStore'

interface Props {
  basePath: string
  projectName: string
  targetId: string
  kind: string
  title: string
  section: string
  sourceRevision?: string
  /** 函式在按下快照時才呼叫：結果元件寫進 store 的數字才不會是舊值。 */
  sourceMetadata?: ReportMetadataSource
  onSaved?: (workspace: string) => void
}

const PIXEL_RATIO: Record<ReportQuality, number> = {
  compact: 1,
  standard: 2,
  high: 3,
}

// 快照一律用最高品質，不開放選。報告裡的圖是拿來看細節的，沒有人會刻意要
// 低解析度的版本；多一個選項只是多一個選錯、事後才發現要重拍的機會。
const SNAPSHOT_QUALITY: ReportQuality = 'high'

function detailKind(parentKind: string, element: HTMLElement, index: number): string {
  const token = (element.dataset.reportKind || `detail-${index + 1}`)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `${parentKind}-${token || `detail-${index + 1}`}`
}

export default function ReportSnapshotButton({
  basePath, projectName, targetId, kind, title, section,
  sourceRevision = '', sourceMetadata = {}, onSaved,
}: Props) {
  const { t, lang } = useT()
  const { unit } = useLengthUnit()
  const s = t.snapshot
  const [open, setOpen] = useState(false)
  const [caption, setCaption] = useState('')
  const [status, setStatus] = useState<SnapshotStatus>('display')
  const [busy, setBusy] = useState(false)
  const [message, setMessageState] = useState<{ text: string; error: boolean }>({ text: '', error: false })
  // 紅字由呼叫端表明（setFailure），不再看訊息裡有沒有「失敗」——切到英文後那個字就不在了。
  const setMessage = (text: string) => setMessageState({ text, error: false })
  const setFailure = (text: string) => setMessageState({ text, error: true })
  // App 裡只有一個實例，切換分頁只換 kind：不清的話上一頁的圖說會接到這一頁。
  useEffect(() => { setCaption('') }, [kind])
  useEffect(() => { setStatus('display') }, [kind])

  const capture = async () => {
    // 不再要求 basePath：只載入一個外部 .sNp 來看曲線時，分段輸出、裁切輸出、
    // 輸入檔全是空的，但那時候一樣會想存快照。後端收到空字串會退到預設目錄
    // （Documents/PCB_SI_報告），使用者不必先去某個地方設定路徑——訊息叫人
    // 「先設定分析輸出路徑」卻沒說在哪設定，等於把人擋死。
    const sourceTarget = document.getElementById(targetId)
    if (!sourceTarget) {
      setMessage(s.noTarget)
      return
    }
    setBusy(true)
    setMessage(s.creating)
    let frozen: ReturnType<typeof freezeReportNode> | undefined
    try {
      frozen = freezeReportNode(sourceTarget)
      const target = frozen.node
      const metadata = resolveReportMetadata(sourceMetadata)
      const workspaceResult = await openReportWorkspace(basePath, projectName || t.report.defaultProject)
      const save = async (payload: CreateSnapshotPayload) => {
        try {
          await createReportSnapshot(payload)
        } catch (error) {
          const typed = error as Error & { status?: number }
          if (typed.status !== 409 || !await confirmMessage(t.report.pruneConfirm(errorText(error, lang)))) throw error
          await createReportSnapshot({ ...payload, prune_confirmed: true })
        }
      }
      const render = (element: HTMLElement) => captureNode(element, PIXEL_RATIO[SNAPSHOT_QUALITY])

      const dataUrl = await render(target)
      const safeCaption = sanitizeReportText(caption)
      const payload: CreateSnapshotPayload = {
        workspace: workspaceResult.workspace,
        kind,
        length_unit: unit,
        title,
        image_data_url: dataUrl,
        caption: safeCaption,
        engineering_status: status,
        section,
        source_revision: sourceRevision,
        source_metadata: sanitizeReportMetadata({ ...metadata, quality: SNAPSHOT_QUALITY, length_unit: unit }),
        // 截圖拍不到的量測表（眼圖參數抽屜）以文字一起送，報告印在這張圖下。
        tables: collectReportTables(target, s.tableColumns),
      }

      await save(payload)

      // 有捲動容器時，整頁快照只能呈現目前視窗。結果元件可用這個標記要求
      // 另存獨立快照；以元件本身作為根節點就不受外層 overflow 裁切。
      const details = Array.from(target.querySelectorAll<HTMLElement>(
        '[data-report-separate-snapshot="true"]',
      ))
      for (let index = 0; index < details.length; index += 1) {
        const element = details[index]
        const detailTitle = element.dataset.reportTitle || s.detailTitle(title, index + 1)
        setMessage(s.creatingDetail(index + 1, details.length))
        const detailDataUrl = await render(element)
        await save({
          ...payload,
          tables: [],
          kind: detailKind(kind, element, index),
          title: detailTitle,
          image_data_url: detailDataUrl,
          caption: safeCaption
            ? `${safeCaption}\n${s.detailCaption(detailTitle)}`
            : s.detailCaption(detailTitle),
          source_metadata: {
            ...payload.source_metadata,
            parent_kind: kind,
            detail_index: index + 1,
            detail_title: detailTitle,
          },
        })
      }
      setMessage(s.saved(details.length + 1))
      setCaption('')
      window.dispatchEvent(new CustomEvent('pcbsi-report-snapshot-saved', {
        detail: { workspace: workspaceResult.workspace, kind },
      }))
      onSaved?.(workspaceResult.workspace)
      window.setTimeout(() => setOpen(false), 900)
    } catch (error) {
      setFailure(s.failed(errorText(error, lang)))
    } finally {
      try { frozen?.dispose() } finally { setBusy(false) }
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn report-snapshot-trigger"
        data-report-ignore="true"
        onClick={() => { setMessage(''); setOpen(true) }}
        title={s.triggerTip}
      >
        {s.trigger}
      </button>
      {open && (
        <div className="report-modal-backdrop" data-report-ignore="true">
          <div className="report-modal" role="dialog" aria-modal="true" aria-label={s.dialog}>
            <h3>{s.dialog}</h3>
            <div className="report-muted">{title}</div>
            <div className="report-muted">
              {s.scrollNote}
            </div>
            <label>{s.statusLabel}
              <select value={status} onChange={event => setStatus(event.target.value as SnapshotStatus)}>
                <option value="display">{t.report.status.display}</option>
                <option value="pass">{t.report.status.pass}</option>
                <option value="attention">{t.report.status.attention}</option>
                <option value="fail">{t.report.status.fail}</option>
              </select>
            </label>
            <p className="report-muted">{s.manualStatusHint}</p>
            <label>{s.caption}
              <textarea rows={4} value={caption} onChange={event => setCaption(event.target.value)}
                placeholder={s.captionPlaceholder} />
            </label>
            {message.text && <div className={message.error ? 'report-message report-message--error' : 'report-message'}>{message.text}</div>}
            <div className="report-modal-actions">
              <button className="btn" type="button" disabled={busy}
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => setOpen(false)}>{s.cancel}</button>
              <button className="btn btn--primary" type="button" disabled={busy} onClick={capture}>
                {busy ? s.savingButton : s.saveButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
