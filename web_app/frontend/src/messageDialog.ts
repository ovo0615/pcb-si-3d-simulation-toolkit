/** 訊息視窗：以類型區分嚴重度，成功訊息有自己的類型（ 驗收發現 B）。
 *
 *  有 MessageDialogHost 掛著（main.tsx）時，訊息排進佇列由工具內的視窗顯示：
 *  圖示是清楚大小的 SVG，標題列也不會是瀏覽器的「127.0.0.1:8765 說」。
 *  原生 window.alert 開著時頁面 JS 全停（心跳也停，見 K9 J），這也是不再用它的原因。
 *  Host 掛上前仍排隊，確認呼叫必須 await；取消前不執行任何後續操作。 */
export type MessageKind = 'info' | 'success' | 'warning' | 'error'

export interface QueuedMessage {
  id: number
  kind: MessageKind
  text: string
  confirmation?: boolean
  /** 有值＝輸入框（取代原生 window.prompt，B 殘留）；值為預設文字。 */
  input?: { defaultValue: string }
  returnFocus?: HTMLElement | null
}

function triggerFocus(): HTMLElement | null {
  // 同一批訊息一律回到第一則開啟前的外部焦點，不能記住即將卸載的框內按鈕。
  if (queue.length) return queue[0].returnFocus ?? null
  return typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null
}

let queue: QueuedMessage[] = []
let nextId = 1
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/** Host 訂閱佇列變化；回傳取消函式。 */
export function subscribeMessages(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 目前排隊中的訊息（第一則是畫面上那一則）。同一個陣列物件直到內容改變。 */
export function pendingMessages(): QueuedMessage[] {
  return queue
}

const dismissWaiters = new Map<number, () => void>()
const confirmWaiters = new Map<number, (accepted: boolean) => void>()
const promptWaiters = new Map<number, (value: string | null) => void>()

/** 輸入框按確定：回傳輸入內容。取消、Esc 或其他關閉一律走 dismissMessage（回 null）。 */
export function submitPrompt(id: number, value: string): void {
  const resolve = promptWaiters.get(id)
  promptWaiters.delete(id)
  resolve?.(value)
  dismissMessage(id, true)
}

export function dismissMessage(id: number, accepted = false): void {
  const next = queue.filter(item => item.id !== id)
  if (next.length === queue.length) return
  queue = next
  notify()
  const waiter = dismissWaiters.get(id)
  dismissWaiters.delete(id)
  waiter?.()
  const resolveConfirmation = confirmWaiters.get(id)
  confirmWaiters.delete(id)
  resolveConfirmation?.(accepted)
  const resolvePrompt = promptWaiters.get(id)
  promptWaiters.delete(id)
  resolvePrompt?.(null)
}

/** 要等使用者看完才能往下走的訊息（例如關窗前的「偏好設定沒存到」）：按確定才 resolve。 */
export function alertMessageAndWait(message: unknown, kind: MessageKind = 'warning'): Promise<void> {
  const text = String(message ?? '')
  const id = nextId++
  queue = [...queue, { id, kind, text, returnFocus: triggerFocus() }]
  const done = new Promise<void>(resolve => { dismissWaiters.set(id, resolve) })
  notify()
  return done
}

export function alertMessage(message: unknown, kind: MessageKind = 'warning'): void {
  const text = String(message ?? '')
  queue = [...queue, { id: nextId++, kind, text, returnFocus: triggerFocus() }]
  notify()
}

export function confirmMessage(message: string): Promise<boolean> {
  const id = nextId++
  queue = [...queue, { id, kind: 'warning', text: message, confirmation: true, returnFocus: triggerFocus() }]
  const done = new Promise<boolean>(resolve => { confirmWaiters.set(id, resolve) })
  notify()
  return done
}

/** 工具自有輸入框：按確定回傳輸入文字（未 trim），取消／Esc 回 null。呼叫必須 await。 */
export function promptMessage(message: string, defaultValue = ''): Promise<string | null> {
  const id = nextId++
  queue = [...queue, { id, kind: 'info', text: message, input: { defaultValue }, returnFocus: triggerFocus() }]
  const done = new Promise<string | null>(resolve => { promptWaiters.set(id, resolve) })
  notify()
  return done
}

/** 測試用：清空佇列與訂閱。 */
export function resetMessagesForTest(): void {
  for (const resolve of confirmWaiters.values()) resolve(false)
  confirmWaiters.clear()
  for (const resolve of promptWaiters.values()) resolve(null)
  promptWaiters.clear()
  queue = []
  listeners.clear()
  dismissWaiters.clear()
}
