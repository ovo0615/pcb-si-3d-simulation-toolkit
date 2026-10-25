// 工具內的訊息視窗（ 驗收發現 B）。main.tsx 掛一個；alertMessage 排進來的
// 訊息一次顯示一則，按「確定」、Enter 或 Esc 換下一則。
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { trapTabKey } from '../dialogFocus'
import { useT } from '../i18n'
import { dismissMessage, pendingMessages, submitPrompt, subscribeMessages } from '../messageDialog'
import MessageIcon, { MESSAGE_KIND_COLOR } from './MessageIcon'

const DIALOG_BUTTON = { width: 'auto', minWidth: 76, minHeight: 44, flex: '0 0 auto', whiteSpace: 'nowrap' } as const

export default function MessageDialogHost() {
  const { t } = useT()
  const queue = useSyncExternalStore(subscribeMessages, pendingMessages, pendingMessages)
  const current = queue[0]
  // 輸入框（promptMessage）不受控：每則以 key 重新掛載、帶預設值，開啟時全選，
  // 直接打字就取代預設值（與原生 prompt 相同）。目前文字只記在 ref。
  const valueRef = useRef('')
  const input = useRef<HTMLInputElement | null>(null)

  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!current) return
    const previousFocus = current.returnFocus
    valueRef.current = current.input?.defaultValue ?? ''
    if (current.input) { input.current?.focus(); input.current?.select() }
    else box.current?.querySelector<HTMLButtonElement>('button')?.focus()
    // 捕獲階段＋stopImmediatePropagation：訊息蓋在確認框上時，Esc／Enter 只關訊息，
    // 不會同時取消或確認底下的確認框（odex 審查）。
    const onKey = (event: KeyboardEvent) => {
      if (trapTabKey(box.current, event)) { event.stopImmediatePropagation(); return }
      if (event.key !== 'Escape' && event.key !== 'Enter') return
      event.preventDefault()
      event.stopImmediatePropagation()
      // 輸入框內按 Enter 不送出也不關閉（Enter／Esc／取消不執行），要 Tab 到確定或直接按確定。
      if (current.input && event.key === 'Enter' && document.activeElement === input.current && input.current) return
      // Enter 啟動目前按鈕；預設為取消，避免誤確認覆寫或授權。
      const onAccept = event.key === 'Enter'
        && document.activeElement?.getAttribute('data-dialog-accept') === 'true'
      if (current.input) {
        if (onAccept) submitPrompt(current.id, valueRef.current)
        else dismissMessage(current.id, false)
        return
      }
      dismissMessage(current.id, Boolean(current.confirmation && onAccept))
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [current])

  if (!current) return null
  const title = t.messageDialog.title[current.kind]
  return (
    <div className="message-dialog__backdrop"
      style={{ position: 'fixed', inset: 0, zIndex: 2147483100, background: 'rgba(12,20,32,0.66)',
               display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-label={title} data-kind={current.kind}
        className={`message-dialog message-dialog--${current.kind}`}
        style={{ width: 'min(560px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto',
                 background: 'var(--panel-solid, #1b2433)', border: '1px solid rgba(255,255,255,0.15)',
                 borderTop: `4px solid ${MESSAGE_KIND_COLOR[current.kind]}`, borderRadius: 8, padding: 20,
                 color: 'var(--text, #e6edf3)', display: 'grid', gap: 14,
                 fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <MessageIcon kind={current.kind} size={30} />
          <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <strong style={{ fontSize: 15, lineHeight: '30px' }}>{title}</strong>
            <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {current.text}
            </div>
          </div>
        </div>
        {current.input && <input key={current.id} ref={input} type="text" aria-label={current.text}
          defaultValue={current.input.defaultValue}
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 36, padding: '6px 10px', fontSize: 14 }}
          onChange={event => { valueRef.current = event.target.value }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation() } }} />}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
          {queue.length > 1 && <span style={{ fontSize: 11, opacity: 0.7 }}>1 / {queue.length}</span>}
          {(current.confirmation || current.input) && <button className="btn" autoFocus={!current.input}
            style={DIALOG_BUTTON}
            onClick={() => dismissMessage(current.id, false)}>
            {t.messageDialog.cancel}
          </button>}
          <button className="btn--primary" autoFocus={!current.confirmation && !current.input} data-dialog-accept="true"
            style={DIALOG_BUTTON}
            onClick={() => current.input ? submitPrompt(current.id, valueRef.current) : dismissMessage(current.id, true)}>
            {t.messageDialog.ok}
          </button>
        </div>
      </div>
    </div>
  )
}
