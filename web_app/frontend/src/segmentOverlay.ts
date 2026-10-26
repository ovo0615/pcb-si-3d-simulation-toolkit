// 分段預覽的疊圖。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 預覽原本一律畫「分析」的結果。按下「不分割，整片求解」後表格只剩 S1，
// 預覽卻還疊著上一次分析的三塊框與切面線；依複雜度分段的框顏色也取自分析
// 當下的建議，表格改指定不會跟著變。
//
// 所以來源分成明確的三種：
//   followPlan === null       ＝剛分析完還沒執行，跟著分析；
//   followPlan.source 'run'   ＝這一輪剛執行，畫面上的分析就是這次執行的依據，
//                               沿用它的刀與複雜區，顏色改跟混合求解表；
//   followPlan.source 'file'  ＝載入既有 segments.json，畫檔案自己的每段範圍——
//                               畫面上的分析可能是另一份，段數相同也不能沿用。
//
// 等分分段的疊圖分兩層，各有一顆開關：
//   板子禁切／風險 ＝forbidden_intervals＋safety_overlay，板子的性質，不隨 N 改變；
//   切點診斷       ＝rejected_candidates＋理想等分位置，本次 N 的性質。
// 原本兩者共用一顆開關，而且紅色條紋畫的是隨 N 移動的 rejected_candidates，
// 看起來像禁切區跟著段數搬家。

import type { SegmentCutsInfo } from './components/Preview2D'

type Solver = 'hfss' | 'siwave'
type Box = [number, number, number, number]

/** 沿切割軸的禁切區間（mm），由後端把所有硬擋取樣面合併而成。 */
export interface ForbiddenInterval {
  start_mm: number
  end_mm: number
  sample_count: number
  /** 依出現次數排序，最多 6 條；reason_total 是去重後的總數。 */
  reasons: string[]
  reason_total: number
}

interface BoundsLike {
  min: [number, number]
  max: [number, number]
}

/** 禁切區間畫成貫穿另一軸的矩形 [x, y, w, h]（mm）。 */
export function forbiddenIntervalRects(
  intervals: ForbiddenInterval[], direction: 'x' | 'y', bounds: BoundsLike,
): Box[] {
  return intervals.map((item): Box => direction === 'x'
    ? [item.start_mm, bounds.min[1], item.end_mm - item.start_mm, bounds.max[1] - bounds.min[1]]
    : [bounds.min[0], item.start_mm, bounds.max[0] - bounds.min[0], item.end_mm - item.start_mm])
}

/** 兩顆疊圖開關各自看自己那一層有沒有東西可畫。 */
export function segmentOverlayLayers(info: SegmentCutsInfo): { board: boolean; diagnostics: boolean } {
  return {
    board: Boolean(info.safety_overlay) || Boolean(info.forbidden_intervals?.length),
    diagnostics: Boolean(info.rejected_candidates?.length) || Boolean(info.ideal_positions_mm?.length),
  }
}

export interface OverlayPlan {
  index: number
  requested_solver: Solver
  complexity_score?: number
  /** 該段的矩形範圍（mm）。舊版 segments.json 沒有。 */
  box_mm?: Box | null
}

export interface PlanLayout {
  source: 'run' | 'file'
  /** 檔案裡的切點（GET /api/schedule/plan）。舊檔沒有 box_mm 時才用得到。 */
  direction?: string | null
  positions_mm?: number[]
}

interface ComplexityLike {
  cuts: {
    direction: 'x' | 'y'
    position_mm: number
    quality_grade?: string
    region?: number
    manual?: boolean
    auto_position_mm?: number | null
  }[]
  segments: { index: number; bounds_mm: Box; solver: Solver }[]
  regions: { index: number; bounds_mm: Box; feature_count: number }[]
}

interface AxisLike {
  direction: 'x' | 'y'
  n_segments?: number
  cuts: { position_mm: number; valid?: boolean }[]
  ideal_positions_mm?: number[]
  rejected_candidates?: SegmentCutsInfo['rejected_candidates']
  forbidden_intervals?: ForbiddenInterval[]
  safety_overlay?: SegmentCutsInfo['safety_overlay']
}

export interface SegmentOverlayInput {
  complexity: ComplexityLike | null
  axis: AxisLike | null
  plans: OverlayPlan[]
  followPlan: PlanLayout | null
}

const byIndex = (plans: OverlayPlan[]) => [...plans].sort((a, b) => a.index - b.index)

/** 表格只剩一列＝不分割、整片求解。預覽標題與疊圖共用這個判斷。 */
export const isWholeBoardPlan = (input: Pick<SegmentOverlayInput, 'plans' | 'followPlan'>) =>
  Boolean(input.followPlan) && input.plans.length === 1

function complexityOverlay(
  analysis: ComplexityLike, solverOf: (index: number, fallback: Solver) => Solver,
): SegmentCutsInfo {
  return {
    // 依複雜度分段：逐刀帶軸向、每段是矩形，Preview2D 會走新路徑。
    direction: analysis.cuts[0]?.direction || 'x',
    positions_mm: analysis.cuts.map(c => c.position_mm),
    cuts: analysis.cuts.map(c => ({
      direction: c.direction,
      position_mm: c.position_mm,
      quality_grade: c.quality_grade,
      region: c.region,
      manual: c.manual,
      auto_position_mm: c.auto_position_mm,
    })),
    segment_boxes: analysis.segments.map(seg => ({
      index: seg.index,
      bounds_mm: seg.bounds_mm,
      solver: solverOf(seg.index, seg.solver),
    })),
    complexity_regions: analysis.regions.map(region => ({
      index: region.index,
      bounds_mm: region.bounds_mm,
      feature_count: region.feature_count,
    })),
  }
}

function axisOverlay(analysis: AxisLike, plans: OverlayPlan[] | null): SegmentCutsInfo {
  return {
    direction: analysis.direction,
    positions_mm: analysis.cuts.map(c => c.position_mm),
    valids: analysis.cuts.map(c => c.valid !== false),
    ideal_positions_mm: analysis.ideal_positions_mm,
    rejected_candidates: analysis.rejected_candidates,
    forbidden_intervals: analysis.forbidden_intervals,
    safety_overlay: analysis.safety_overlay,
    ...(plans ? {
      region_solvers: plans.map(plan => plan.requested_solver),
      region_scores: plans.map(plan => plan.complexity_score ?? NaN),
    } : {}),
  }
}

export function buildSegmentOverlay(input: SegmentOverlayInput): SegmentCutsInfo | null {
  const { complexity, axis, followPlan } = input
  if (!followPlan) {
    // 表格可能還是上一輪的（例如整片求解的 1 列），不能拿來替新的分析上色。
    if (complexity) return complexityOverlay(complexity, (_, fallback) => fallback)
    if (axis) return axisOverlay(axis, null)
    return null
  }

  const plans = byIndex(input.plans)
  if (plans.length === 0) return null
  const solvers = plans.map(plan => plan.requested_solver)
  const scores = plans.map(plan => plan.complexity_score ?? NaN)

  if (isWholeBoardPlan(input)) {
    // 不分割：整塊板一個區域，沒有切面線；顏色與標示跟著表格的「指定」。
    return {
      direction: 'x',
      positions_mm: [],
      whole_board: true,
      region_solvers: solvers,
      region_scores: scores,
    }
  }

  if (followPlan.source === 'run') {
    if (complexity && complexity.segments.length === plans.length) {
      const requested = new Map(plans.map(plan => [plan.index, plan.requested_solver]))
      return complexityOverlay(complexity, (index, fallback) => requested.get(index) || fallback)
    }
    if (axis && axis.cuts.length + 1 === plans.length) return axisOverlay(axis, plans)
  }

  // 載入的檔案，或執行後分析已被清掉：畫表格自己的每段矩形（混合軸向也對）。
  if (plans.every(plan => plan.box_mm)) {
    return {
      direction: 'x',
      positions_mm: [],
      segment_boxes: plans.map(plan => ({
        index: plan.index, bounds_mm: plan.box_mm as Box, solver: plan.requested_solver,
      })),
      region_solvers: solvers,
      region_scores: scores,
    }
  }
  // 舊檔沒有 box_mm：退回檔案裡的單軸切點。也沒有就不畫——寧可空白，
  // 也不要疊一組不相干的舊段。
  const direction = followPlan.direction
  const positions = followPlan.positions_mm || []
  if ((direction === 'x' || direction === 'y') && positions.length + 1 === plans.length) {
    return { direction, positions_mm: positions, region_solvers: solvers, region_scores: scores }
  }
  return null
}

/** 預覽目前呈現幾段：預覽標題與報告快照的 segment_count 用，與疊圖同一個來源。
 *  預覽畫不出來就回 null，不寫一個畫面上看不到的段數。 */
export function segmentOverlayCount(input: SegmentOverlayInput): number | null {
  if (input.followPlan) return buildSegmentOverlay(input) ? input.plans.length : null
  if (input.complexity) return input.complexity.segments.length || null
  if (input.axis) return input.axis.n_segments ?? (input.axis.cuts.length + 1)
  return null
}
