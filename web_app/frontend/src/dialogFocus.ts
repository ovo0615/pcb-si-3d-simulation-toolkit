/** 工具內對話框的 Tab 焦點限制（ Codex 審查）：Tab／Shift+Tab 只在對話框內循環，
 *  不會跑到遮罩下方的控制項。回傳 true＝已處理（呼叫端不必再處理這個按鍵）。 */
export function trapTabKey(container: HTMLElement | null, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' || !container) return false
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
  if (focusable.length === 0) {
    event.preventDefault()
    return true
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement as HTMLElement | null
  const inside = active ? container.contains(active) : false
  if (event.shiftKey ? (!inside || active === first) : (!inside || active === last)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  }
  return true
}
