// 關窗二選一：工具視窗按 X 時由外殼叫出來。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 兩個選項都**不停止工作**：已送出的求解在背景跑完並佔用 License。要中斷求解
// 請先按工具裡的「停止」。選項上的說明是 。
// 保存或放棄失敗時視窗留著、講出原因，不假裝已保存。
import { useEffect, useState } from 'react'
import type { CloseRequestPayload } from '../desktopBridge'
import { useT } from '../i18n'

export interface CloseSessionDialogProps {
  request: CloseRequestPayload
  onSave: () => Promise<void>
  onDiscard: () => Promise<void>
  onCancel: () => void
}

export function CloseSessionDialog({ request, onSave, onDiscard, onCancel }: CloseSessionDialogProps) {
  const { t } = useT()
  const c = t.closeSession
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [working, onCancel])

  const run = async (action: () => Promise<void>) => {
    setWorking(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(c.failed(e instanceof Error ? e.message : String(e)))
      setWorking(false)
    }
  }

  const note: React.CSSProperties = { fontSize: 12, lineHeight: 1.55, color: 'var(--muted, #9fb0c3)',
                                      margin: '4px 0 0' }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(12,20,32,0.66)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div role="alertdialog" aria-modal="true" aria-label={c.title}
        style={{ width: 'min(560px, calc(100vw - 40px))', background: 'var(--panel-solid, #1b2433)',
                 border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 20,
                 color: 'var(--text, #e6edf3)', display: 'grid', gap: 12,
                 fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{c.title}</h3>
        {request.busy && request.jobs.length > 0 && (
          <div style={{ fontSize: 12.5 }}>
            {c.runningJobs}
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {request.jobs.map(job => <li key={job}>{job}</li>)}
            </ul>
          </div>
        )}
        {request.unknown && <div style={{ fontSize: 12.5 }}>{c.unknownJobs}</div>}
        <div>
          <button className="btn--primary" disabled={working} autoFocus
            onClick={() => void run(onSave)}>{c.saveButton}</button>
          <p style={note}>{c.saveConfirm}</p>
        </div>
        <div>
          <button className="btn" disabled={working} onClick={() => void run(onDiscard)}>
            {c.discardButton}
          </button>
          <p style={note}>{c.discardConfirm}</p>
        </div>
        {error && <div className="status status--err" style={{ fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          {working && <span style={{ fontSize: 12, color: 'var(--muted, #9fb0c3)' }}>{c.working}</span>}
          <button className="btn" disabled={working} onClick={onCancel}>{c.cancelButton}</button>
        </div>
      </div>
    </div>
  )
}
