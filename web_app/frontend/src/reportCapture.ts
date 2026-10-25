// 報告快照的 DOM 擷取：單張按鈕與一鍵收納共用同一套設定。
import { toPng } from 'html-to-image'

import { isSnapshotSafeNode } from './reportPrivacy'

// 報告會交給客戶：除了 data-report-ignore，任何仍帶本機絕對路徑的文字節點與
// 輸入框也不拍（：S 參數頁底部的「來源：<完整路徑>」曾被拍進縮圖）。
const snapshotFilter = (node: Node) =>
  isSnapshotSafeNode(node as unknown as Parameters<typeof isSnapshotSafeNode>[0])

/** 同步固定點擊當下的 DOM、樣式與 Canvas；後續 await 不會拍到切換後的畫面。 */
export function freezeReportNode(element: HTMLElement): { node: HTMLElement; dispose: () => void } {
  const node = element.cloneNode(true) as HTMLElement
  const originals = [element, ...element.querySelectorAll<HTMLElement>('*')]
  const copies = [node, ...node.querySelectorAll<HTMLElement>('*')]
  originals.forEach((original, index) => {
    const copy = copies[index]
    const style = getComputedStyle(original)
    for (const property of style) copy.style.setProperty(property, style.getPropertyValue(property))
    // 抄來的 animation-* 會讓複本一掛上 document 就把 .panel／.view-stage > * 的進場動畫
    // （fill-mode both）從 opacity 0 重播；擷取在 190ms 內完成，整張圖變暗（AH）。
    // opacity／transform 已是點擊當下的計算值，停掉動畫與轉場即可固定外觀。
    copy.style.setProperty('animation', 'none')
    copy.style.setProperty('transition', 'none')
    if (original instanceof HTMLCanvasElement && copy instanceof HTMLCanvasElement) {
      copy.width = original.width
      copy.height = original.height
      copy.getContext('2d')?.drawImage(original, 0, 0)
    }
  })
  const holder = document.createElement('div')
  holder.style.position = 'fixed'
  holder.style.left = '-20000px'
  holder.style.top = '0'
  holder.style.pointerEvents = 'none'
  holder.setAttribute('aria-hidden', 'true')
  // 離屏定位放在外殼，擷取的根節點保持圖面原點（與 ReportCollectStage 相同）。
  node.style.position = 'relative'
  node.style.left = '0'
  node.style.top = '0'
  node.style.margin = '0'
  node.style.pointerEvents = 'none'
  node.style.width = `${element.getBoundingClientRect().width}px`
  node.style.height = `${element.getBoundingClientRect().height}px`
  node.style.transform = 'none'
  holder.appendChild(node)
  try {
    document.body.appendChild(holder)
    originals.forEach((original, index) => {
      copies[index].scrollTop = original.scrollTop
      copies[index].scrollLeft = original.scrollLeft
    })
  } catch (error) {
    holder.remove()
    throw error
  }
  return { node, dispose: () => holder.remove() }
}

/** 把節點拍成 PNG Data URL。快照一律最高品質（pixelRatio 3）。 */
export function captureNode(element: HTMLElement, pixelRatio = 3): Promise<string> {
  return toPng(element, {
    cacheBust: true,
    pixelRatio,
    backgroundColor: '#0c0e12',
    filter: node => snapshotFilter(node),
  })
}
