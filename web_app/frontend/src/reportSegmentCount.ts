// 報告快照中繼資料的 segment_count（卡 0083 R5）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 原本只看 `segRun`（本次工作階段跑過的分段）與 `segAnalysis`。重新開啟專案、
// 直接載入串接結果時兩者都是空的，3 段混合求解的報告就寫成 segment_count 0。
// 串接相關的分頁以「這份串接結果由幾段組成」為準（後端從串接摘要讀出），
// 分段分頁才以本次分段為準。都查不到就不寫，不要寫 0。

export interface SegmentCountSources {
  view: string
  cascadeSegmentCount?: number | null
  schematicBlockCount?: number | null
  segRunCount?: number | null
  segAnalysisCount?: number | null
}

const CASCADE_VIEWS = new Set(['schematic', 'sparam', 'tdr', 'eye', 'models'])

export function reportSegmentCount(sources: SegmentCountSources): number | undefined {
  const cascade = [sources.cascadeSegmentCount, sources.schematicBlockCount]
  const session = [sources.segRunCount, sources.segAnalysisCount]
  const order = CASCADE_VIEWS.has(sources.view) ? [...cascade, ...session] : [...session, ...cascade]
  const found = order.find(value => typeof value === 'number' && value > 0)
  return found ?? undefined
}
