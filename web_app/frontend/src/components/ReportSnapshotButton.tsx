// 結果畫面共用的「更新報告快照」按鈕。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import { useState } from 'react'
import { toPng } from 'html-to-image'

import { createReportSnapshot, openReportWorkspace } from '../reportApi'
import type { ReportQuality, SnapshotStatus } from '../reportTypes'

interface Props {
  basePath: string
  projectName: string
  targetId: string
  kind: string
  title: string
  section: string
  sourceRevision?: string
  sourceMetadata?: Record<string, unknown>
  onSaved?: (workspace: string) => void
}

const PIXEL_RATIO: Record<ReportQuality, number> = {
  compact: 1,
  standard: 2,
  high: 3,
}

export default function ReportSnapshotButton({
  basePath, projectName, targetId, kind, title, section,
  sourceRevision = '', sourceMetadata = {}, onSaved,
}: Props) {
  const [open, setOpen] = useState(false)
  const [caption, setCaption] = useState('')
  const [status, setStatus] = useState<SnapshotStatus>('display')
  const [quality, setQuality] = useState<ReportQuality>('standard')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const capture = async () => {
    if (!basePath.trim()) {
      setMessage('請先設定分析輸出路徑，才能建立報告工作區。')
      return
    }
    const target = document.getElementById(targetId)
    if (!target) {
      setMessage('找不到目前結果畫面，請重新切換分頁後再試。')
      return
    }
    setBusy(true)
    setMessage('正在建立高解析度快照…')
    try {
      const workspaceResult = await openReportWorkspace(basePath, projectName || 'PCB SI 分析專案')
      const dataUrl = await toPng(target, {
        cacheBust: true,
        pixelRatio: PIXEL_RATIO[quality],
        backgroundColor: '#0c0e12',
        filter: node => !(node instanceof HTMLElement && node.dataset.reportIgnore === 'true'),
      })
      const payload = {
        workspace: workspaceResult.workspace,
        kind,
        title,
        image_data_url: dataUrl,
        caption,
        engineering_status: status,
        section,
        source_revision: sourceRevision,
        source_metadata: { ...sourceMetadata, quality },
      }
      try {
        await createReportSnapshot(payload)
      } catch (error) {
        const typed = error as Error & { status?: number }
        if (typed.status !== 409 || !window.confirm(`${typed.message}\n\n是否移除最舊版本並建立新快照？`)) throw error
        await createReportSnapshot({ ...payload, prune_confirmed: true })
      }
      setMessage('快照已保存，報告將使用這個畫面的最新版本。')
      window.dispatchEvent(new CustomEvent('pcbsi-report-snapshot-saved', {
        detail: { workspace: workspaceResult.workspace, kind },
      }))
      onSaved?.(workspaceResult.workspace)
      window.setTimeout(() => setOpen(false), 900)
    } catch (error) {
      setMessage(`建立快照失敗：${String((error as Error)?.message || error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn report-snapshot-trigger"
        data-report-ignore="true"
        onClick={() => { setMessage(''); setOpen(true) }}
        title="保存目前縮放、圖層、曲線與標記，供 HTML 報告使用"
      >
        📷 更新報告快照
      </button>
      {open && (
        <div className="report-modal-backdrop" data-report-ignore="true">
          <div className="report-modal" role="dialog" aria-modal="true" aria-label="更新報告快照">
            <h3>更新報告快照</h3>
            <div className="report-muted">{title}</div>
            <label>工程狀態
              <select value={status} onChange={event => setStatus(event.target.value as SnapshotStatus)}>
                <option value="display">僅供展示</option>
                <option value="pass">通過</option>
                <option value="attention">注意</option>
                <option value="fail">失敗</option>
              </select>
            </label>
            <label>快照品質
              <select value={quality} onChange={event => setQuality(event.target.value as ReportQuality)}>
                <option value="compact">精簡（1280 px 級）</option>
                <option value="standard">標準（1920 px 級）</option>
                <option value="high">高品質（3840 px 級）</option>
              </select>
            </label>
            <label>圖說／工程備註
              <textarea rows={4} value={caption} onChange={event => setCaption(event.target.value)}
                placeholder="這張圖要證明什麼？可稍後在報告中心修改。" />
            </label>
            {message && <div className={message.includes('失敗') ? 'report-message report-message--error' : 'report-message'}>{message}</div>}
            <div className="report-modal-actions">
              <button className="btn" type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button>
              <button className="btn btn--primary" type="button" disabled={busy} onClick={capture}>
                {busy ? '建立快照中…' : '確認並保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
