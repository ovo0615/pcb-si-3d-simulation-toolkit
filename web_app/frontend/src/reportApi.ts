// 一鍵 HTML 報告 API 與圖片轉換工具。
//
// 卡 0087：後端錯誤的 `detail_en` 掛在丟出的 Error 上，畫面用 backendFields 的
// `errorText(err, lang)` 依語言挑；這裡自己產生的訊息依目前畫面語言。
import { currentLang, messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'
import type {
  ReportBrand,
  ReportSettings,
  ReportSnapshot,
  ReportWorkspaceResponse,
  SnapshotStatus,
} from './reportTypes'

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
    const detail = body && 'detail' in body ? String(body.detail) : `HTTP ${response.status}`
    const error = new Error(detail) as Error & { status?: number; code?: string; detail_en?: string }
    error.status = response.status
    if (typeof body?.code === 'string') error.code = body.code
    if (typeof body?.detail_en === 'string' && body.detail_en) error.detail_en = body.detail_en
    throw error
  }
  // 2xx 但不是 JSON（204、或舊後端讓路徑落到 StaticFiles 回了一頁 HTML）：
  // 原本照樣 `return payload as T`，於是呼叫端下一行去取 `.manifest`／
  // `.snapshot` 得到「Cannot read properties of null」——訊息完全指不到
  // 真正的原因。在這裡就講清楚。
  if (!parsed || payload === null) {
    const error = new Error(
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
 *  只會拿到 401（卡片 #0073）。 */
export function openLatestReport(workspace: string) {
  return jsonPost<{ opened: string }>('/api/report/open_latest', { workspace })
}

export function loadReportWorkspace(workspace: string) {
  return reportApi<ReportWorkspaceResponse>(
    `/api/report/workspace?workspace=${encodeURIComponent(workspace)}`,
  )
}

export interface CreateSnapshotPayload {
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
  /** 拍攝時的介面語言（卡 0087）。報告語言不同時，後端在報告警告區提醒重拍。 */
  ui_locale?: Lang
}

/** 沒指定 `ui_locale` 就記目前畫面語言：截圖拍的就是這個語言的畫面。 */
export function createReportSnapshot(payload: CreateSnapshotPayload) {
  return jsonPost<{ ok: boolean; snapshot: ReportSnapshot }>('/api/report/snapshot',
    { ...payload, ui_locale: payload.ui_locale ?? currentLang() })
}

/** 原生報告圖表的文字語言；明確指定的報告語言優先，否則跟介面。 */
export function createReportChart(payload: {
  workspace: string
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
  overwriteConfirmed = false, channelTouchstone = '',
) {
  return jsonPost<{
    ok: boolean
    output_path: string
    sha256: string
    snapshot_count: number
    warning_count: number
    /** 拍攝語言和報告語言不同的截圖張數（卡 0087；舊後端沒有）。 */
    locale_mismatch_count?: number
  }>('/api/report/generate', {
    workspace,
    ...settings,
    output_path: outputPath,
    overwrite_confirmed: overwriteConfirmed,
    channel_touchstone: channelTouchstone,
  })
}

export function snapshotImageUrl(workspace: string, snapshotId: string) {
  return `/api/report/snapshot/image/${encodeURIComponent(snapshotId)}?workspace=${encodeURIComponent(workspace)}`
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error
      || new Error(messagesFor(currentLang()).reportApi.imageReadFailed))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}
