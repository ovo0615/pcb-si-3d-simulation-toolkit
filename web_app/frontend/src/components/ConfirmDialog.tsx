// 工具內的確認框（ 驗收發現 A）。
//
// 瀏覽器原生 confirm 會跳出「127.0.0.1:8765 說」，看起來像網頁出錯，也不能
// 換按鈕文字；要使用者決定「刪掉舊結果再重跑」這種不可逆操作時，按鈕要直接
// 說出會發生什麼事。用法：
//
//   const { request, askConfirm, settle } = useConfirmDialog
//   if (!await askConfirm({ title, message, confirmLabel, cancelLabel })) return
//   …
//   {request && <ConfirmDialog request={request} onSettle={settle} />}
import { useCallback, useEffect, useRef, useState } from 'react'
import MessageIcon from './MessageIcon'
import { trapTabKey } from '../dialogFocus'
import { pendingMessages } from '../messageDialog'

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  /** 確認後會刪除資料等不可逆操作：預設焦點放在取消。 */
  destructive?: boolean
}

export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolver = useRef<((accepted: boolean) => void) | null>(null)

  const askConfirm = useCallback((next: ConfirmRequest) => new Promise<boolean>(resolve => {
    // 前一個還沒回答就被新的取代：前一個視為取消，不能讓它的呼叫端永遠等下去。
    resolver.current?.(false)
    resolver.current = resolve
    setRequest(next)
  }), [])

  const settle = useCallback((accepted: boolean) => {
    const resolve = resolver.current
    resolver.current = null
    setRequest(null)
    resolve?.(accepted)
  }, [])

  // 元件卸載時還在等的呼叫端一律當成取消。
  useEffect(() => () => { resolver.current?.(false); resolver.current = null }, [])

  return { request, askConfirm, settle }
}

const DIALOG_BUTTON = { width: 'auto', minWidth: 76, minHeight: 44, padding: '8px 16px', flex: '0 0 auto', whiteSpace: 'nowrap' } as const

export interface ConfirmDialogProps {
  request: ConfirmRequest
  onSettle: (accepted: boolean) => void
}

export function ConfirmDialog({ request, onSettle }: ConfirmDialogProps) {
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 訊息視窗蓋在上面時按鍵歸它（它在捕獲階段處理）；這裡再擋一次以防萬一。
      if (pendingMessages().length > 0) return
      if (trapTabKey(box.current, event)) return
      if (event.key === 'Escape') onSettle(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSettle])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147482000, background: 'rgba(12,20,32,0.66)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-label={request.title}
        style={{ width: 'min(600px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto',
                 background: 'var(--panel-solid, #1b2433)', border: '1px solid rgba(255,255,255,0.15)',
                 borderRadius: 8, padding: 20, color: 'var(--text, #e6edf3)', display: 'grid', gap: 12,
                 fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif' }}>
        <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* 圖示與訊息視窗同一套 SVG，不用文字符號。 */}
          <MessageIcon kind="warning" size={30} />
          {request.title}
        </h3>
        <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {request.message}
        </div>
        {/* AC：.btn--primary 預設 width:100% 會把取消擠成直排；兩顆都固定最小寬度、不換行（與 MessageDialogHost 同組尺寸，另加左右留白）。 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" autoFocus={request.destructive} style={DIALOG_BUTTON} onClick={() => onSettle(false)}>
            {request.cancelLabel}
          </button>
          <button className="btn--primary" autoFocus={!request.destructive} style={DIALOG_BUTTON} onClick={() => onSettle(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
