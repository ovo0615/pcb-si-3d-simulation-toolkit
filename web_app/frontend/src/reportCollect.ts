import { formatLength, type DisplayLengthUnit } from './lengthUnits'
import { lengthText } from './lengthText'
import { pickText, pickList } from './backendFields'
// 報告「一鍵收納所有快照」的純函式：整理前端手上的畫面、算指紋、彙總結果。
//
// 不 import React：以 Node 實跑測試（tests/test_report_collect_frontend_0140.py）。

import { messagesFor } from './i18n/catalog'

/** 後端收納計畫的一個項目（`POST /api/report/collect/plan` 的 items）。 */
export interface CollectPlanItem {
  length_unit?: DisplayLengthUnit
  item_id: string
  kind: string
  title: string
  section: string
  renderer: 'frontend' | 'backend'
  target: string
  status: 'pending' | 'reused' | 'not_analyzed' | 'missing' | 'source_changed'
  snapshot_id?: string
  reason: string
  segment_index: number
  preview_source?: 'memory' | 'file'
  fingerprint?: string
  digest: string
  reusable?: boolean
  view_key?: string
  metadata_path?: string
  source_descriptor?: WorkSourceDescriptor
}

export interface WorkSourceDescriptor {
  project_board: string
  metadata_path: string
  edb_path: string
  task_id: string
  current_work: boolean
  signal_nets?: string[] | null
  /** null／缺欄＝後端不知道；[]＝已知沒有參考 net。兩者不能混用。 */
  reference_nets?: string[] | null
  /** 以下僅供顯示／核對，不寫回 WorkSource。 */
  loaded_board?: string
  source_path?: string
  lineage?: LineageStep[]
  lineage_basis?: string
}

/** 工具已完成的一步另存：裁切、Port、疊構、背鑽、清理。 */
export interface LineageStep {
  step: 'cutout' | 'ports' | 'stackup' | 'backdrill' | 'cleanup'
  input_path: string
  output_path: string
}

export interface WorkSource {
  metadata_path?: string
  /** 原始專案板（App 實際載入的那片），不是工作複本。 */
  board_path?: string
  cascade_touchstone?: string
  channel_touchstone?: string
  label?: string
  /** 分段當時 session 實際開著的檔（＝metadata.source）；未知就不給。 */
  source_path?: string
  /** board_path → source_path 的明確加工鏈；未知就不給。 */
  lineage?: LineageStep[]
  reference_nets?: string[] | null
}

/** 參考 net 是集合：順序不同不是另一個工作，成員不同才是。 */
export function sameNets(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort()
  const right = [...new Set(b)].sort()
  return left.length === right.length && left.every((net, index) => net === right[index])
}

export function sourcePathKey(path: string | null | undefined): string {
  return (path || '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** descriptor 的 current_work 不是充分條件，仍核對真正工作路徑。 */
export function currentWorkMatches(item: CollectPlanItem, inputs: CollectInputs): boolean {
  const source = item.source_descriptor
  if (!source) return true // 舊的純函式呼叫；新 API 由能力／descriptor gate 擋下。
  if (item.metadata_path && source.metadata_path
    && sourcePathKey(item.metadata_path) !== sourcePathKey(source.metadata_path)) return false
  if (!source.current_work) return false
  const metadata = item.metadata_path || source.metadata_path
  if (metadata && sourcePathKey(metadata) !== sourcePathKey(inputs.metadataPath)) return false
  if (source.project_board && sourcePathKey(source.project_board) !== sourcePathKey(inputs.projectBoard || inputs.boardPath)) return false
  if (source.signal_nets && inputs.signalNets && JSON.stringify(source.signal_nets) !== JSON.stringify(inputs.signalNets)) return false
  // 兩邊都是明確陣列且不同才拒；未知（null／缺欄）不等於已知空集合。
  if (Array.isArray(source.reference_nets) && Array.isArray(inputs.refNets)
    && !sameNets(source.reference_nets, inputs.refNets)) return false
  return true
}

export type CollectStatus =
  | 'collected' | 'reused' | 'not_analyzed' | 'missing' | 'failed'
  | 'version_full' | 'source_changed' | 'cancelled'

export const COLLECT_STATUSES: CollectStatus[] = [
  'collected', 'reused', 'not_analyzed', 'missing', 'failed',
  'version_full', 'source_changed', 'cancelled',
]

export interface LayoutSource {
  key: 'board' | 'cutout' | 'cleanup_before' | 'cleanup' | 'schematic' | 'segment'
  segment_index?: number
  available: boolean
  fingerprint: string
}

interface SceneLike {
  layers?: Record<string, unknown[]>
  bounds?: { min: [number, number]; max: [number, number] }
  preview_mode?: string
}

/** 比對實際幾何、net、Port 與顏色；只看物件數會把改過的圖當成舊圖。 */
export function sceneFingerprint(scene: SceneLike | null | undefined): string {
  if (!scene) return ''
  return hashText(JSON.stringify(scene))
}

/** FNV-1a 32 位元；只拿來比對同一台機器上的前後兩次，不需要密碼學強度。 */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 只採用本前端啟動且來源／條件與 job 身分仍相符的結果。
 *  狀態輪詢是全域的；重新整理後沒有啟動證據的結果交由後端 run manifest 驗證。 */
export interface SourceEvidence {
  task_id: string
  condition_id: string
  files: { path: string; sha256: string }[]
}
export interface ReportJobBinding { context: string; startedAt?: number; evidence?: SourceEvidence }
export function boundJobResult(job: any, binding: ReportJobBinding | null | undefined,
  context: string, allowPartialCuts = false): any | null {
  const completed = job?.status === 'done'
    || (allowPartialCuts && job?.status === 'error' && job.result?.cuts?.length > 0)
  if (!binding || binding.context !== context || !completed
    || binding.startedAt !== job.started_at) return null
  return job.result || null
}

export interface CollectInputs {
  metadataPath?: string
  boardPath?: string
  projectBoard?: string
  signalNets?: string[]
  refNets?: string[]
  board?: SceneLike | null
  cutout?: SceneLike | null
  cleanupBefore?: SceneLike | null
  cleanup?: SceneLike | null
  schematic?: { blocks?: unknown[]; wires?: unknown[] } | null
  /** 第 i 段的預覽在 `segmentPreviews[i - 1]`；與 `metadataPath` 同一份分段才給。 */
  segmentPreviews?: (SceneLike | null)[]
  views?: ReportView[]
}

/** 前端手上有哪些畫面。段預覽只在屬於同一份 segments.json 時才算數，
 *  不然第 3 段的標題會掛上另一次分段的圖。 */
export function layoutSources(inputs: CollectInputs): LayoutSource[] {
  const rows: LayoutSource[] = []
  const fingerprint = (scene: SceneLike) => hashText(JSON.stringify([
    sceneFingerprint(scene), inputs.signalNets || [], inputs.refNets || [],
    ...(inputs.metadataPath || inputs.boardPath ? [sourcePathKey(inputs.metadataPath), sourcePathKey(inputs.boardPath)] : []),
  ]))
  const add = (key: LayoutSource['key'], scene: SceneLike | null | undefined) => {
    if (scene) rows.push({ key, available: true, fingerprint: fingerprint(scene) })
  }
  add('board', inputs.board)
  add('cutout', inputs.cutout)
  add('cleanup_before', inputs.cleanupBefore)
  add('cleanup', inputs.cleanup)
  if (inputs.schematic && (inputs.schematic.blocks || []).length > 0) {
    rows.push({
      key: 'schematic', available: true,
      fingerprint: hashText(JSON.stringify(inputs.schematic)),
    })
  }
  ;(inputs.segmentPreviews || []).forEach((scene, index) => {
    if (scene) {
      rows.push({
        key: 'segment', segment_index: index + 1, available: true,
        fingerprint: fingerprint(scene),
      })
    }
  })
  return rows
}

/** 執行時前端要回送的指紋。記憶體來源重算（內容中途變了會對不上）；
 *  段檔來源沿用計畫給的（由後端依檔案算）。 */
export function currentFingerprint(item: CollectPlanItem, inputs: CollectInputs): string {
  if (item.metadata_path && item.source_descriptor?.metadata_path
    && sourcePathKey(item.metadata_path) !== sourcePathKey(item.source_descriptor.metadata_path)) return ''
  if (item.preview_source === 'file') return item.fingerprint || ''
  if (!currentWorkMatches(item, inputs)) {
    // 僅傳回這個工作已由後端核實可重用的快照指紋，絕不取目前工作的 scene。
    return item.reusable && item.source_descriptor?.edb_path ? item.fingerprint || '' : ''
  }
  if (item.target === 'extra_view') return inputs.views?.find(view => view.key === item.view_key)?.fingerprint || ''
  const source: CollectInputs = { signalNets: inputs.signalNets, refNets: inputs.refNets,
    metadataPath: inputs.metadataPath, boardPath: inputs.boardPath }
  if (item.target === 'segment_layout') {
    source.segmentPreviews = []
    source.segmentPreviews[item.segment_index - 1] = inputs.segmentPreviews?.[item.segment_index - 1] || null
  } else if (item.target === 'board') source.board = inputs.board
  else if (item.target === 'cutout') source.cutout = inputs.cutout
  else if (item.target === 'cleanup_before') source.cleanupBefore = inputs.cleanupBefore
  else if (item.target === 'cleanup') source.cleanup = inputs.cleanup
  else if (item.target === 'schematic') source.schematic = inputs.schematic
  const row = layoutSources(source)[0]
  return row?.fingerprint || ''
}

/** 執行每一項時一併回送目前選的 net：指紋對不上時，後端據此指出和分段紀錄差在哪些 net。
 *  未知就不送，不拿空清單冒充「沒選」。 */
export function currentNetFields(inputs: CollectInputs): { current_signal_nets?: string[]; current_reference_nets?: string[] } {
  return {
    ...(inputs.signalNets ? { current_signal_nets: [...inputs.signalNets] } : {}),
    ...(inputs.refNets ? { current_reference_nets: [...inputs.refNets] } : {}),
  }
}

/** 公開渲染來源介面；只讀取 item 的段路徑，API loader 是系統邊界。 */
export async function resolveItemRenderSource(item: CollectPlanItem, inputs: CollectInputs,
  loadSegment: (metadataPath: string, index: number) => Promise<unknown>, locale: string) {
  const descriptor = item.source_descriptor
  const missing = messagesFor(locale === 'en' ? 'en' : 'zh-TW').report.collectStatus.missing
  if (item.metadata_path && descriptor?.metadata_path
    && sourcePathKey(item.metadata_path) !== sourcePathKey(descriptor.metadata_path)) throw new Error(missing)
  if (descriptor?.project_board && (inputs.projectBoard || inputs.boardPath)
    && sourcePathKey(descriptor.project_board) !== sourcePathKey(inputs.projectBoard || inputs.boardPath)) throw new Error(missing)
  const signalNets = descriptor?.signal_nets ?? (currentWorkMatches(item, inputs) ? inputs.signalNets || [] : [])
  const refNets = descriptor?.reference_nets ?? (currentWorkMatches(item, inputs) ? inputs.refNets || [] : [])
  if (item.target === 'segment_layout' && item.preview_source === 'file') {
    const metadataPath = item.metadata_path || descriptor?.metadata_path
    if (!metadataPath) throw new Error(missing)
    return { scene: await loadSegment(metadataPath, item.segment_index), signalNets, refNets }
  }
  if (!currentWorkMatches(item, inputs)) throw new Error(missing)
  if (item.target === 'extra_view') {
    const view = inputs.views?.find(row => row.key === item.view_key)
    if (!view) throw new Error(missing)
    return { view, signalNets, refNets }
  }
  if (item.target === 'schematic') {
    if (!inputs.schematic) throw new Error(missing)
    return { graph: inputs.schematic, signalNets, refNets }
  }
  const scene = item.target === 'segment_layout' ? inputs.segmentPreviews?.[item.segment_index - 1]
    : item.target === 'board' ? inputs.board : item.target === 'cutout' ? inputs.cutout
    : item.target === 'cleanup_before' ? inputs.cleanupBefore : item.target === 'cleanup' ? inputs.cleanup : null
  if (!scene) throw new Error(missing)
  return { scene, signalNets, refNets }
}

export interface ReportView {
  key: string
  section: 'crosssection' | 'tdr' | 'cutout'
  label: string
  fingerprint: string
  type: 'crosssection' | 'comparison' | 'tdr_location' | 'cutout_range'
  data: any
  source_evidence?: SourceEvidence
}

/** 每個位置使用實際保存的 scan，不能用目前選中的另一條截面充數。 */
export function supplementalViews(cuts: any[], comparison: any, tdr: any,
  location: any, locale: string, analysisIndex = 0): ReportView[] {
  const views: ReportView[] = []
  const add = (key: string, section: ReportView['section'], label: string,
    type: ReportView['type'], data: any) => {
    views.push({ key, section, label, type, data, fingerprint: hashText(JSON.stringify([type, data])) })
  }
  for (const cut of cuts) {
    if (cut?.scan?.cut && cut.scan.region && cut.scan.layers?.length) {
      add(`xs-geometry-${cut.name}`, 'crosssection',
        collectMessages(locale).geometryTitle(cut.name), 'crosssection', cut.scan)
    }
  }
  if (comparison && tdr?.analyses?.length) {
    // 只使用有明確來源的比較資料；前端把配對方法與來源曲線一起保存。
    add('xs-tdr-comparison', 'crosssection', collectMessages(locale).comparisonTitle,
      'comparison', { result: comparison, tdr: { ...tdr, analyses: [tdr.analyses[analysisIndex] || tdr.analyses[0]] } })
  }
  if (tdr && location?.scene && location.markers?.length) {
    add('tdr-location', 'tdr', collectMessages(locale).tdrLocation,
      'tdr_location', location)
  }
  return views
}

export function emptyCounts(): Record<CollectStatus, number> {
  return Object.fromEntries(COLLECT_STATUSES.map(s => [s, 0])) as Record<CollectStatus, number>
}

export interface CollectionRow {
  item_id: string
  title: string
  status: CollectStatus
  reason: string
  kind?: string
  section?: string
}
export interface CollectionOutcome {
  plan_id: string
  counts: Record<CollectStatus, number>
  items: CollectionRow[]
  image_bytes: number | null
  embedded_estimate_bytes: number | null
  limit_bytes: number | null
  over_limit: boolean
  seconds: number | null
  cancelled: boolean
}

/** 從工作區的持久清單恢復；舊紀錄沒有耗時／bytes 時不捏造零。 */
export function restoreCollection(value: unknown): CollectionOutcome | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as Partial<CollectionOutcome>
  if (!stored.plan_id || !Array.isArray(stored.items)) return null
  const items = stored.items.filter(row => row && typeof row.item_id === 'string'
    && COLLECT_STATUSES.includes(row.status))
  const counts = emptyCounts()
  for (const row of items) counts[row.status] += 1
  const amount = (number: unknown) => typeof number === 'number' && Number.isFinite(number) ? number : null
  return { plan_id: stored.plan_id, items, counts,
    image_bytes: amount(stored.image_bytes), embedded_estimate_bytes: amount(stored.embedded_estimate_bytes),
    limit_bytes: amount(stored.limit_bytes), over_limit: Boolean(stored.over_limit),
    seconds: amount(stored.seconds), cancelled: Boolean(stored.cancelled) }
}

/** 已完成項目與未執行的可選分析不重拍；缺檔、失敗、版本滿及取消可重試。 */
export function retryItemIds(outcome: CollectionOutcome | null): string[] {
  const retryable: CollectStatus[] = ['missing', 'failed', 'source_changed', 'version_full', 'cancelled']
  return [...new Set((outcome?.items || []).filter(row => retryable.includes(row.status)).map(row => row.item_id))]
}

/** 要畫的項目數（前端與後端都算）——進度列的分母。 */
export function runnableCount(items: CollectPlanItem[]): number {
  return items.filter(item => item.status === 'pending').length
}

/** 以 1024 進位顯示位元組。 */
export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

/** 等 `work` 完成，超過 `ms` 就以 `message` 失敗。報告容器一直等不到「畫完」時，
 *  這一項標失敗、整批繼續，不會卡住。 */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string,
  signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    const abort = () => { clean(); reject(new Error('cancelled')) }
    const timer = setTimeout(() => { clean(); reject(new Error(message)) }, ms)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    work.then(
      value => { clean(); resolve(value) },
      error => { clean(); reject(error) },
    )
  })
}

/** 圖片解碼失敗必須回報，不能把尚未載入的空圖當作完成。 */
export async function waitForReportAssets(fonts: Promise<unknown>, images: { decode(): Promise<void> }[]) {
  await fonts
  await Promise.all(images.map(image => image.decode()))
}

/** 報告收納的文字表（後端畫成表卡）。`rows` 每列兩格：項目、值。 */
export interface CollectTable {
  key: string
  section: string
  label: string
  rows: string[][]
  source_evidence?: SourceEvidence
}

export interface CollectNotice {
  key: string
  section: string
  label: string
  status: 'missing' | 'not_analyzed'
  reason: string
  source_evidence?: SourceEvidence
}

export interface PreprocessingRecord {
  context: string
  source_evidence?: SourceEvidence
  data: any
}

/** 只用動作當次保存的結果；缺歷史逐項列缺，不用目前 UI 值補造。 */
export function preprocessingSources(input: { cutout?: PreprocessingRecord | null;
  cleanup?: PreprocessingRecord | null; quality?: PreprocessingRecord | null;
  hasCutout: boolean; hasCleanup: boolean; hasSegments: boolean; segmentCount?: number }, locale: string, lengthUnit?: DisplayLengthUnit) {
  const tables: CollectTable[] = []
  const views: ReportView[] = []
  const notices: CollectNotice[] = []
  const missing = (key: string, section: string, label: string, reason: string) =>
    notices.push({ key, section, label, status: 'missing', reason })
  if (input.hasCutout) {
    const cut = input.cutout
    if (cut?.source_evidence && cut.data.before && cut.data.boundary?.length >= 3) {
      views.push({ key: 'cutout-original-range', section: 'cutout', type: 'cutout_range',
        label: collectMessages(locale, lengthUnit).cutoutRange, data: cut.data,
        fingerprint: hashText(JSON.stringify(cut.data)), source_evidence: cut.source_evidence })
    } else missing('cutout-original-range', 'cutout', collectMessages(locale, lengthUnit).cutoutRange,
      collectMessages(locale, lengthUnit).cutoutMissing)
  }
  if (input.hasCleanup) {
    const clean = input.cleanup
    if (clean?.source_evidence && clean.data.deleted) {
      const data = clean.data
      const rows = Object.entries(data.deleted).map(([key, value]) => [key, String(value)])
      if (data.mode) rows.push([collectMessages(locale, lengthUnit).cleanupMode, String(data.mode)])
      if (data.guard_mm != null) rows.push([collectMessages(locale, lengthUnit).cleanupGuard, lengthNum(data.guard_mm, lengthUnit)])
      if (data.comparison) for (const stage of ['before', 'after']) {
        for (const [key, value] of Object.entries(data.comparison[stage] || {})) rows.push([`${stage}/${key}`, String(value)])
      }
      tables.push({ key: 'cleanup-deleted-summary', section: 'cleanup',
        label: collectMessages(locale, lengthUnit).cleanupSummary, rows, source_evidence: clean.source_evidence })
    } else missing('cleanup-deleted-summary', 'cleanup', collectMessages(locale, lengthUnit).cleanupSummary,
      collectMessages(locale, lengthUnit).cleanupMissing)
  }
  if (input.hasSegments && input.segmentCount !== 1) {
    const quality = input.quality
    if (quality?.source_evidence && quality.data.cuts?.length) {
      const rows: string[][] = []
      quality.data.cuts.forEach((cut: any, index: number) => {
        rows.push([collectMessages(locale, lengthUnit).indexLabel(index + 1, collectMessages(locale, lengthUnit).cutPosition), lengthNum(cut.position_mm, lengthUnit, 3)])
        rows.push([collectMessages(locale, lengthUnit).indexLabel(index + 1, collectMessages(locale, lengthUnit).qualityGrade), String(cut.quality_grade || '—')])
        for (const field of ['quality_reason', 'worst_angle_deg', 'crossing_count', 'hard_blocked', 'clearance_ok', 'stitch_return_path_risk']) {
          if (cut[field] != null) rows.push([`${index + 1}/${field}`, pickText(cut,field,locale === 'en' ? 'en' : 'zh-TW',lengthUnit)])
        }
        for (const reason of pickList(cut,'reasons',locale === 'en' ? 'en' : 'zh-TW',lengthUnit)) rows.push([collectMessages(locale, lengthUnit).indexLabel(index + 1, collectMessages(locale, lengthUnit).reason), String(reason)])
        // 手動放行 D 級：報告一定要留下標記與當時的可信頻率。
        const release = cut.manual_d_release
        if (release) {
          rows.push([`${index + 1}/manual_d_release`,
            pickText(release,'warning',locale === 'en' ? 'en' : 'zh-TW',lengthUnit)])
          rows.push([`${index + 1}/manual_d_release.frequency_limit_ghz`,
            release.frequency_limit_ghz == null ? '—' : num(release.frequency_limit_ghz, 2)])
        }
      })
      const ceiling = quality.data.stitch_ceiling
      if (ceiling) rows.push(['stitch_ceiling',
        String((locale === 'en' && ceiling.text_en) || ceiling.text || '')])
      tables.push({ key: 'segment-cut-quality', section: 'segments', rows,
        label: collectMessages(locale, lengthUnit).cutQualityPreprocessing, source_evidence: quality.source_evidence })
    } else missing('segment-cut-quality', 'segments', collectMessages(locale, lengthUnit).cutQuality,
      collectMessages(locale, lengthUnit).cutQualityMissing)
  }
  return { tables, views, notices }
}

/** 缺資料是收納清單項目，不製造一張空白圖假裝完成。 */
export function supplementalNotices(cuts: any[], tdr: any, views: ReportView[], locale: string): CollectNotice[] {
  const notices: CollectNotice[] = []
  for (const cut of cuts) {
    if (!cut) continue
    if (!cut.solved) notices.push({ key: `xs-result-${cut.name}`, section: 'crosssection',
      label: collectMessages(locale).impedanceTitle(cut.name),
      status: cut.blockers?.length ? 'missing' : 'not_analyzed',
      reason: (locale === 'en' ? cut.blockers_en || cut.blockers : cut.blockers)?.join(collectMessages(locale).reasonSeparator)
        || collectMessages(locale).cutUnsolved })
    if (!views.some(view => view.type === 'crosssection' && view.key === `xs-geometry-${cut.name}`)) {
      notices.push({ key: `xs-geometry-${cut.name}`, section: 'crosssection',
        label: collectMessages(locale).geometryTitle(cut.name),
        status: 'missing', reason: collectMessages(locale).geometryMissing })
    }
  }
  if (tdr?.analyses?.some((analysis: any) => analysis.discontinuities?.length)
    && !views.some(view => view.type === 'tdr_location')) {
    notices.push({ key: 'tdr-location', section: 'tdr',
      label: collectMessages(locale).tdrLocation, status: 'missing',
      reason: collectMessages(locale).tdrLocationMissing })
  }
  return notices
}

// 報告 bilingual 與未知值沿用繁中；只在明確 en 時選英文。
const collectMessages = (locale: string, unit: DisplayLengthUnit = 'mm') => lengthText(messagesFor(locale === 'en' ? 'en' : 'zh-TW'), unit, locale).reportCollect
// 舊呼叫未指定展示單位時保留既有表格精度；新 UI 一律明確傳入凍結單位。
const lengthNum = (value: unknown, unit?: DisplayLengthUnit, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value)
    ? unit ? formatLength(value, 'mm', unit)
      : Number(value.toFixed(digits)) === 0 && value !== 0 ? formatLength(value, 'mm', 'mm') : value.toFixed(digits)
    : '—'
const num = (value: unknown, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'

/** 截面阻抗：每條已求解的切線一張表（位置、單端／共模／奇偶模阻抗、側向收斂）。
 *  未求解的切線不列——那不是結果。 */
export function crossSectionTables(cuts: any[] | null | undefined, locale: string, lengthUnit?: DisplayLengthUnit): CollectTable[] {
  return (cuts || []).filter(cut => cut && cut.solved).map(cut => {
    const rows: string[][] = [[collectMessages(locale, lengthUnit).position,
      `${cut.axis ? `${cut.axis} = ` : ''}${lengthNum(cut.coordinate_mm, lengthUnit, 3)}`]]
    for (const [net, value] of Object.entries(cut.single_ended || {})) {
      rows.push([`Z0 ${net} (Ω)`, num(value)])
    }
    for (const pair of cut.pairs || []) {
      for (const mode of ['Zdiff', 'Zcomm', 'Z_odd', 'Z_even']) {
        const value = pair?.[mode]
        rows.push([`${mode} ${pair.positive}/${pair.negative} (Ω)`,
          typeof value === 'number' && Number.isFinite(value)
            ? `${num(value)}${pair.exact ? '' : collectMessages(locale, lengthUnit).approximate}`
            : collectMessages(locale, lengthUnit).unavailableReason(collectMessages(locale, lengthUnit).unavailable,
              (locale === 'en' ? pair.error_en || pair.error : pair.error) || collectMessages(locale, lengthUnit).resultNotSaved)])
      }
    }
    if (cut.convergence) {
      rows.push([collectMessages(locale, lengthUnit).lateralConvergence,
        cut.convergence.converged == null || cut.convergence.worst_relative == null
          ? collectMessages(locale, lengthUnit).unknown
          : collectMessages(locale, lengthUnit).convergenceValue(num(cut.convergence.worst_relative * 100), cut.convergence.converged
            ? collectMessages(locale, lengthUnit).converged : collectMessages(locale, lengthUnit).notConverged)])
    }
    return { key: `xs-${cut.name}`, section: 'crosssection',
      label: collectMessages(locale, lengthUnit).impedanceTitle(cut.name), rows }
  })
}

/** TDR：每個分析方法一張不連續點表（前 8 個，與畫面標記一致）。沒有不連續點的不列。 */
export function tdrTables(result: any, locale: string, lengthUnit?: DisplayLengthUnit): CollectTable[] {
  const tables: CollectTable[] = []
  if (result && ('rise_time_ps' in result || 'mode' in result || 'source' in result)) {
    const rows = [
      [collectMessages(locale, lengthUnit).probe, String(result.probe || 'TDR')],
      [collectMessages(locale, lengthUnit).mode, String(result.mode || result.source || '—')],
      [collectMessages(locale, lengthUnit).inputOutput,
        [result.input_p, result.input_n, result.output_p, result.output_n].filter(Boolean).join(' / ') || '—'],
      [collectMessages(locale, lengthUnit).riseTime, num(result.rise_time_ps)],
      [collectMessages(locale, lengthUnit).channelLength, lengthNum(result.path_length_mm, lengthUnit)],
      ['Dk', num(result.dk_hint)],
    ]
    for (const analysis of result.analyses || []) {
      rows.push([collectMessages(locale, lengthUnit).methodLabel(analysis.method || 'TDR', collectMessages(locale, lengthUnit).resolution),
        lengthNum(analysis.resolution_mm, lengthUnit, 3)])
    }
    tables.push({ key: 'tdr-parameters', section: 'tdr',
      label: collectMessages(locale, lengthUnit).tdrParameters, rows })
  }
  tables.push(...((result?.analyses || []) as any[]).filter(a => (a.discontinuities || []).length > 0).map(a => ({
    key: `tdr-${a.method}`, section: 'tdr',
    label: collectMessages(locale, lengthUnit).tdrDiscontinuities(result.probe || 'TDR', a.method),
    rows: (a.discontinuities as any[]).slice(0, 8).map((d, index) => [
      `${index + 1}. ${lengthNum(d.distance_mm, lengthUnit)} ${lengthUnit ?? 'mm'}`,
      collectMessages(locale, lengthUnit).tdrValues(num(d.impedance_ohm, 1), num(d.delta_z_ohm, 1), num(d.reflection_mag, 3)),
    ]),
  })))
  return tables
}

/** 使用真正 QuickEye job.result 的量測格式，包含不可得原因與原生來源。 */
export function quickEyeTables(result: any, locale: string): CollectTable[] {
  if (!result) return []
  const condition = hashText(JSON.stringify([result.mode, result.data_rate_gbps,
    result.rise_time_ps, result.port_mapping]))
  const rows = [
    [collectMessages(locale).mode, String(result.mode || '—')],
    [collectMessages(locale).dataRate, num(result.data_rate_gbps)],
    [collectMessages(locale).riseTime, num(result.rise_time_ps)],
    ...Object.entries(result.port_mapping || {}).map(([key, value]) => [key, String(value || '—')]),
  ]
  const models: CollectTable = { key: `quickeye-models-${condition}`, section: 'models',
    label: collectMessages(locale).quickEyeConditions, rows }
  const measurements = result.measurements
  const metrics: string[][] = []
  if (!measurements || !measurements.available) {
    metrics.push([collectMessages(locale).measurementsUnavailable,
      String(measurements?.unavailable_reason || collectMessages(locale).measurementNotSaved)])
  }
  metrics.push([collectMessages(locale).measurementSource, String(measurements?.source || '—')])
  if (measurements?.api) metrics.push(['API', String(measurements.api)])
  for (const [key, entry] of Object.entries(measurements?.metrics || {})) {
    const metric = entry as any
    metrics.push([String(metric.label || key), typeof metric.value === 'number'
      ? `${num(metric.value, 4)} ${metric.unit || ''}`.trim()
      : String(metric.text || metric.reason || collectMessages(locale).unavailable)])
  }
  for (const note of result.solver_fit?.notes || []) metrics.push([collectMessages(locale).fitWarning, String(note)])
  return [models, { key: `quickeye-measures-${condition}`, section: 'eye',
    label: collectMessages(locale).quickEyeMeasurements, rows: metrics }]
}
