import type { DisplayLengthUnit } from './lengthUnits'
import { describeApiError } from './apiError'
import { userError } from './userMessages'
// 一鍵 HTML 報告 API 與圖片轉換工具。
//
// ：後端錯誤的 `detail_en` 掛在丟出的 Error 上，畫面用 backendFields 的
// `errorText(err, lang)` 依語言挑；這裡自己產生的訊息依目前畫面語言。
import { currentLang, messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'
import { sourcePathKey, type CollectPlanItem, type CollectStatus, type CollectTable, type LayoutSource,
  type SourceEvidence, type CollectNotice, type WorkSource, type LineageStep } from './reportCollect'
import type { ReportTableData } from './reportTables'
import type {
  ReportBrand,
  ReportSettings,
  ReportSnapshot,
  ReportWorkspaceResponse,
  SnapshotStatus,
  WatermarkSettings,
} from './reportTypes'
import type { WatermarkTemplate } from './watermarkTemplates'

async function reportApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  let payload: unknown = null
  let parsed = false
  try {
    payload = await response.json()
    parsed = true
  } catch {
    payload = null
  }
  if (!response.ok) {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
    const error = userError(describeApiError(body, response, 'zh-TW'),
      describeApiError(body, response, 'en')) as Error & { status?: number; code?: string; detail_en?: string }
    error.status = response.status
    if (typeof body?.code === 'string') error.code = body.code
    throw error
  }
  // 2xx 但不是 JSON（204、或舊後端讓路徑落到 StaticFiles 回了一頁 HTML）：
  // 原本照樣 `return payload as T`，於是呼叫端下一行去取 `.manifest`／
  // `.snapshot` 得到「Cannot read properties of null」——訊息完全指不到
  // 真正的原因。在這裡就講清楚。
  if (!parsed || payload === null) {
    const error = userError(
      messagesFor(currentLang()).reportApi.notJson(response.status, url),
    ) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return payload as T
}

const jsonPost = <T>(url: string, body: unknown, method = 'POST') => reportApi<T>(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function openReportWorkspace(basePath: string, projectName: string) {
  return jsonPost<ReportWorkspaceResponse>('/api/report/workspace/open', {
    base_path: basePath,
    project_name: projectName,
  })
}

/** 用系統預設程式開啟最近一份報告。由後端 `os.startfile` 開，不用
 *  `window.open`：工具視窗會把新視窗交給外部瀏覽器，那邊沒有 token cookie，
 *  只會拿到 401。 */
export function openLatestReport(workspace: string) {
  return jsonPost<{ opened: string }>('/api/report/open_latest', { workspace })
}

export function loadReportWorkspace(workspace: string) {
  return reportApi<ReportWorkspaceResponse>(
    `/api/report/workspace?workspace=${encodeURIComponent(workspace)}`,
  )
}

export interface CreateSnapshotPayload {
  length_unit?: DisplayLengthUnit
  workspace: string
  kind: string
  title: string
  image_data_url: string
  caption?: string
  engineering_status?: SnapshotStatus
  section?: string
  source_revision?: string
  source_metadata?: Record<string, unknown>
  prune_confirmed?: boolean
  external?: boolean
  /** 拍攝時的介面語言。報告語言不同時，後端在報告警告區提醒重拍。 */
  ui_locale?: Lang
  /** 截圖拍不到的量測表，報告印在這張圖下。 */
  tables?: ReportTableData[]
}

/** 沒指定 `ui_locale` 就記目前畫面語言：截圖拍的就是這個語言的畫面。 */
export function createReportSnapshot(payload: CreateSnapshotPayload) {
  return jsonPost<{ ok: boolean; snapshot: ReportSnapshot }>('/api/report/snapshot',
    { ...payload, ui_locale: payload.ui_locale ?? currentLang() })
}

/** 原生報告圖表的文字語言；明確指定的報告語言優先，否則跟介面。 */
export function createReportChart(payload: {
  workspace: string
  length_unit?: DisplayLengthUnit
  kind: 'sdd21' | 'sdd11' | 'scd21' | 'tdr'
  sources?: string[]
  title?: string
  caption?: string
  subtitle?: string
  section?: string
  near_refdes?: string
  freq_max_ghz?: number
  engineering_status?: SnapshotStatus
  source_revision?: string
  register_snapshot?: boolean
  prune_confirmed?: boolean
  locale?: ReportSettings['locale']
}) {
  return jsonPost<{ ok: boolean; snapshot?: ReportSnapshot }>('/api/report/chart',
    { ...payload, locale: payload.locale ?? currentLang() })
}

export function updateReportSnapshot(
  workspace: string,
  snapshotId: string,
  changes: Partial<Pick<ReportSnapshot, 'caption' | 'engineering_status' | 'section' | 'selected'>>,
) {
  return jsonPost<{ ok: boolean; snapshot: ReportSnapshot }>('/api/report/snapshot', {
    workspace,
    snapshot_id: snapshotId,
    ...changes,
  }, 'PATCH')
}

export function activateReportSnapshot(workspace: string, snapshotId: string) {
  return jsonPost<{ ok: boolean; snapshot: ReportSnapshot }>('/api/report/snapshot/activate', {
    workspace,
    snapshot_id: snapshotId,
  })
}

export function markReportSnapshotsStale(workspace: string, kinds: string[], reason: string) {
  return jsonPost<{ ok: boolean; count: number }>('/api/report/snapshot/stale', {
    workspace, kinds, reason,
  })
}

export function saveReportBrand(workspace: string, brand: Partial<ReportBrand>, logoDataUrl = '', saveAsDefault = false) {
  return jsonPost<{ ok: boolean; brand: ReportBrand }>('/api/report/brand', {
    workspace,
    ...brand,
    logo_data_url: logoDataUrl,
    save_as_default: saveAsDefault,
  })
}

export function saveReportSettings(workspace: string, settings: ReportSettings) {
  return jsonPost<{ ok: boolean; settings: ReportSettings }>('/api/report/settings', {
    workspace,
    ...settings,
  })
}

export function generateHtmlReport(
  workspace: string, settings: ReportSettings, outputPath = '',
  overwriteConfirmed = false, channelTouchstone = '', lengthUnit: DisplayLengthUnit = 'mm',
) {
  return jsonPost<{
    ok: boolean
    output_path: string
    sha256: string
    snapshot_count: number
    warning_count: number
    /** 拍攝語言和報告語言不同的截圖張數（舊後端沒有）。 */
    locale_mismatch_count?: number
  }>('/api/report/generate', {
    workspace,
    ...settings,
    output_path: outputPath,
    overwrite_confirmed: overwriteConfirmed,
    channel_touchstone: channelTouchstone,
    length_unit: lengthUnit,
  })
}

// ── 一鍵收納所有快照──────────────────────────────────────────

export interface CollectPlanPayload {
  length_unit?: DisplayLengthUnit
  work_sources?: WorkSource[]
  project_board?: string
  selected_runs?: Record<string, string[]> | null
  retry_plan_id?: string
  retry_item_ids?: string[]
  workspace: string
  locale?: ReportSettings['locale']
  metadata_path?: string
  cascade_touchstone?: string
  channel_touchstone?: string
  board_path?: string
  near_refdes?: string
  signal_nets?: string[]
  /** 目前選的參考 net；不送＝未知（舊呼叫端），[]＝已知沒有。 */
  reference_nets?: string[]
  /** 目前 metadata 分段時 session 實際開著的檔與原板到它的加工鏈。 */
  source_path?: string
  lineage?: LineageStep[]
  layouts?: LayoutSource[]
  tables?: CollectTable[]
  frontend_views?: { key: string; section: string; label: string; fingerprint: string; source_evidence?: SourceEvidence }[]
  missing_sources?: CollectNotice[]
  source_evidence?: SourceEvidence
  tdr_profiles?: { label: string; distance_mm: number[]; impedance_ohm: number[]; source_evidence?: SourceEvidence }[]
  eye_images?: { label: string; path: string; source_evidence?: SourceEvidence }[]
}

export interface ReportCollectionState {
  ok: boolean
  plan_id: string
  items: CollectPlanItem[]
  results: Record<string, { status: CollectStatus; reason?: string }>
  finished: boolean
  request?: CollectPlanPayload
}
export function loadReportCollectionState(workspace: string) {
  return reportApi<ReportCollectionState>(`/api/report/collect/state?workspace=${encodeURIComponent(workspace)}`)
}

export function loadReportWorkSources(workspace: string, boardPath: string) {
  return reportApi<{ ok: boolean; work_sources: WorkSource[] }>(
    `/api/report/collect/sources?workspace=${encodeURIComponent(workspace)}&board_path=${encodeURIComponent(boardPath)}`)
}

export async function captureReportSourceEvidence(taskId: string, conditionId: string, paths: string[]): Promise<SourceEvidence> {
  const result = await jsonPost<{ ok: boolean; source_evidence: SourceEvidence }>('/api/report/collect/evidence', {
    task_id: taskId, condition_id: conditionId, files: paths.filter(Boolean).map(path => ({ path })),
  })
  if (!result.source_evidence?.files?.length || result.source_evidence.files.some(file => !/^[a-f0-9]{64}$/i.test(file.sha256))) {
    throw Object.assign(userError(messagesFor(currentLang()).reportApi.sourceReceiptMissingHash),
      { code: 'report.source_incomplete' })
  }
  return result.source_evidence
}

export async function planReportCollection(payload: CollectPlanPayload) {
  const result = await jsonPost<{ ok: boolean; plan_id: string; workspace: string; length_unit?: DisplayLengthUnit; items: CollectPlanItem[]; capabilities?: string[] }>(
    '/api/report/collect/plan', { ...payload, locale: payload.locale ?? currentLang() })
  if (payload.length_unit !== undefined && (result.length_unit !== payload.length_unit
      || result.items.some(item => item.length_unit !== payload.length_unit))) {
    throw Object.assign(userError(messagesFor(currentLang()).reportApi.collectionCapabilityUnavailable('length_unit')),
      { code: 'report.version_mismatch' })
  }
  const capabilities = ['frontend_views', 'missing_sources', 'source_evidence', 'retry']
  if (payload.selected_runs != null) capabilities.push('selected_runs')
  if (payload.work_sources !== undefined) capabilities.push('work_sources')
  // 送了新欄位就要後端明說看得懂；舊後端會默默丟掉，拿不到就整份不跑。
  if (payload.reference_nets !== undefined) capabilities.push('reference_nets')
  if (payload.source_path || payload.lineage !== undefined
    || payload.work_sources?.some(row => row.source_path || row.lineage !== undefined)) capabilities.push('work_lineage')
  for (const required of capabilities) {
    if (!result.capabilities?.includes(required)) throw Object.assign(
      userError(messagesFor(currentLang()).reportApi.collectionCapabilityUnavailable(required)),
      { code: 'report.version_mismatch' })
  }
  const identifiers = result.items.map(item => item.item_id)
  if (new Set(identifiers).size !== identifiers.length) throw Object.assign(
    userError(messagesFor(currentLang()).reportApi.collectionCapabilityUnavailable('unique item_id')),
    { code: 'report.version_mismatch' })
  if (payload.work_sources !== undefined) {
    for (const item of result.items.filter(row => row.renderer === 'frontend' && row.status === 'pending')) {
      const source = item.source_descriptor
      if (!source || typeof source.current_work !== 'boolean') throw Object.assign(
        userError(messagesFor(currentLang()).reportApi.collectionCapabilityUnavailable('source_descriptor')),
        { code: 'report.version_mismatch' })
      if ((item.target === 'segment_layout' && !item.metadata_path)
        || (item.metadata_path && source.metadata_path && sourcePathKey(item.metadata_path) !== sourcePathKey(source.metadata_path))) {
        throw Object.assign(userError(messagesFor(currentLang()).reportApi.collectionCapabilityUnavailable('item metadata_path')),
          { code: 'report.version_mismatch' })
      }
    }
  }
  return result
}

export function collectReportItem(payload: {
  workspace: string; plan_id: string; item_id: string
  length_unit?: DisplayLengthUnit
  image_data_url?: string; fingerprint?: string; error?: string
  current_signal_nets?: string[]; current_reference_nets?: string[]
}) {
  return jsonPost<{ ok: boolean; item_id: string; status: CollectStatus; reason: string; snapshot_id: string }>(
    '/api/report/collect/item', payload)
}

export function finishReportCollection(workspace: string, planId: string, cancelled: boolean) {
  return jsonPost<{
    ok: boolean
    counts: Record<CollectStatus, number>
    items: { item_id: string; title: string; status: CollectStatus; reason: string }[]
    image_bytes: number
    embedded_estimate_bytes: number
    limit_bytes: number
    over_limit: boolean
  }>('/api/report/collect/finish', { workspace, plan_id: planId, cancelled })
}

/** 重整後記憶體裡沒有的段預覽，由後端讀段檔的暫存複本重建（唯讀）。 */
export function fetchSegmentPreview(metadataPath: string, index: number, lengthUnit: DisplayLengthUnit = 'mm') {
  return jsonPost<Record<string, unknown>>('/api/report/collect/segment_preview',
    { metadata_path: metadataPath, index, length_unit: lengthUnit })
}

/** 浮水印範本：存在後端，內建在前、自訂依建立時間新到舊。 */
export function listWatermarkTemplates() {
  return reportApi<{ templates: WatermarkTemplate[]; store_path: string }>('/api/report/watermark-templates')
}

export function saveWatermarkTemplate(name: string, settings: Partial<WatermarkSettings>, imageDataUrl = '', workspace = '') {
  return jsonPost<{ ok: boolean; template: WatermarkTemplate }>('/api/report/watermark-templates', {
    name, settings, image_data_url: imageDataUrl, workspace,
  })
}

export function deleteWatermarkTemplate(templateId: string) {
  return reportApi<{ ok: boolean; deleted: WatermarkTemplate }>(
    `/api/report/watermark-templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' })
}

/** 舊版存在 localStorage 的範本搬到後端；同名不覆蓋。 */
export function importLegacyWatermarkTemplates(templates: unknown[]) {
  return jsonPost<{ ok: boolean; imported: number; skipped: number }>('/api/report/watermark-templates/import', { templates })
}

export function snapshotImageUrl(workspace: string, snapshotId: string) {
  return `/api/report/snapshot/image/${encodeURIComponent(snapshotId)}?workspace=${encodeURIComponent(workspace)}`
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error
      || userError(messagesFor(currentLang()).reportApi.imageReadFailed))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}
