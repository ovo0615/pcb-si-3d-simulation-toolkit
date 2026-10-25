// 只記錄本工具已成功產生的明確工作，不掃全機或推測歷史。
import { sourcePathKey, type LineageStep, type WorkSource } from './reportCollect'

/** 原板到目前 session 檔的加工鏈。只由工具完成的步驟累加，不從父目錄或檔名推。 */
export interface WorkLineage {
  project_board: string
  source_path: string
  steps: LineageStep[]
}

export function startLineage(boardPath: string): WorkLineage | null {
  return boardPath ? { project_board: boardPath, source_path: boardPath, steps: [] } : null
}

/** 這一步的輸入必須是鏈尾；接不上（中途換過檔、重整後不知道）就變成未知，不猜。 */
export function appendLineage(lineage: WorkLineage | null, step: LineageStep['step'],
  inputPath: string, outputPath: string): WorkLineage | null {
  if (!lineage || !inputPath || !outputPath) return null
  if (sourcePathKey(inputPath) !== sourcePathKey(lineage.source_path)) return null
  if (sourcePathKey(inputPath) === sourcePathKey(outputPath)) return null
  return { ...lineage, source_path: outputPath,
    steps: [...lineage.steps, { step, input_path: inputPath, output_path: outputPath }] }
}

function chainIsValid(boardPath: string | undefined, sourcePath: string | undefined, steps: unknown): steps is LineageStep[] {
  if (!boardPath || !sourcePath || !Array.isArray(steps)) return false
  let tip = boardPath
  for (const row of steps) {
    if (!row || typeof row.input_path !== 'string' || typeof row.output_path !== 'string'
      || !['cutout', 'ports', 'stackup', 'backdrill', 'cleanup'].includes(row.step)
      || sourcePathKey(row.input_path) !== sourcePathKey(tip)) return false
    tip = row.output_path
  }
  return sourcePathKey(tip) === sourcePathKey(sourcePath)
}

/** 分段完成時的工作紀錄。session 實際來源與鏈尾一致才送 lineage；鍵一律存在，
 *  重新分段才會覆蓋同一份 metadata 先前留下的 lineage。 */
export function segmentedWorkSource(boardPath: string, metadataPath: string, lineage: WorkLineage | null,
  sessionPath: string, referenceNets: string[]): WorkSource {
  const known = !!lineage && sourcePathKey(lineage.project_board) === sourcePathKey(boardPath)
    && sourcePathKey(lineage.source_path) === sourcePathKey(sessionPath)
  return { metadata_path: metadataPath, board_path: boardPath,
    source_path: known ? lineage!.source_path : undefined,
    lineage: known ? lineage!.steps : undefined,
    reference_nets: [...referenceNets] }
}

const key = (boardPath: string) => `pcbsi.report.work-sources.v1:${sourcePathKey(boardPath)}`
export function rememberedWorkSources(boardPath: string): WorkSource[] {
  if (!boardPath) return []
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key(boardPath)) || '[]')
    return Array.isArray(rows) ? rows.filter(row => row && typeof row.metadata_path === 'string'
      && sourcePathKey(row.board_path) === sourcePathKey(boardPath)).map(row => {
      // 本機紀錄接不成原板 → source_path 的鏈就當未知，不把它送給後端當證據。
      if (chainIsValid(row.board_path, row.source_path, row.lineage)) return row
      const { source_path: _source, lineage: _lineage, ...rest } = row
      return rest
    }) : []
  } catch { return [] }
}

export function rememberWorkSource(previous: WorkSource[], source: WorkSource): WorkSource[] {
  if (!source.metadata_path || !source.board_path) return previous
  const existing = previous.find(row => sourcePathKey(row.board_path) === sourcePathKey(source.board_path)
    && sourcePathKey(row.metadata_path) === sourcePathKey(source.metadata_path))
  const rows = [...previous.filter(row => sourcePathKey(row.board_path) === sourcePathKey(source.board_path)
    && sourcePathKey(row.metadata_path) !== sourcePathKey(source.metadata_path)), { ...existing, ...source }]
  try { localStorage.setItem(key(source.board_path), JSON.stringify(rows)) } catch { /* 當前記憶體清單仍保留。 */ }
  return rows
}

export interface PlanSourceInputs {
  boardPath: string
  projectBoard?: string
  metadataPath: string
  cascadeTouchstone: string
  channelTouchstone: string
  signalNets: string[]
  refNets: string[]
  workSources?: WorkSource[]
}

/** 收納計畫的來源欄位：原板是專案身分，工作複本只走 source_path／lineage。 */
export function planSourceFields(inputs: PlanSourceInputs) {
  const workSources = (inputs.workSources || [{ metadata_path: inputs.metadataPath,
    board_path: inputs.boardPath, cascade_touchstone: inputs.cascadeTouchstone,
    channel_touchstone: inputs.channelTouchstone }]).map(row => JSON.parse(JSON.stringify(row)) as WorkSource)
  const current = inputs.metadataPath ? workSources.find(row =>
    sourcePathKey(row.metadata_path) === sourcePathKey(inputs.metadataPath) && row.source_path && row.lineage) : undefined
  return {
    project_board: inputs.projectBoard || inputs.boardPath,
    board_path: inputs.boardPath,
    metadata_path: inputs.metadataPath,
    cascade_touchstone: inputs.cascadeTouchstone,
    channel_touchstone: inputs.channelTouchstone,
    signal_nets: inputs.signalNets,
    reference_nets: [...inputs.refNets],
    work_sources: workSources,
    ...(current ? { source_path: current.source_path, lineage: current.lineage } : {}),
  }
}
