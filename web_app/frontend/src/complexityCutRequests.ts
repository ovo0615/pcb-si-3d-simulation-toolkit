// 可見刀可能已合併；拖曳與重驗證仍重播完整來源刀位。
interface CutPosition { axis: number; position_mm: number }
interface ComplexityCuts {
  cuts: (CutPosition & { source_index?: number })[]
  source_cuts?: CutPosition[]
}

export function complexityCutRequests(analysis: ComplexityCuts): CutPosition[] {
  return (analysis.source_cuts ?? analysis.cuts).map(cut => ({
    axis: cut.axis, position_mm: cut.position_mm,
  }))
}

export function moveComplexityCut(
  analysis: ComplexityCuts, visibleIndex: number, positionMm: number,
): CutPosition[] {
  const sourceIndex = analysis.cuts[visibleIndex].source_index ?? visibleIndex
  return complexityCutRequests(analysis).map((cut, index) => ({
    ...cut, position_mm: index === sourceIndex ? positionMm : cut.position_mm,
  }))
}
