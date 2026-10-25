import { useLayoutEffect, useRef } from 'react'

/** 系統日誌只在使用者仍貼底時跟隨更新；判斷發生在捲動事件，早於下一次渲染。 */
export function useLogAutoScroll(revision: readonly unknown[], visible = true) {
  const logBoxRef = useRef<HTMLDivElement | null>(null)
  const following = useRef(true)
  const readingTop = useRef(0)

  const onLogScroll = () => {
    const box = logBoxRef.current
    if (box) {
      readingTop.current = box.scrollTop
      following.current = box.scrollHeight - box.scrollTop - box.clientHeight <= 2
    }
  }

  useLayoutEffect(() => {
    // 只有清除日誌才重設；隱藏後重建 DOM 時保留原閱讀位置與暫停狀態。
    if (revision.length === 0) following.current = true
    const box = logBoxRef.current
    if (box) box.scrollTop = following.current ? box.scrollHeight : readingTop.current
  }, [revision, visible])

  return { logBoxRef, onLogScroll }
}
