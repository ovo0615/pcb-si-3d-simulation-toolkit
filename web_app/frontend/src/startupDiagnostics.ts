/** App 已 commit 後跨一次繪製機會再記點；不代表所有非同步功能資料已完成。 */
export function notifyStartupPaint(): () => void {
  let stopped = false
  let sent = false
  let frame = 0
  const send = () => {
    const api = window.pywebview?.api
    if (stopped || sent || !api?.startup_painted) return
    sent = true
    try { Promise.resolve(api.startup_painted()).catch(() => undefined) } catch { /* 診斷不可影響操作 */ }
  }
  frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(send)
  })
  // bridge 可能晚於 App commit；收到 ready 時也需跨繪製機會。
  const ready = () => {
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(send) })
  }
  window.addEventListener('pywebviewready', ready)
  return () => {
    stopped = true
    window.cancelAnimationFrame(frame)
    window.removeEventListener('pywebviewready', ready)
  }
}
