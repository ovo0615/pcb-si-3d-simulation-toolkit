import { LengthUnitScope } from '../lengthContext'
import type { DisplayLengthUnit } from '../lengthUnits'
// 一鍵收納的報告專用渲染容器：固定尺寸、畫在畫面外，不動使用者正在看的分頁。
//
// 結果頁沒掛載時查不到 DOM，所以不靠切分頁去拍；這裡自己掛一份 Preview2D／
// 串接圖，畫好再拍。容器用 position: fixed 移到視窗外（不是 display:none——
// 量到 0 的容器 Preview2D 不會畫）。
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { waitForReportAssets } from '../reportCollect'

import CascadeSchematic, { type CascadeGraph } from './CascadeSchematic'
import Preview2D, { type PreviewData, type TdrMarkerSpan } from './Preview2D'

export const STAGE_WIDTH = 1440
export const STAGE_HEIGHT = 900
/** 畫布原生倍率：和快照 pixelRatio 一致，拍出來的是重畫的細節而不是放大的像素。 */
export const STAGE_SCALE = 3

export interface StageJob {
  lengthUnit?: DisplayLengthUnit
  id: string
  title: string
  scene?: PreviewData | null
  graph?: CascadeGraph | null
  signalNets: string[]
  refNets: string[]
  content?: ReactNode
  tdrMarkers?: TdrMarkerSpan[]
  cutoutBoundary?: number[][]
  cutoutExtent?: string
}

function CommittedContent({ children, onRendered }: { children: ReactNode; onRendered: () => void }) {
  useLayoutEffect(onRendered, [])
  return <div style={{ padding: '52px 20px 20px', color: '#d1dbe7' }}>{children}</div>
}

interface Props {
  job: StageJob | null
  onReady: (id: string) => void
  onError: (id: string, error: unknown) => void
}

const ReportCollectStage = forwardRef<HTMLDivElement, Props>(({ job, onReady, onError }, ref) => {
  // 畫完的訊號來自元件本身（Preview2D 用定位後的視角畫完、串接圖回到全覽），
  // 再等字型與容器裡的圖片解碼。不靠固定影格數猜（研究草稿第 4 節）。
  const doneRef = useRef('')
  const activeRef = useRef('')
  activeRef.current = job?.id || ''
  useEffect(() => {
    activeRef.current = job?.id || ''
    return () => { activeRef.current = '' }
  }, [job?.id])
  const [fontsFor, setFontsFor] = useState('')
  useEffect(() => {
    let disposed = false
    if (job) {
      const id = job.id
      // Canvas 的字型必須在第一次繪圖前完成，事後等字型不會重畫已完成的 Canvas。
      void document.fonts.ready.then(() => {
        if (!disposed) setFontsFor(id)
      }, error => { if (!disposed) onError(id, error) })
    }
    return () => { disposed = true }
  }, [job?.id])
  const handleRendered = () => {
    if (!job || doneRef.current === job.id) return
    doneRef.current = job.id
    const id = job.id
    const holder = (ref && typeof ref === 'object') ? ref.current : null
    const images = holder ? [...holder.querySelectorAll('img')] : []
    void waitForReportAssets(document.fonts.ready, images).then(() => {
      window.requestAnimationFrame(() => { if (activeRef.current === id) onReady(id) })
    }, error => { if (activeRef.current === id) onError(id, error) })
  }
  if (!job) return null
  return (
    <LengthUnitScope unit={job.lengthUnit ?? 'mm'}><div aria-hidden="true" style={{
      position: 'fixed', left: -(STAGE_WIDTH + 200), top: 0,
      width: STAGE_WIDTH, height: job.content ? 'auto' : STAGE_HEIGHT, pointerEvents: 'none', zIndex: -1,
    }}>
      <div ref={ref} data-collect-job={job.id} className="report-collect-stage" style={{
        // 內容型元件保留自然高度；Layout／串接圖仍使用原生 1440×900 畫布。
        position: 'relative', width: STAGE_WIDTH, height: job.content ? 'auto' : STAGE_HEIGHT, overflow: 'hidden',
        background: '#0c0e12', fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
      }}>
        <div style={{
          position: 'absolute', top: 12, left: 16, zIndex: 2, fontSize: 15, fontWeight: 700,
          color: '#9fb0c3', pointerEvents: 'none',
        }}>{job.title}</div>
        {fontsFor !== job.id ? null : job.content ? (
          <CommittedContent key={job.id} onRendered={handleRendered}>{job.content}</CommittedContent>
        ) : job.graph ? (
          <div style={{ position: 'absolute', inset: '44px 0 0 0', overflow: 'hidden' }}>
            <CascadeSchematic key={job.id} graph={job.graph} onRendered={handleRendered} />
          </div>
        ) : (
          <Preview2D key={job.id} data={job.scene || null} fitKey={job.id}
            onRendered={handleRendered}
            signalNets={job.signalNets} refNets={job.refNets}
            highlightNets={[...job.signalNets, ...job.refNets]}
            tdrMarkers={job.tdrMarkers}
            estimatedCutoutBoundary={job.cutoutBoundary}
            extentType={job.cutoutExtent}
            layerPanelEnabled={false} renderScale={STAGE_SCALE} />
        )}
      </div>
    </div></LengthUnitScope>
  )
})

ReportCollectStage.displayName = 'ReportCollectStage'
export default ReportCollectStage
