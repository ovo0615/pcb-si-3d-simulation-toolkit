// 一鍵 HTML 報告 API 與圖片轉換工具。
import type {
  ReportBrand,
  ReportManifest,
  ReportSettings,
  ReportSnapshot,
  ReportWorkspaceResponse,
  SnapshotStatus,
} from './reportTypes'

async function reportApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload
      ? String((payload as { detail: unknown }).detail)
      : `HTTP ${response.status}`
    const error = new Error(detail) as Error & { status?: number }
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
}

export function createReportSnapshot(payload: CreateSnapshotPayload) {
  return jsonPost<{ ok: boolean; snapshot: ReportSnapshot }>('/api/report/snapshot', payload)
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

export function generateHtmlReport(workspace: string, settings: ReportSettings, outputPath = '', overwriteConfirmed = false) {
  return jsonPost<{
    ok: boolean
    output_path: string
    sha256: string
    snapshot_count: number
    warning_count: number
  }>('/api/report/generate', {
    workspace,
    ...settings,
    output_path: outputPath,
    overwrite_confirmed: overwriteConfirmed,
  })
}

export function snapshotImageUrl(workspace: string, snapshotId: string) {
  return `/api/report/snapshot/image/${encodeURIComponent(snapshotId)}?workspace=${encodeURIComponent(workspace)}`
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('讀取圖片失敗。'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

export function mergeManifest(current: ReportManifest, snapshot: ReportSnapshot): ReportManifest {
  const snapshots = current.snapshots
    .map(item => item.kind === snapshot.kind ? { ...item, active: item.id === snapshot.id } : item)
    .filter(item => item.id !== snapshot.id)
  snapshots.push(snapshot)
  return { ...current, snapshots, updated_at: new Date().toISOString() }
}
